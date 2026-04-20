/**
 * AlertEngine — monitor de fondo que recorre todas las rutas activas,
 * las consulta vía hybridSearch (modo background → scraper primero,
 * Amadeus como fallback) y dispara notificaciones para las ofertas que
 * cumplen el nivel mínimo de alerta del dueño de la ruta.
 *
 * Se ejecuta desde el cron de `src/app.js` (default cada 2h).
 *
 * @module services/alertEngine
 */

'use strict';

const routesRepo = require('../database/repositories/routesRepo');
const userPrefsRepo = require('../database/repositories/userPrefsRepo');
const hybrid = require('./hybridSearch');
const { classifyPrice } = require('../config/priceThresholds');
const { notifyOffer, notifyBatchHeader } = require('../bot/notifier');
const logger = require('../utils/logger').child('alertEngine');

/** Jerarquía de niveles: un nivel "n" pasa si ≤ al mínimo configurado. */
const LEVEL_RANK = { steal: 0, great: 1, good: 2, normal: 3, high: 4 };
const MIN_LEVEL_TO_RANK = { steal: 0, great: 1, good: 2, all: 4 };

/**
 * Corre una pasada completa de monitoreo.
 * @returns {Promise<{routesChecked: number, offersSent: number, errors: number}>}
 */
async function runOnce() {
  const started = Date.now();
  const routes = await routesRepo.listAllActive();
  logger.info('Alert pass iniciada', { routes: routes.length });

  const notificationsByChat = /** @type {Map<number, number>} */ (new Map());
  let offersSent = 0;
  let errors = 0;

  for (const route of routes) {
    try {
      const prefs = await userPrefsRepo.getOrCreate(
        route.telegram_user_id,
        route.telegram_chat_id,
      );
      const minRank = MIN_LEVEL_TO_RANK[prefs.alert_min_level] ?? 0;

      const result = await hybrid.search({
        origin: route.origin,
        destination: route.destination,
        departureDate: route.outbound_date,
        returnDate: route.return_date || undefined,
        currency: route.currency || prefs.currency,
        max: 5,
      }, { mode: 'background' });

      if (!result.flights?.length) continue;

      // Elegimos la oferta más barata por ruta/fecha para no spamear.
      const cheapest = result.flights.reduce((a, b) => (a.price <= b.price ? a : b));
      const { level } = classifyPrice(
        cheapest.origin, cheapest.destination,
        cheapest.price, cheapest.tripType,
      );
      const rank = LEVEL_RANK[level] ?? 99;

      // 1) Debe cumplir el nivel mínimo configurado por el usuario.
      if (rank > minRank) continue;

      // 2) Si la ruta tiene threshold explícito, también debe respetarlo.
      if (route.price_threshold && cheapest.price > route.price_threshold) continue;

      const res = await notifyOffer(cheapest, {
        telegramUserId: route.telegram_user_id,
        telegramChatId: route.telegram_chat_id,
        routeId: route.id,
        dealLevel: level,
        threshold: route.price_threshold,
        routeName: route.name || `${route.origin} → ${route.destination}`,
      });
      if (res.sent) {
        offersSent += 1;
        notificationsByChat.set(
          route.telegram_chat_id,
          (notificationsByChat.get(route.telegram_chat_id) || 0) + 1,
        );
      }
    } catch (err) {
      errors += 1;
      logger.warn('Ruta falló', {
        id: route.id, route: `${route.origin}-${route.destination}`,
        err: /** @type {Error} */ (err).message,
      });
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
    routesChecked: routes.length, offersSent, errors, elapsedSec: elapsed,
  });
  return { routesChecked: routes.length, offersSent, errors };
}

module.exports = { runOnce };
