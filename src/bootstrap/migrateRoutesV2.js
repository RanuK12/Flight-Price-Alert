/**
 * Migración idempotente v2 — aplicar cambios de configuración pedidos
 * por el usuario sobre rutas ya seeded:
 *
 *   1) Thresholds Europa → €470 steal en TODAS las rutas EZE/COR → Europa.
 *   2) Reemplazar bucket COR↔MDQ con ventana fija 2026-05-06 → 2026-05-20
 *      (hasta 8 pares ida+vuelta 7d donde la vuelta también cae dentro
 *      del rango).
 *
 * Idempotente: marca user.routesMigrationVersion = 2 cuando termina.
 *
 * @module bootstrap/migrateRoutesV2
 */

'use strict';

const User = require('../database/models/User');
const Route = require('../database/models/Route');
const logger = require('../utils/logger').child('migrateV2');

const TARGET_VERSION = 2;

const EUROPE_DESTS = ['MAD', 'BCN', 'FCO', 'MXP'];
const ARGENTINA_ORIGINS = ['EZE', 'COR'];
const NEW_EUROPE_STEAL = 470;

const MDQ_START = '2026-05-06';
const MDQ_END = '2026-05-20';
const MDQ_TRIP_DAYS = 7;

/** @param {Date} d */
function fmt(d) { return d.toISOString().split('T')[0]; }

/**
 * Pares ida/vuelta 7d donde AMBOS extremos caen dentro del rango.
 * @param {string} startIso @param {string} endIso @param {number} tripDays
 */
function pairsWithinWindow(startIso, endIso, tripDays) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const pairs = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const ret = new Date(cursor);
    ret.setDate(ret.getDate() + tripDays);
    if (ret <= end) pairs.push({ outbound: fmt(cursor), ret: fmt(ret) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return pairs;
}

async function runMigration() {
  const users = await User.find({ routesMigrationVersion: { $lt: TARGET_VERSION } }).lean();
  if (users.length === 0) {
    logger.info('Sin migraciones pendientes');
    return { migrated: 0 };
  }

  logger.info('Migrando usuarios a v2', { count: users.length });
  let migrated = 0;

  for (const u of users) {
    try {
      await migrateOneUser(u);
      await User.updateOne({ _id: u._id }, { routesMigrationVersion: TARGET_VERSION });
      migrated += 1;
    } catch (err) {
      logger.error('Migración v2 falló para usuario', /** @type {Error} */ (err));
    }
  }

  logger.info('Migración v2 completada', { migrated });
  return { migrated };
}

/** @param {{telegramUserId:number, telegramChatId:number}} user */
async function migrateOneUser(user) {
  // 1) Actualizar threshold Europa → 470 (cualquier OW EZE/COR → MAD/BCN/FCO/MXP).
  const europeUpdate = await Route.updateMany(
    {
      telegramUserId: user.telegramUserId,
      tripType: 'oneway',
      origin: { $in: ARGENTINA_ORIGINS },
      destination: { $in: EUROPE_DESTS },
    },
    { $set: { priceThreshold: NEW_EUROPE_STEAL } },
  );
  logger.info('Europa thresholds actualizados', {
    user: user.telegramUserId, modified: europeUpdate.modifiedCount,
  });

  // 2) Reemplazar COR↔MDQ con ventana fija.
  const deleted = await Route.deleteMany({
    telegramUserId: user.telegramUserId,
    tripType: 'roundtrip',
    $or: [
      { origin: 'COR', destination: 'MDQ' },
      { origin: 'MDQ', destination: 'COR' },
    ],
  });
  logger.info('COR↔MDQ rutas viejas eliminadas', {
    user: user.telegramUserId, deleted: deleted.deletedCount,
  });

  const pairs = pairsWithinWindow(MDQ_START, MDQ_END, MDQ_TRIP_DAYS);
  const docs = [];
  for (const { outbound, ret } of pairs) {
    for (const [origin, destination] of [['COR', 'MDQ'], ['MDQ', 'COR']]) {
      docs.push({
        telegramUserId: user.telegramUserId,
        telegramChatId: user.telegramChatId,
        name: `${origin}→${destination} (RT ${outbound}/${ret})`,
        origin, destination,
        outboundDate: new Date(outbound),
        returnDate: new Date(ret),
        tripType: 'roundtrip',
        currency: 'EUR',
        priceThreshold: 65, // steal RT COR↔MDQ
        paused: false,
      });
    }
  }
  if (docs.length > 0) {
    await Route.insertMany(docs, { ordered: false });
    logger.info('COR↔MDQ rutas nuevas insertadas', {
      user: user.telegramUserId, inserted: docs.length, pairs: pairs.length,
    });
  }
}

module.exports = { runMigration };
