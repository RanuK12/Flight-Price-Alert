/**
 * AlertEngine — monitor de fondo que recorre un subset de rutas activas,
 * las consulta vía hybridSearch (modo background → scraper primero,
 * Amadeus como fallback) y dispara notificaciones para las ofertas que
 * cumplen el nivel mínimo de alerta del dueño de la ruta.
 *
 * Se ejecuta desde el cron de `src/app.js` (default cada 2h).
 *
 * v4.2 — Auto-cleanup + dedup mejorado:
 *   • Auto-pause de rutas con outboundDate pasado (limpieza en cada pasada).
 *   • Elimina rutas vencidas de MongoDB periódicamente.
 *   • Dedup window: 7 días para one-way (evita repetir ofertas viejas).
 *   • Sampling: máx 35 rutas por pasada (rotación).
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
const { toEur } = require('../utils/currency');
const { notifyOffer, notifyBatchHeader } = require('../bot/notifier');
const logger = require('../utils/logger').child('alertEngine');

/** Jerarquía de niveles: un nivel "n" pasa si ≤ al mínimo configurado. */
const LEVEL_RANK = { steal: 0, great: 1, good: 2, normal: 3, high: 4 };
const MIN_LEVEL_TO_RANK = { steal: 0, great: 1, good: 2, all: 4 };

/** Máximo de rutas a consultar por pasada (expandido para v7 ~18K rutas). */
const MAX_ROUTES_PER_PASS = 60;

/** Límite de alertas para tier free (3 alertas por usuario). */
const FREE_TIER_ALERT_LIMIT = 3;

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
 * Pausa y elimina rutas cuyo outboundDate ya pasó (auto-cleanup).
 * Se ejecuta al inicio de cada pasada del alertEngine.
 * @returns {Promise<{paused: number, deleted: number}>}
 */
