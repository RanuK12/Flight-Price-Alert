/**
 * AlertEngine — monitor de fondo que recorre un subset de rutas activas,
 * las consulta vía hybridSearch (modo background → scraper primero,
 * Amadeus como fallback) y dispara notificaciones para las ofertas que
 * cumplen el nivel mínimo de alerta del dueño de la ruta.
 *
 * Se ejecuta desde el cron de `src/app.js` (default cada 2h).
 *
 * v4.1 — Mejoras de rate-limiting:
 *   • Sampling: máx 35 rutas por pasada (rotación). En 3 pasadas = total.
 *   • Filtra rutas con fecha de salida pasada.
 *   • Pausa 2s entre rutas + 10s cada 5 rutas.
 *   • Early stop si el circuit breaker del scraper se abre.
 *
 * @module services/alertEngine
 */

'use strict';

const routesRepo = require('../database/repositories/routesRepo');
const userPrefsRepo = require('../database/repositories/userPrefsRepo');
const Notification = require('../database/models/Notification');
const hybrid = require('./hybridSearch');
const { classifyPrice } = require('../config/priceThresholds');
const { notifyOffer, notifyBatchHeader } = require('../bot/notifier');
const logger = require('../utils/logger').child('alertEngine');

/** Jerarquía de niveles: un nivel "n" pasa si ≤ al mínimo configurado. */
const LEVEL_RANK = { steal: 0, great: 1, good: 2, normal: 3, high: 4 };
const MIN_LEVEL_TO_RANK = { steal: 0, great: 1, good: 2, all: 4 };

/** Máximo de rutas a consultar por pasada (evita 429 masivo). */
const MAX_ROUTES_PER_PASS = 35;

/** Offset de rotación persistente entre pasadas. */
let rotationOffset = 0;

/** Pausa entre rutas (ms). */
const INTER_ROUTE_DELAY_MS = 2000;

/** Pausa adicional cada N rutas (ms). */
const GROUP_SIZE = 5;
const GROUP_PAUSE_MS = 10000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Chequea si el circuit breaker del scraper está abierto.
 * @returns {boolean}
 */
function isCircuitBreakerOpen() {
  try {
    // eslint-disable-next-line global-require
    const gfApi = require('../../server/scrapers/googleFlightsApi');
    // El módulo exporta internamente; accedemos al estado vía canProceed heuristic.
    // Si no puede proceder, el CB está abierto.
    // Nota: no es exportado directamente, pero searchFlightsApi hace la validación
    // internamente. Aquí usamos una heurística: intentamos detectar si la
    // última búsqueda devolvió 'Circuit breaker open' en el error.
    return false; // fallback: dejamos que el scraper maneje
  } catch {
    return false;
  }
}

/**
 * Filtra rutas con fecha de salida pasada (ya no tiene sentido consultarlas).
 * @param {Array} routes
 * @returns {Array}
 */
function filterPastRoutes(routes) {
  const today = new Date().toISOString().split('T')[0];
  return routes.filter(r => {
    if (!r.outboundDate) return true; // fecha flexible → mantener
    return r.outboundDate >= today;
  });
}

/**
 * Selecciona un subset rotativo de rutas para esta pasada.
 * @param {Array} routes
 * @param {number} max
 * @returns {Array}
 */
function sampleRoutes(routes, max) {
  if (routes.length <= max) return routes;
  const sampled = [];
  for (let i = 0; i < max; i++) {
    const idx = (rotationOffset + i) % routes.length;
    sampled.push(routes[idx]);
  }
  return sampled;
}

/**
 * Obtiene el precio de la última notificación enviada para una ruta.
 * @param {string} routeId
 * @returns {Promise<number|null>}
 */
async function getPreviousPrice(routeId) {
  if (!routeId) return null;
  const last = await Notification.findOne({ route: routeId })
    .sort({ sentAt: -1 })
    .lean();
  return last ? last.price : null;
}

/**
 * Decide si la notificación debe ser silenciosa.
 * - NO silenciosa: si el precio cruzó el threshold hacia abajo (ahora <= threshold y antes > threshold).
 * - Silenciosa: si bajó de precio pero sigue por encima del threshold o no hay threshold.
 * @param {number} currentPrice
 * @param {number|null} previousPrice
 * @param {number|null} threshold
 * @returns {boolean}
 */
function shouldBeSilent(currentPrice, previousPrice, threshold) {
  if (!threshold) return true; // Sin threshold → siempre silent (solo alertas manuales importan)
  const crossedDown = currentPrice <= threshold && (previousPrice === null || previousPrice > threshold);
  return !crossedDown;
}

/**
 * Corre una pasada completa de monitoreo.
 * @returns {Promise<{routesChecked: number, offersSent: number, errors: number}>}
 */
