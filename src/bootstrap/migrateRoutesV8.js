/**
 * migrateRoutesV8 — Alerta puntual pedida por Emilio: vuelos SOLO IDA Europa → Argentina
 * para una ventana concreta, con umbral propio. ADITIVA: no pausa ni borra rutas existentes
 * (las de V7 siguen). Solo upsertea (idempotente) las rutas de esta ventana.
 *
 *   Orígenes (EU): Madrid (MAD), Barcelona (BCN), Roma (FCO)
 *   Destinos (AR): Ezeiza (EZE), Córdoba (COR)
 *   Fechas: cada día de 2026-09-25 a 2026-10-20 (inclusive)
 *   Tipo: one-way · Umbral: ≤ €450
 *
 * @module bootstrap/migrateRoutesV8
 */

'use strict';

const User = require('../database/models/User');
const Route = require('../database/models/Route');
const logger = require('../utils/logger').child('migrateV8');

const TARGET_VERSION = 9;

const EU_ORIGINS = ['MAD', 'BCN', 'FCO'];   // Madrid, Barcelona, Roma (Fiumicino)
const AR_DESTS = ['EZE', 'COR'];            // Ezeiza (Buenos Aires), Córdoba
const THRESHOLD = 450;                      // EUR
const WINDOW_START = '2026-09-25';
const WINDOW_END = '2026-10-20';

function fmt(d) { return d.toISOString().split('T')[0]; }

/** Todas las fechas (inclusive) entre WINDOW_START y WINDOW_END. */
function windowDates() {
  const dates = [];
  const cursor = new Date(WINDOW_START + 'T00:00:00Z');
  const end = new Date(WINDOW_END + 'T00:00:00Z');
  while (cursor <= end) {
    dates.push(fmt(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function bulkUpsert(ops) {
  if (ops.length === 0) return { upserted: 0, modified: 0 };
  const CHUNK = 500;
  const total = { upserted: 0, modified: 0 };
  for (let i = 0; i < ops.length; i += CHUNK) {
    const chunk = ops.slice(i, i + CHUNK);
    const result = await Route.bulkWrite(chunk, { ordered: false });
    total.upserted += result.upsertedCount || 0;
    total.modified += result.modifiedCount || 0;
  }
  return total;
}

async function createWindowRoutes(user, dates) {
  const ops = [];
  for (const origin of EU_ORIGINS) {
    for (const dest of AR_DESTS) {
      for (const dateIso of dates) {
        ops.push({ updateOne: {
          filter: { telegramUserId: user.telegramUserId, origin, destination: dest, outboundDate: new Date(dateIso), tripType: 'oneway' },
          update: { $set: {
            user: user._id,
            telegramChatId: user.telegramChatId,
            name: origin + '→' + dest + ' OW ≤€' + THRESHOLD + ' (sep-oct 2026)',
            returnDate: null,
            tripType: 'oneway',
            currency: 'EUR',
            priceThreshold: THRESHOLD,
            paused: false,
          } },
          upsert: true,
        }});
      }
    }
  }
  return bulkUpsert(ops);
}

async function migrateOneUser(user) {
  const dates = windowDates();
  logger.info('Adding sep-oct 2026 EU→AR one-way alert window (v8)', {
    userId: user.telegramUserId, days: dates.length, origins: EU_ORIGINS, dests: AR_DESTS, threshold: THRESHOLD,
  });
  const res = await createWindowRoutes(user, dates);
  logger.info('V8 window routes upserted', res);
}

async function runMigration() {
  const users = await User.find({ routesMigrationVersion: { $lt: TARGET_VERSION } }).lean();
  const all = users.length ? users : await User.find({}).lean();
  if (all.length === 0) {
    logger.info('No users found, skip migrateV8');
    return { migrated: 0 };
  }
  let migrated = 0;
  for (const u of all) {
    try {
      await migrateOneUser(u);
      await User.updateOne({ _id: u._id }, { routesMigrationVersion: TARGET_VERSION });
      migrated += 1;
    } catch (err) {
      logger.error('migrateV8 failed for user', err);
    }
  }
  logger.info('migrateV8 completed', { migrated });
  return { migrated };
}

module.exports = { runMigration };
