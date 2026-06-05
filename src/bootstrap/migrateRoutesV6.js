/**
 * migrateRoutesV6 — Estrategia global AR ↔ EU, todo el año.
 *
 * Crea rutas de monitoreo para CADA par (origen AR × destino EU) y viceversa,
 * cubriendo 12 meses (Jun 2026 → Jun 2027) con sampling inteligente:
 *
 *   • ONE-WAY AR→EU: 4 orígenes × 10 destinos = 40 pares
 *     × 2 fechas/mes × 12 meses = 960 rutas, threshold ≤ €500
 *
 *   • ONE-WAY EU→AR: 10 orígenes × 4 destinos = 40 pares
 *     × 2 fechas/mes × 12 meses = 960 rutas, threshold ≤ €400
 *
 *   • ROUNDTRIP AR↔EU: 40 pares
 *     × 2 fechas/mes × 12 meses = 960 rutas, threshold ≤ €800
 *
 *   TOTAL: ~2,880 rutas (gestionables con MAX_ROUTES_PER_PASS=50)
 *
 * Fechas de sample: 1° y 15° de cada mes (Martes/Miércoles priorizados
 * cuando caen en weekday — los martes/miércoles suelen ser más baratos).
 *
 * Idempotente: upsert por (telegramUserId, origin, destination, outboundDate).
 * Correrlo N veces es seguro.
 *
 * Se ejecuta en boot desde src/app.js (después de V3-V5).
 *
 * @module bootstrap/migrateRoutesV6
 */

'use strict';

const User = require('../database/models/User');
const Route = require('../database/models/Route');
const logger = require('../utils/logger').child('migrateV6');

const TARGET_VERSION = 7;

// ── Configuración de aeropuertos ────────────────────────
const AR_ORIGINS = ['EZE', 'COR', 'MDQ', 'ROS'];
const EU_DESTS   = ['MAD', 'BCN', 'FCO', 'MXP', 'CDG', 'LHR', 'AMS', 'LIS', 'BER', 'VIE'];

// ── Umbrales por dirección ──────────────────────────────
const AR_EU_THRESHOLD = 500;  // one-way AR→EU ≤ €500
const EU_AR_THRESHOLD = 400;  // one-way EU→AR ≤ €400
const RT_THRESHOLD    = 800;  // roundtrip AR↔EU ≤ €800

// ── Ventana de fechas: Jun 2026 → Jun 2027 ─────────────
const START_YEAR  = 2026;
const START_MONTH = 5;  // June (0-indexed)
const END_YEAR    = 2027;
const END_MONTH   = 5;  // June 2027

/**
 * Genera las fechas de sample para todo el año.
 * 2 fechas por mes: día 1 y día 15.
 * Si el día 1 cae en sábado/domingo, usa el lunes siguiente.
 * Si el día 15 cae en sábado/domingo, usa el lunes siguiente.
 * @returns {string[]} Array de fechas ISO (YYYY-MM-DD)
 */
function generateYearDates() {
  const dates = [];
  const start = new Date(START_YEAR, START_MONTH, 1);
  const end = new Date(END_YEAR, END_MONTH, 28); // last day to sample

  const cursor = new Date(start);
  while (cursor <= end) {
    // Day 1 of month
    const d1 = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    d1.setDate(d1.getDate() + adjustToWeekday(d1));
    if (d1 <= end) dates.push(fmt(d1));

    // Day 15 of month
    const d15 = new Date(cursor.getFullYear(), cursor.getMonth(), 15);
    d15.setDate(d15.getDate() + adjustToWeekday(d15));
    if (d15 <= end) dates.push(fmt(d15));

    // Move to next month
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
  }
  return dates.sort();
}

/**
 * Ajusta una fecha al próximo weekday (Lun-Vie).
 * Si ya es weekday, retorna 0.
 * @param {Date} d
 * @returns {number} días a sumar
 */
function adjustToWeekday(d) {
  const dow = d.getDay(); // 0=Sun, 6=Sat
  if (dow === 0) return 1;  // Sun → Mon
  if (dow === 6) return 2;  // Sat → Mon
  return 0;
}

/** @param {Date} d */
function fmt(d) {
  return d.toISOString().split('T')[0];
}

/**
 * Crea rutas one-way usando bulkWrite (mucho más rápido que 1x1).
 */