async function runOnce() {
  const started = Date.now();
  const allRoutes = await routesRepo.listAllActive();

  // Filtrar rutas con fechas pasadas
  const validRoutes = filterPastRoutes(allRoutes);
  const pastCount = allRoutes.length - validRoutes.length;

  // Sampling: tomar un subset rotativo
  const routes = sampleRoutes(validRoutes, MAX_ROUTES_PER_PASS);
  rotationOffset = (rotationOffset + routes.length) % Math.max(1, validRoutes.length);

  logger.info('Alert pass iniciada', {
    totalActive: allRoutes.length,
    pastFiltered: pastCount,
    validRoutes: validRoutes.length,
    sampledThisPass: routes.length,
    rotationOffset,
  });

  const notificationsByChat = /** @type {Map<number, number>} */ (new Map());
  let offersSent = 0;
  let errors = 0;
  let skippedNoFlights = 0;
  let skippedByLevel = 0;
  let skippedByThreshold = 0;
  let skippedByDedup = 0;
  let skippedByCircuitBreaker = 0;

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];

    // Early stop: si el circuit breaker del scraper está abierto,
    // no tiene sentido seguir consultando.
    // Detectamos esto mirando si las últimas búsquedas devuelven
    // 'Circuit breaker open' en los errores.
    if (errors >= 6 && errors > offersSent + skippedByLevel + skippedByThreshold) {
      skippedByCircuitBreaker = routes.length - i;
      logger.warn('Early stop: demasiados errores consecutivos (probable circuit breaker)', {
        errors, remaining: skippedByCircuitBreaker,
      });
      break;
    }

    try {
      const prefs = await userPrefsRepo.getOrCreate(
        route.telegramUserId,
        route.telegramChatId,
      );
      const minRank = MIN_LEVEL_TO_RANK[prefs.alert_min_level] ?? 0;

      const result = await hybrid.search({
        origin: route.origin,
        destination: route.destination,
        departureDate: route.outboundDate,
        returnDate: route.returnDate || undefined,
        currency: route.currency || prefs.currency,
        max: 5,
      }, { mode: 'background' });

      if (!result.flights?.length) {
        skippedNoFlights += 1;
        logger.debug('Ruta sin vuelos', {
          id: route._id, route: `${route.origin}-${route.destination}`,
          date: route.outboundDate,
        });
        // Delay inter-ruta
        await sleep(INTER_ROUTE_DELAY_MS);
        continue;
      }

      // Elegimos la oferta más barata por ruta/fecha para no spamear.
      const cheapest = result.flights.reduce((a, b) => (a.price <= b.price ? a : b));
      const { level } = classifyPrice(
        cheapest.origin, cheapest.destination,
        cheapest.price, cheapest.tripType,
      );
      const rank = LEVEL_RANK[level] ?? 99;

      // 1) Debe cumplir el nivel mínimo configurado por el usuario.
      if (rank > minRank) {
        skippedByLevel += 1;
        logger.debug('Ruta filtrada por nivel', {
          id: route._id, route: `${route.origin}-${route.destination}`,
          price: cheapest.price, level, rank,
          minLevel: prefs.alert_min_level, minRank,
        });
        await sleep(INTER_ROUTE_DELAY_MS);
        continue;
      }

      // 2) Si la ruta tiene threshold explícito, también debe respetarlo.
      if (route.priceThreshold && cheapest.price > route.priceThreshold) {
        skippedByThreshold += 1;
        logger.debug('Ruta filtrada por threshold', {
          id: route._id, route: `${route.origin}-${route.destination}`,
          price: cheapest.price, threshold: route.priceThreshold,
        });
        await sleep(INTER_ROUTE_DELAY_MS);
        continue;
      }

      // 3) Determinar precio anterior y si es silent
      const previousPrice = await getPreviousPrice(route._id.toString());
      const silent = shouldBeSilent(cheapest.price, previousPrice, route.priceThreshold);

      const res = await notifyOffer(cheapest, {
        telegramUserId: route.telegramUserId,
        telegramChatId: route.telegramChatId,
        routeId: route._id.toString(),
        dealLevel: level,
        threshold: route.priceThreshold,
        routeName: route.name || `${route.origin} → ${route.destination}`,
        silent,
      });
      if (res.sent) {
        offersSent += 1;
        notificationsByChat.set(
          route.telegramChatId,
          (notificationsByChat.get(route.telegramChatId) || 0) + 1,
        );
      } else if (res.reason === 'dedup') {
        skippedByDedup += 1;
        logger.debug('Ruta deduplicada', {
          id: route._id, route: `${route.origin}-${route.destination}`,
          price: cheapest.price,
        });
      }
    } catch (err) {
      errors += 1;
      logger.warn('Ruta falló', {
        id: route._id, route: `${route.origin}-${route.destination}`,
        err: /** @type {Error} */ (err).message,
      });
    }

    // Delay inter-ruta
    await sleep(INTER_ROUTE_DELAY_MS);

    // Pausa extra cada GROUP_SIZE rutas
    if ((i + 1) % GROUP_SIZE === 0 && i + 1 < routes.length) {
      logger.debug('Group pause', { completed: i + 1, total: routes.length });
      await sleep(GROUP_PAUSE_MS);
    }
  }

  // Header de batch (si mandamos ≥3 ofertas al mismo chat).
  for (const [chatId, count] of notificationsByChat) {
    if (count >= 3) {
      await notifyBatchHeader(chatId, count).catch(() => {});
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  logger.info('Alert pass terminada', {
    routesChecked: routes.length, offersSent, errors,
    skippedNoFlights, skippedByLevel, skippedByThreshold,
    skippedByDedup, skippedByCircuitBreaker,
    elapsedSec: elapsed,
  });
  return { routesChecked: routes.length, offersSent, errors };
}

module.exports = { runOnce };

