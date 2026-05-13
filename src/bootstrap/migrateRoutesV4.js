/**
 * migrateRoutesV4 — Seed de alertas Argentina → España jun 7-10, ≤ €550.
 *
 * Complementa migrateRoutesV3 (Italia jun 7-10 ≤ €500) cubriendo los
 * destinos españoles que el usuario pidió explícitamente:
 *
 *   Orígenes: EZE (Buenos Aires), COR (Córdoba)
 *   Destinos: MAD (Madrid), BCN (Barcelona)
 *   Fechas:   2026-06-07, 08, 09, 10
 *   Threshold: €550 EUR (one-way)
 *
 * Idempotente: routesRepo.createRoute hace upsert por
 * (telegramUserId, origin, destination, outboundDate, tripType).
 * Correrlo N veces es seguro.
 *
 * Se ejecuta en el boot desde src/app.js, después de migrateRoutesV3.
 *
 * @module bootstrap/migrateRoutesV4
 */

'use strict';

const routesRepo = require('../database/repositories/routesRepo');
const userPrefsRepo = require('../database/repositories/userPrefsRepo');
const User = require('../database/models/User');
const logger = require('../utils/logger').child('migrateV4');

// --- Alertas Argentina → España, jun 7-10, ≤ €550 -----------------------
const SPAIN_ORIGINS = ['EZE', 'COR'];
const SPAIN_DESTS = ['MAD', 'BCN'];
const SPAIN_DATES = ['2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10'];
const SPAIN_THRESHOLD_EUR = 550;

/**
 * @returns {Promise<void>}
 */
async function runMigration() {
  const users = await User.find({}, { telegramUserId: 1, telegramChatId: 1 }).lean();
  if (users.length === 0) {
    logger.info('No users found, skip migrateV4');
    return;
  }

  let totalCreated = 0;
  let totalErrors = 0;

  for (const user of users) {
    const userId = user.telegramUserId;
    const chatId = user.telegramChatId || userId;

    // Asegurar prefs
    await userPrefsRepo.getOrCreate(userId, chatId);

    for (const origin of SPAIN_ORIGINS) {
      for (const dest of SPAIN_DESTS) {
        for (const date of SPAIN_DATES) {
          try {
            await routesRepo.createRoute({
              telegramUserId: userId,
              telegramChatId: chatId,
              name: `${origin} → ${dest} (${date}) ≤ €${SPAIN_THRESHOLD_EUR}`,
              origin,
              destination: dest,
              outboundDate: date,
              returnDate: null,
              tripType: 'oneway',
              currency: 'EUR',
              priceThreshold: SPAIN_THRESHOLD_EUR,
            });
            totalCreated += 1;
          } catch (err) {
            totalErrors += 1;
            logger.warn('migrateV4 route upsert failed', {
              userId, origin, dest, date,
              err: /** @type {Error} */ (err).message,
            });
          }
        }
      }
    }
  }

  logger.info('migrateV4 complete (Argentina → España jun 7-10 ≤ €550)', {
    users: users.length,
    routesProcessed: totalCreated,
    errors: totalErrors,
    expected: users.length * SPAIN_ORIGINS.length * SPAIN_DESTS.length * SPAIN_DATES.length,
  });
}

module.exports = { runMigration };
