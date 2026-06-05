/**
 * Migración v3 — se corre sola en el boot, idempotente.
 *
 * Cambios:
 *   1) Upgrade del default histórico alertMinLevel='steal' al nuevo 'good'
 *      para todos los usuarios que nunca lo tocaron manualmente (quedaron
 *      con el antiguo default y por eso no recibían alertas nunca).
 *      No toca 'great' ni 'all' (decisiones manuales del user).
 *
 *   2) Alta masiva de alertas Argentina → Italia (cualquier aeropuerto
 *      italiano intl de pasajeros), one-way, fechas 2026-06-07 a 2026-06-10,
 *      con priceThreshold = €500. El alertEngine reconoce el threshold
 *      per-route y dispara aun si el par origen/destino no está tabulado
 *      en priceThresholds.js (ej. EZE→NAP).
 *
 *   3) Marca user.routesMigrationVersion = 3 cuando termina → no se
 *      repite en el próximo boot.
 *
 * El approach es el mismo que migrateRoutesV2: corre automáticamente en
 * `src/app.js` en cada boot de Render, sin necesidad de acceder al shell.
 *
 * @module bootstrap/migrateRoutesV3
 */

'use strict';

const User = require('../database/models/User');
const Route = require('../database/models/Route');
const logger = require('../utils/logger').child('migrateV3');

const TARGET_VERSION = 6;

// --- (1) Alert level upgrade --------------------------------------------
const OLD_DEFAULT_LEVEL = 'steal';
const NEW_DEFAULT_LEVEL = 'good';

// --- (2) Alertas Argentina → Italia, fechas dinámicas, ≤ €500 -------------------
const ITALY_ORIGINS = ['EZE', 'COR'];
/**
 * Aeropuertos italianos con tráfico internacional / conexiones intercont.
 * desde Argentina relevante. No incluye aeropuertos regionales sin IATA
 * activa para pasajeros desde Sudamérica.
 */
const ITALY_DESTS = [
  'FCO', // Roma Fiumicino
  'MXP', // Milán Malpensa
  'BGY', // Milán Bergamo (Ryanair hub)
  'VCE', // Venecia
  'BLQ', // Bolonia
  'NAP', // Nápoles
];
/** Fechas dinámicas: hoy + 7 a hoy + 14 días (siempre futuro) */
function generateItalyDates() {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  const end = new Date();
  end.setDate(end.getDate() + 14);
  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(cursor.toISOString().split('T')[0]);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
const ITALY_THRESHOLD_EUR = 500;

async function runMigration() {
  const users = await User.find({
    routesMigrationVersion: { $lt: TARGET_VERSION },
  }).lean();

  if (users.length === 0) {
    logger.info('Sin migraciones pendientes');
    return { migrated: 0 };
  }

  logger.info('Migrando usuarios a v3', { count: users.length });
  let migrated = 0;

  for (const u of users) {
    try {
      await migrateOneUser(u);
      await User.updateOne(
        { _id: u._id },
        { routesMigrationVersion: TARGET_VERSION },
      );
      migrated += 1;
    } catch (err) {
      logger.error(
        'Migración v3 falló para usuario',
        /** @type {Error} */ (err),
      );
    }
  }

  logger.info('Migración v3 completada', { migrated });
  return { migrated };
}

/** @param {{_id:any, telegramUserId:number, telegramChatId:number, alertMinLevel:string}} user */
async function migrateOneUser(user) {
  // (1) Upgrade alertMinLevel si sigue en el default viejo.
  if (user.alertMinLevel === OLD_DEFAULT_LEVEL) {
    await User.updateOne(
      { _id: user._id },
      { alertMinLevel: NEW_DEFAULT_LEVEL },
    );
    logger.info('alertMinLevel upgrade', {
      user: user.telegramUserId,
      from: OLD_DEFAULT_LEVEL,
      to: NEW_DEFAULT_LEVEL,
    });
  }

  // (2) Alertas Argentina → Italia, fechas dinámicas, ≤ €500.
  // Upsert por (telegramUserId, origin, destination, outboundDate).
  const italyDates = generateItalyDates();
  const ops = [];
  for (const origin of ITALY_ORIGINS) {
    for (const destination of ITALY_DESTS) {
      for (const dateIso of italyDates) {
        ops.push({
          updateOne: {
            filter: {
              telegramUserId: user.telegramUserId,
              origin,
              destination,
              outboundDate: new Date(dateIso),
            },
            update: {
              $set: {
                user: user._id,
                telegramChatId: user.telegramChatId,
                name: `${origin} → ${destination} (${dateIso}) ≤ €${ITALY_THRESHOLD_EUR}`,
                returnDate: null,
                tripType: 'oneway',
                currency: 'EUR',
                priceThreshold: ITALY_THRESHOLD_EUR,
                paused: false,
              },
            },
            upsert: true,
          },
        });
      }
    }
  }
  if (ops.length > 0) {
    const result = await Route.bulkWrite(ops, { ordered: false });
    logger.info('Italia jun 7-10 alertas upsert', {
      user: user.telegramUserId,
      upserted: result.upsertedCount || 0,
      modified: result.modifiedCount || 0,
      matched: result.matchedCount || 0,
      total: ops.length,
    });
  }
}

module.exports = { runMigration };
