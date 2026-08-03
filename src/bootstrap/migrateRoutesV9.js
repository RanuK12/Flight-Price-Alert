/**
 * migrateRoutesV9 — Reconfiguración de alertas por pedido del usuario:
 *
 * 1. Purga TODAS las rutas anteriores (activas y pausadas).
 * 2. Configura alertas:
 *    • SOLO IDA (outbound 15-22 sep 2026, vuelta 3-10 nov 2026) ≤ €400
 *    • IDA Y VUELTA (Roundtrip outbound 15-22 sep 2026 & return 3-10 nov 2026) ≤ €800
 *
 * Aeropuertos EU: Venecia (VCE), Roma (FCO), Madrid (MAD), Barcelona (BCN)
 * Aeropuertos AR: Ezeiza (EZE), Córdoba (COR)
 *
 * @module bootstrap/migrateRoutesV9
 */

'use strict';

const User = require('../database/models/User');
const Route = require('../database/models/Route');
const logger = require('../utils/logger').child('migrateV9');

const TARGET_VERSION = 10;

const EU_AIRPORTS = ['VCE', 'FCO', 'MAD', 'BCN'];
const AR_AIRPORTS = ['EZE', 'COR'];

const OW_THRESHOLD = 400; // EUR per leg
const RT_THRESHOLD = 800; // EUR total roundtrip

// Fechas Ida: 15 sep al 22 sep 2026
const OUTBOUND_DATES = [
  '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18',
  '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22',
];

// Fechas Vuelta: 3 nov al 10 nov 2026
const RETURN_DATES = [
  '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
  '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10',
];

async function purgeAllRoutes(user) {
  const result = await Route.deleteMany({ telegramUserId: user.telegramUserId });
  logger.info('Purged all existing routes for user', {
    userId: user.telegramUserId,
    deletedCount: result.deletedCount || 0,
  });
  return result.deletedCount || 0;
}

async function createCustomRoutes(user) {
  const ops = [];

  // 1. Rutas SOLO IDA: EU → AR (15 - 22 Sep 2026)
  for (const origin of EU_AIRPORTS) {
    for (const dest of AR_AIRPORTS) {
      for (const dateIso of OUTBOUND_DATES) {
        ops.push({
          updateOne: {
            filter: {
              telegramUserId: user.telegramUserId,
              origin,
              destination: dest,
              outboundDate: new Date(dateIso),
              tripType: 'oneway',
            },
            update: {
              $set: {
                user: user._id,
                telegramChatId: user.telegramChatId,
                name: `${origin}→${dest} IDA OW ≤€${OW_THRESHOLD} (15-22 sep 2026)`,
                returnDate: null,
                tripType: 'oneway',
                currency: 'EUR',
                priceThreshold: OW_THRESHOLD,
                paused: false,
              },
            },
            upsert: true,
          },
        });
      }
    }
  }

  // 2. Rutas SOLO IDA: AR → EU (3 - 10 Nov 2026)
  for (const origin of AR_AIRPORTS) {
    for (const dest of EU_AIRPORTS) {
      for (const dateIso of RETURN_DATES) {
        ops.push({
          updateOne: {
            filter: {
              telegramUserId: user.telegramUserId,
              origin,
              destination: dest,
              outboundDate: new Date(dateIso),
              tripType: 'oneway',
            },
            update: {
              $set: {
                user: user._id,
                telegramChatId: user.telegramChatId,
                name: `${origin}→${dest} VUELTA OW ≤€${OW_THRESHOLD} (3-10 nov 2026)`,
                returnDate: null,
                tripType: 'oneway',
                currency: 'EUR',
                priceThreshold: OW_THRESHOLD,
                paused: false,
              },
            },
            upsert: true,
          },
        });
      }
    }
  }

  // 3. Rutas IDA Y VUELTA (Roundtrip): EU → AR → EU (Outbound Sep 15-22, Return Nov 3-10)
  for (const origin of EU_AIRPORTS) {
    for (const dest of AR_AIRPORTS) {
      for (const outDate of OUTBOUND_DATES) {
        for (const retDate of RETURN_DATES) {
          ops.push({
            updateOne: {
              filter: {
                telegramUserId: user.telegramUserId,
                origin,
                destination: dest,
                outboundDate: new Date(outDate),
                returnDate: new Date(retDate),
                tripType: 'roundtrip',
              },
              update: {
                $set: {
                  user: user._id,
                  telegramChatId: user.telegramChatId,
                  name: `${origin}↔${dest} RT ≤€${RT_THRESHOLD} (${outDate} / ${retDate})`,
                  returnDate: new Date(retDate),
                  tripType: 'roundtrip',
                  currency: 'EUR',
                  priceThreshold: RT_THRESHOLD,
                  paused: false,
                },
              },
              upsert: true,
            },
          });
        }
      }
    }
  }

  if (ops.length === 0) return { upserted: 0, modified: 0 };

  const CHUNK = 500;
  let total = { upserted: 0, modified: 0 };
  for (let i = 0; i < ops.length; i += CHUNK) {
    const chunk = ops.slice(i, i + CHUNK);
    const result = await Route.bulkWrite(chunk, { ordered: false });
    total.upserted += result.upsertedCount || 0;
    total.modified += result.modifiedCount || 0;
  }
  return total;
}

async function migrateOneUser(user) {
  logger.info('Running V9 route reconfiguration (One-way + Roundtrip)', { userId: user.telegramUserId });

  // 1. Purga total de rutas anteriores
  await purgeAllRoutes(user);

  // 2. Creación de las rutas (128 solo ida + 512 ida y vuelta)
  const res = await createCustomRoutes(user);
  logger.info('V9 custom routes created', res);
}

async function runMigration() {
  // Sólo usuarios por debajo de la versión objetivo. El fallback anterior
  // ("si no hay ninguno, correr sobre TODOS") hacía que esta migración
  // purgara y recreara las rutas en CADA arranque, con lo cual cualquier
  // ruta agregada después desaparecía al reiniciar Render.
  const all = await User.find({ routesMigrationVersion: { $lt: TARGET_VERSION } }).lean();
  if (all.length === 0) {
    logger.info('Todos los usuarios ya están en V9, skip');
    return { migrated: 0 };
  }

  let migrated = 0;
  for (const u of all) {
    try {
      await migrateOneUser(u);
      await User.updateOne({ _id: u._id }, { routesMigrationVersion: TARGET_VERSION });
      migrated += 1;
    } catch (err) {
      logger.error('migrateV9 failed for user', err);
    }
  }
  logger.info('migrateV9 completed', { migrated });
  return { migrated };
}

module.exports = { runMigration };
