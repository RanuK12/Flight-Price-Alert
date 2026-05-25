/**
 * migrateRoutesV6 — Seed de alertas Europa → Argentina, oct-nov 2026, ≤ €350.
 *
 * Pedido del usuario: "Alertas de Europa a Argentina para octubre/noviembre,
 * solo ida, abajo de 350 euros."
 *
 * Cobertura:
 *   • Orígenes europeos (hubs principales con vuelos directos a AR):
 *       MAD Madrid, BCN Barcelona, FCO Roma, MXP Milán, CDG París,
 *       LHR Londres, FRA Frankfurt, AMS Ámsterdam, LIS Lisboa.
 *   • Destinos AR:
 *       EZE Buenos Aires-Ezeiza, AEP Aeroparque, COR Córdoba.
 *   • Fechas: 7 puntos a lo largo de oct-nov (cada ~10 días) para tener
 *     buena cobertura sin saturar el cron de monitoreo:
 *       2026-10-01, 10-11, 10-21, 10-31,
 *       2026-11-10, 11-20, 11-30.
 *
 * Total: 9 × 3 × 7 = 189 rutas oneway, threshold €350.
 *
 * Idempotente: routesRepo.createRoute hace upsert por
 * (telegramUserId, origin, destination, outboundDate). El tripType NO
 * está en el filtro: este seed es seguro porque V6 (EU→AR oneway) y
 * V7 (AR→EU roundtrip) no comparten pares (origin, destination), pero
 * cuidado al agregar futuros seeds que sí los compartan.
 *
 * Se ejecuta en el boot desde src/app.js, después de migrateRoutesV5.
 *
 * @module bootstrap/migrateRoutesV6
 */

'use strict';

const routesRepo = require('../database/repositories/routesRepo');
const userPrefsRepo = require('../database/repositories/userPrefsRepo');
const User = require('../database/models/User');
const logger = require('../utils/logger').child('migrateV6');

// --- Alertas Europa → Argentina, oct-nov 2026, ≤ €350 -------------------
const EU_ORIGINS = ['MAD', 'BCN', 'FCO', 'MXP', 'CDG', 'LHR', 'FRA', 'AMS', 'LIS'];
const AR_DESTS = ['EZE', 'AEP', 'COR'];
const DATES = [
  '2026-10-01', '2026-10-11', '2026-10-21', '2026-10-31',
  '2026-11-10', '2026-11-20', '2026-11-30',
];
const THRESHOLD_EUR = 350;

/**
 * @returns {Promise<void>}
 */
async function runMigration() {
  const users = await User.find({}, { telegramUserId: 1, telegramChatId: 1 }).lean();
  if (users.length === 0) {
    logger.info('No users found, skip migrateV6');
    return;
  }

  let totalCreated = 0;
  let totalErrors = 0;

  for (const user of users) {
    const userId = user.telegramUserId;
    const chatId = user.telegramChatId || userId;

    await userPrefsRepo.getOrCreate(userId, chatId);

    for (const origin of EU_ORIGINS) {
      for (const dest of AR_DESTS) {
        for (const date of DATES) {
          try {
            await routesRepo.createRoute({
              telegramUserId: userId,
              telegramChatId: chatId,
              name: `${origin} → ${dest} (${date}) ≤ €${THRESHOLD_EUR}`,
              origin,
              destination: dest,
              outboundDate: date,
              returnDate: null,
              tripType: 'oneway',
              currency: 'EUR',
              priceThreshold: THRESHOLD_EUR,
            });
            totalCreated += 1;
          } catch (err) {
            totalErrors += 1;
            logger.warn('migrateV6 route upsert failed', {
              userId, origin, dest, date,
              err: /** @type {Error} */ (err).message,
            });
          }
        }
      }
    }
  }

  logger.info('migrateV6 complete (Europa → Argentina oct-nov 2026 ≤ €350)', {
    users: users.length,
    routesProcessed: totalCreated,
    errors: totalErrors,
    expected: users.length * EU_ORIGINS.length * AR_DESTS.length * DATES.length,
  });
}

module.exports = { runMigration };
