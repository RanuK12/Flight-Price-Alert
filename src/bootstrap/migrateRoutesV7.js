/**
 * migrateRoutesV7 — Seed de alertas ROUNDTRIP Argentina → Europa,
 * salidas julio-octubre 2026, estadía ~15 días, ≤ €850.
 *
 * Pedido del usuario: "Otra alerta ida y vuelta de Argentina a Europa,
 * abajo de 850 euros la alerta, para julio/agosto/septiembre/octubre,
 * más o menos 15 días."
 *
 * Cobertura:
 *   • Orígenes AR: EZE Buenos Aires-Ezeiza, COR Córdoba.
 *   • Destinos europeos: MAD, BCN, FCO, MXP, CDG, AMS, LIS (los 7
 *     hubs con tráfico significativo desde Argentina).
 *   • Fechas de salida: día 1 y 15 de cada mes jul-oct (8 fechas):
 *       2026-07-01, 07-15, 08-01, 08-15,
 *       2026-09-01, 09-15, 10-01, 10-15.
 *   • Vuelta: 15 días después de la salida.
 *
 * Total: 2 × 7 × 8 = 112 rutas roundtrip, threshold €850.
 *
 * Idempotente: routesRepo.createRoute hace upsert por
 * (telegramUserId, origin, destination, outboundDate). El tripType NO
 * está en el filtro: este seed es seguro porque V6 (EU→AR oneway) y
 * V7 (AR→EU roundtrip) tienen pares origin/destination invertidos, así
 * que nunca colisionan.
 *
 * Se ejecuta en el boot desde src/app.js, después de migrateRoutesV6.
 *
 * @module bootstrap/migrateRoutesV7
 */

'use strict';

const routesRepo = require('../database/repositories/routesRepo');
const userPrefsRepo = require('../database/repositories/userPrefsRepo');
const User = require('../database/models/User');
const logger = require('../utils/logger').child('migrateV7');

// --- Alertas Argentina ↔ Europa, jul-oct 2026, ≤ €850 -------------------
const AR_ORIGINS = ['EZE', 'COR'];
const EU_DESTS = ['MAD', 'BCN', 'FCO', 'MXP', 'CDG', 'AMS', 'LIS'];
const OUTBOUND_DATES = [
  '2026-07-01', '2026-07-15',
  '2026-08-01', '2026-08-15',
  '2026-09-01', '2026-09-15',
  '2026-10-01', '2026-10-15',
];
const RETURN_OFFSET_DAYS = 15;
const THRESHOLD_EUR = 850;

/**
 * Suma N días a una fecha YYYY-MM-DD usando UTC para evitar saltos
 * por DST. Devuelve YYYY-MM-DD.
 * @param {string} dateStr
 * @param {number} days
 */
function addDaysISO(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * @returns {Promise<void>}
 */
async function runMigration() {
  const users = await User.find({}, { telegramUserId: 1, telegramChatId: 1 }).lean();
  if (users.length === 0) {
    logger.info('No users found, skip migrateV7');
    return;
  }

  let totalCreated = 0;
  let totalErrors = 0;

  for (const user of users) {
    const userId = user.telegramUserId;
    const chatId = user.telegramChatId || userId;

    await userPrefsRepo.getOrCreate(userId, chatId);

    for (const origin of AR_ORIGINS) {
      for (const dest of EU_DESTS) {
        for (const date of OUTBOUND_DATES) {
          const returnDate = addDaysISO(date, RETURN_OFFSET_DAYS);
          try {
            await routesRepo.createRoute({
              telegramUserId: userId,
              telegramChatId: chatId,
              name: `${origin} ↔ ${dest} (${date} → ${returnDate}) ≤ €${THRESHOLD_EUR}`,
              origin,
              destination: dest,
              outboundDate: date,
              returnDate,
              tripType: 'roundtrip',
              currency: 'EUR',
              priceThreshold: THRESHOLD_EUR,
            });
            totalCreated += 1;
          } catch (err) {
            totalErrors += 1;
            logger.warn('migrateV7 route upsert failed', {
              userId, origin, dest, date,
              err: /** @type {Error} */ (err).message,
            });
          }
        }
      }
    }
  }

  logger.info('migrateV7 complete (Argentina ↔ Europa jul-oct 2026 RT 15d ≤ €850)', {
    users: users.length,
    routesProcessed: totalCreated,
    errors: totalErrors,
    expected: users.length * AR_ORIGINS.length * EU_DESTS.length * OUTBOUND_DATES.length,
  });
}

module.exports = { runMigration };