async function createOneWayRoutes(user, dates) {
  const ops = [];

  for (const origin of AR_ORIGINS) {
    for (const dest of EU_DESTS) {
      for (const dateIso of dates) {
        const d = new Date(dateIso);
        // Solo fechas futuras
        if (d < new Date()) continue;

        ops.push({
          updateOne: {
            filter: {
              telegramUserId: user.telegramUserId,
              origin,
              destination: dest,
              outboundDate: d,
              tripType: 'oneway',
            },
            update: {
              $set: {
                user: user._id,
                telegramChatId: user.telegramChatId,
                name: `${origin}→${dest} OW ≤€${AR_EU_THRESHOLD}`,
                returnDate: null,
                tripType: 'oneway',
                currency: 'EUR',
                priceThreshold: AR_EU_THRESHOLD,
                paused: false,
              },
            },
            upsert: true,
          },
        });
      }
    }
  }

  // EU → AR (reversed)
  for (const origin of EU_DESTS) {
    for (const dest of AR_ORIGINS) {
      for (const dateIso of dates) {
        const d = new Date(dateIso);
        if (d < new Date()) continue;

        ops.push({
          updateOne: {
            filter: {
              telegramUserId: user.telegramUserId,
              origin,
              destination: dest,
              outboundDate: d,
              tripType: 'oneway',
            },
            update: {
              $set: {
                user: user._id,
                telegramChatId: user.telegramChatId,
                name: `${origin}→${dest} OW ≤€${EU_AR_THRESHOLD}`,
                returnDate: null,
                tripType: 'oneway',
                currency: 'EUR',
                priceThreshold: EU_AR_THRESHOLD,
                paused: false,
              },
            },
            upsert: true,
          },
        });
      }
    }
  }

  if (ops.length === 0) return { upserted: 0, modified: 0 };

  // Procesar en chunks de 500 (MongoDB limit)
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

/**
 * Crea rutas roundtrip.
 */
async function createRoundtripRoutes(user, dates) {
  const ops = [];
  const RT_DAYS = 14; // duración típica del viaje

  for (const origin of AR_ORIGINS) {
    for (const dest of EU_DESTS) {
      for (const dateIso of dates) {
        const d = new Date(dateIso);
        if (d < new Date()) continue;

        const ret = new Date(d);
        ret.setDate(ret.getDate() + RT_DAYS);

        ops.push({
          updateOne: {
            filter: {
              telegramUserId: user.telegramUserId,
              origin,
              destination: dest,
              outboundDate: d,
              tripType: 'roundtrip',
            },
            update: {
              $set: {
                user: user._id,
                telegramChatId: user.telegramChatId,
                name: `${origin}↔${dest} RT ≤€${RT_THRESHOLD}`,
                returnDate: ret,
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

/**
 * Pausa todas las rutas existentes del usuario (limpieza suave).
 */
async function pauseOldRoutes(user) {
  const result = await Route.updateMany(
    { telegramUserId: user.telegramUserId, paused: false },
    { $set: { paused: true } },
  );
  return result.modifiedCount || 0;
}

/**
 * Elimina rutas con outboundDate más de 30 días en el pasado.
 */
async function purgeStaleRoutes(user) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const result = await Route.deleteMany({
    telegramUserId: user.telegramUserId,
    outboundDate: { $lt: cutoff },
  });
  return result.deletedCount || 0;
}

async function runMigration() {
  const users = await User.find({
    routesMigrationVersion: { $lt: TARGET_VERSION },
  }).lean();

  if (users.length === 0) {
    // Also run for users already at v6 but needing refresh
    const allUsers = await User.find({}).lean();
    if (allUsers.length === 0) {
      logger.info('No users found, skip migrateV6');
      return { migrated: 0 };
    }
    // Check if existing users need route refresh
    for (const u of allUsers) {
      const routeCount = await Route.countDocuments({
        telegramUserId: u.telegramUserId,
        paused: false,
        outboundDate: { $gte: new Date() },
      });
      if (routeCount < 100) {
        logger.info('User has few active routes, forcing refresh', {
          userId: u.telegramUserId, activeRoutes: routeCount,
        });
        await migrateOneUser(u);
        await User.updateOne(
          { _id: u._id },
          { routesMigrationVersion: TARGET_VERSION },
        );
      }
    }
    return { migrated: 0, refreshed: allUsers.length };
  }

  logger.info('Migrating users to v6 (global AR↔EU strategy)', { count: users.length });
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
      logger.error('migrateV6 failed for user', err);
    }
  }

  logger.info('migrateV6 completed', { migrated });
  return { migrated };
}

async function migrateOneUser(user) {
  logger.info('Building global AR↔EU routes', { userId: user.telegramUserId });

  // 1. Purge rutas viejas (>30 días en el pasado)
  const purged = await purgeStaleRoutes(user);
  logger.info('Purged stale routes', { purged });

  // 2. Pausar rutas existentes
  const paused = await pauseOldRoutes(user);
  logger.info('Paused old routes', { paused });

  // 3. Generar fechas del año
  const dates = generateYearDates();
  logger.info('Year dates generated', {
    count: dates.length,
    first: dates[0],
    last: dates[dates.length - 1],
  });

  // 4. Crear rutas one-way (AR→EU + EU→AR)
  const ow = await createOneWayRoutes(user, dates);
  logger.info('One-way routes created', ow);

  // 5. Crear rutas roundtrip
  const rt = await createRoundtripRoutes(user, dates);
  logger.info('Roundtrip routes created', rt);

  // 6. Eliminar rutas pausadas antiguas (>60 días)
  const oldCutoff = new Date();
  oldCutoff.setDate(oldCutoff.getDate() - 60);
  const deletedOld = await Route.deleteMany({
    telegramUserId: user.telegramUserId,
    paused: true,
    createdAt: { $lt: oldCutoff },
  });
  logger.info('Cleaned old paused routes', { deleted: deletedOld.deletedCount || 0 });

  const totalActive = await Route.countDocuments({
    telegramUserId: user.telegramUserId,
    paused: false,
  });
  logger.info('Total active routes after v6 migration', { count: totalActive });
}

module.exports = { runMigration };