async function autoCleanupPastRoutes() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const Route = require('../database/models/Route');

  // 1. Pausar rutas con fecha de hoy o pasada que estén activas
  const pauseResult = await Route.updateMany(
    { outboundDate: { $lte: today }, paused: false },
    { paused: true },
  );

  // 2. Eliminar rutas con fecha pasada hace >3 días (ya no sirven para nada)
  const graceDate = new Date(today);
  graceDate.setDate(graceDate.getDate() - 3);
  const deleteResult = await Route.deleteMany({
    outboundDate: { $ne: null, $lt: graceDate },
  });

  if (pauseResult.modifiedCount > 0 || deleteResult.deletedCount > 0) {
    logger.info('Auto-cleanup rutas pasadas', {
      paused: pauseResult.modifiedCount,
      deleted: deleteResult.deletedCount,
    });
  }

  return {
    paused: pauseResult.modifiedCount,
    deleted: deleteResult.deletedCount,
  };
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
    const iso = r.outboundDate.toISOString().split('T')[0];
    return iso >= today;
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

  // Auto-limpieza: pausar/eliminar rutas vencidas antes de buscar
  const cleanup = await autoCleanupPastRoutes().catch(err => {
    logger.warn('auto-cleanup falló (continuando)', { err: err.message });
    return { paused: 0, deleted: 0 };
  });

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

    // Free tier: contar alertas del usuario en los últimos 30 días
    if (route.tier === 'free') {
      const recentAlerts = await Notification.countDocuments({
        telegramUserId: route.telegramUserId,
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });
      if (recentAlerts >= FREE_TIER_ALERT_LIMIT) {
        logger.info('Free tier limit reached — skipping alert', { telegramUserId: route.telegramUserId, recentAlerts });
        await notifyOffer(route.telegramUserId, route.telegramChatId, {
          route,
          offer: null,
          isUpgradePrompt: true,
        });
        skippedByThreshold++;
        continue; // Saltar al siguiente ciclo
      }
    }

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


    // SANITY FLOOR universal (cualquier provider). Filtra precios obviamente
    // falsos del scraper (bug parser Google Flights NEW FORMAT que retornaba
    // duración como precio: $155 EZE→BCN Turkish "directo").
    // Floors basados en mínimo histórico realista por distancia.
    const isLongHaul = ['MAD','BCN','SVQ','VLC','BIO','FCO','MXP','NAP','VCE','BGY',
      'CDG','ORY','NCE','LYS','LHR','LGW','STN','DUB','AMS','BRU',
      'FRA','MUC','BER','DUS','HAM','LIS','OPO','VIE','ZRH','ATH','IST']
      .includes(cheapest.destination) ||
      ['EZE','COR','MDQ','ROS','BUE'].includes(cheapest.origin);
    const minFloor = isLongHaul
      ? (cheapest.tripType === 'roundtrip' ? 500 : 350)  // EUR/USD
      : 30;  // doméstico/regional
    if (cheapest.price < minFloor) {
      logger.warn('Precio sospechoso bajo floor, skip', {
        route: cheapest.origin + '-' + cheapest.destination,
        price: cheapest.price, source: cheapest.source,
        floor: minFloor, tripType: cheapest.tripType,
      });
      skippedNoFlights += 1;
      await sleep(INTER_ROUTE_DELAY_MS);
      continue;
    }

    // CROSS-VALIDATE steals scraper con Amadeus pricing.
    // Si scraper dice "ofertón" pero Amadeus oficial difiere mucho, usar Amadeus.
    if (cheapest.source !== 'amadeus' && cheapest.price < (isLongHaul ? 450 : 80)) {
      try {
        const amadeus = require('../providers/amadeus');
        const amadeusResult = await amadeus.offers.searchFlights({
          origin: cheapest.origin,
          destination: cheapest.destination,
          departureDate: cheapest.departureDate,
          returnDate: cheapest.returnDate || undefined,
          currency: cheapest.currency || 'EUR',
          max: 1,
        });
        const amaPrice = amadeusResult?.flights?.[0]?.price;
        if (amaPrice && Math.abs(amaPrice - cheapest.price) / amaPrice > 0.4) {
          logger.warn('Steal scraper rechazado: Amadeus difiere >40%', {
            route: cheapest.origin + '-' + cheapest.destination,
            scraper: cheapest.price, amadeus: amaPrice,
          });
          skippedNoFlights += 1;
          await sleep(INTER_ROUTE_DELAY_MS);
          continue;
        }
      } catch (err) {
        logger.warn('Cross-validate Amadeus falló (continuando)', { err: err.message });
      }
    }
          // Convertir precio del scraper a EUR antes de clasificar.
      // Google Flights suele devolver USD aunque pidamos EUR, y los
      // thresholds están SIEMPRE en EUR (ver priceThresholds.js).
      // Sin esta conversión, un vuelo EZE→FCO a $755 USD (≈€695) se
      // comparaba contra threshold.typical=700 EUR y era clasificado
      // como "high", bloqueando toda notificación (skippedByLevel).
      const priceEur = toEur(cheapest.price, cheapest.currency || 'EUR');
      let { level } = classifyPrice(
        cheapest.origin, cheapest.destination,
        priceEur, cheapest.tripType,
      );

      // Si la ruta tiene priceThreshold explícito (seteado por el usuario
      // en /nueva_alerta o en scripts de seed), el threshold manda. Esto
      // cubre rutas que NO están en priceThresholds.js (ej. EZE→VCE,
      // EZE→NAP, destinos ad-hoc): sin esta lógica, level queda en
      // 'normal' por defecto y con alert_min_level='good' se filtra,
      // ignorando el threshold que el usuario pidió explícitamente.
      // IMPORTANTE: route.priceThreshold está en la moneda de la ruta
      // (route.currency, default 'EUR'). cheapest.price viene del scraper
      // (Google Flights suele responder USD aun pidiendo EUR). Comparar
      // crudo provocaba falsos "por encima del threshold":
      // un vuelo a $540 USD (≈€497) contra threshold €500 da "540 > 500"
      // y se filtraba aunque en EUR sí cumplía. Bug silencioso desde el
      // seed de alertas Italia jun 7-10 (€500). Convertimos a la moneda
      // del threshold antes de comparar.
      const routeCurrency = (route.currency || 'EUR').toUpperCase();
      const priceInThresholdCcy = routeCurrency === 'EUR'
        ? priceEur
        : toEur(cheapest.price, cheapest.currency || 'EUR'); // fallback: EUR como pivot
      if (route.priceThreshold && priceInThresholdCcy <= route.priceThreshold) {
        // Precio cumple threshold → promovemos a 'great' para que pase
        // cualquier filtro >= good. Si ya era steal lo respetamos.
        if (LEVEL_RANK[level] > LEVEL_RANK.great) level = 'great';
      }
      const rank = LEVEL_RANK[level] ?? 99;

      // 1) Debe cumplir el nivel mínimo configurado por el usuario.
      let flightToNotify = cheapest;
    // CONFIRMAR con Amadeus Pricing API - link exacto del booking
    if (cheapest.source === 'amadeus' && cheapest.raw) {
      try {
        const amadeus = require('../providers/amadeus');
        const pricing = await amadeus.pricing.confirmOffer(cheapest.raw);
        if (pricing.confirmed && pricing.confirmedPrice) {
          flightToNotify = { ...cheapest, price: pricing.confirmedPrice };
          logger.info('Amadeus pricing confirmo', { route: cheapest.origin + '-' + cheapest.destination, original: cheapest.price, confirmed: pricing.confirmedPrice });
        }
      } catch (err) {
        logger.warn('Error pricing confirm', { error: err.message });
      }
    }
    if (rank > minRank) {
        skippedByLevel += 1;
        logger.info('Ruta filtrada por nivel (precio por encima del mínimo configurado)', {
          id: route._id, route: `${route.origin}-${route.destination}`,
          date: route.outboundDate,
          priceRaw: cheapest.price, currency: cheapest.currency || 'EUR',
          priceEur, level, rank,
          minLevel: prefs.alert_min_level, minRank,
        });
        await sleep(INTER_ROUTE_DELAY_MS);
        continue;
      }

      // 2) Si la ruta tiene threshold explícito, también debe respetarlo.
      // Comparamos en la moneda del threshold (ver nota de conversión
      // más arriba). Sin esta conversión, un vuelo a $540 USD (≈€497)
      // contra threshold €500 se filtraba por "540 > 500".
      if (route.priceThreshold && priceInThresholdCcy > route.priceThreshold) {
        skippedByThreshold += 1;
        logger.debug('Ruta filtrada por threshold', {
          id: route._id, route: `${route.origin}-${route.destination}`,
          priceRaw: cheapest.price, currency: cheapest.currency || 'EUR',
          priceInThresholdCcy, threshold: route.priceThreshold,
          thresholdCcy: routeCurrency,
        });
        await sleep(INTER_ROUTE_DELAY_MS);
        continue;
      }

      // 3) Determinar precio anterior y si es silent
      const previousPrice = await getPreviousPrice(route._id.toString());
      const silent = shouldBeSilent(cheapest.price, previousPrice, route.priceThreshold);

      const res = await notifyOffer(flightToNotify, {
        telegramUserId: route.telegramUserId,
        telegramChatId: route.telegramChatId,
        routeId: route._id.toString(),
        dealLevel: level,
        threshold: route.priceThreshold,
        thresholdCurrency: route.currency || prefs.currency || 'EUR',
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
    cleanupPaused: cleanup.paused,
    cleanupDeleted: cleanup.deleted,
    elapsedSec: elapsed,
  });
  return { routesChecked: routes.length, offersSent, errors };
}

module.exports = { runOnce };

