/**
 * migrateRoutesV7 — Estrategia global expandida AR ↔ EU, todo el año.
 *
 * MEJORAS sobre V6:
 *   · 30 destinos EU (vs 10) — cubre TODOS los hubs principales de Europa
 *   · Fechas DINÁMICAS: siempre próximos 12 meses desde boot (rolling)
 *   · 4 fechas/mes (vs 2) — mejor cobertura de ofertas
 *   · Solo fechas futuras (auto-skip passé)
 *   · One-way AR→EU ≤€500, EU→AR ≤€400, Roundtrip ≤€800
 *
 * @module bootstrap/migrateRoutesV7
 */

'use strict';

const User = require('../database/models/User');
const Route = require('../database/models/Route');
const logger = require('../utils/logger').child('migrateV7');

const TARGET_VERSION = 8;

const EU_DESTS = [
  'MAD','BCN','SVQ','VLC','BIO',
  'FCO','MXP','NAP','VCE','BGY',
  'CDG','ORY','NCE','LYS',
  'LHR','LGW','STN','DUB',
  'AMS','BRU',
  'FRA','MUC','BER','DUS','HAM',
  'LIS','OPO',
  'VIE','ZRH','ATH','IST',
];

const AR_ORIGINS = ['EZE', 'COR', 'MDQ', 'ROS', 'BUE'];

const AR_EU_THRESHOLD = 500;
const EU_AR_THRESHOLD = 400;
const RT_THRESHOLD    = 800;
const MONTHS_AHEAD = 12;
const SAMPLE_DAYS = [1, 8, 15, 22];
const RT_DAYS = 14;

function fmt(d) { return d.toISOString().split('T')[0]; }

function adjustToWeekday(d) {
  const dow = d.getDay();
  if (dow === 0) return 1;
  if (dow === 6) return 2;
  return 0;
}

function generateRollingDates() {
  const now = new Date();
  const dates = [];
  const end = new Date(now.getFullYear(), now.getMonth() + MONTHS_AHEAD, 28);
  for (let m = 0; m < MONTHS_AHEAD; m++) {
    const year = now.getFullYear();
    const month = now.getMonth() + m;
    for (const day of SAMPLE_DAYS) {
      const d = new Date(year, month, day);
      d.setDate(d.getDate() + adjustToWeekday(d));
      if (d >= now && d <= end) dates.push(fmt(d));
    }
  }
  return [...new Set(dates)].sort();
}

async function bulkUpsert(ops) {
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

async function createOneWayRoutes(user, dates) {
  const ops = [];
  for (const origin of AR_ORIGINS) {
    for (const dest of EU_DESTS) {
      for (const dateIso of dates) {
        ops.push({ updateOne: {
          filter: { telegramUserId: user.telegramUserId, origin, destination: dest, outboundDate: new Date(dateIso), tripType: 'oneway' },
          update: { $set: { user: user._id, telegramChatId: user.telegramChatId, name: origin+'→'+dest+' OW ≤€'+AR_EU_THRESHOLD, returnDate: null, tripType: 'oneway', currency: 'EUR', priceThreshold: AR_EU_THRESHOLD, paused: false } },
          upsert: true,
        }});
      }
    }
  }
  for (const origin of EU_DESTS) {
    for (const dest of AR_ORIGINS) {
      for (const dateIso of dates) {
        ops.push({ updateOne: {
          filter: { telegramUserId: user.telegramUserId, origin, destination: dest, outboundDate: new Date(dateIso), tripType: 'oneway' },
          update: { $set: { user: user._id, telegramChatId: user.telegramChatId, name: origin+'→'+dest+' OW ≤€'+EU_AR_THRESHOLD, returnDate: null, tripType: 'oneway', currency: 'EUR', priceThreshold: EU_AR_THRESHOLD, paused: false } },
          upsert: true,
        }});
      }
    }
  }
  return bulkUpsert(ops);
}

async function createRoundtripRoutes(user, dates) {
  const ops = [];
  for (const origin of AR_ORIGINS) {
    for (const dest of EU_DESTS) {
      for (const dateIso of dates) {
        const d = new Date(dateIso);
        const ret = new Date(d); ret.setDate(ret.getDate() + RT_DAYS);
        ops.push({ updateOne: {
          filter: { telegramUserId: user.telegramUserId, origin, destination: dest, outboundDate: d, tripType: 'roundtrip' },
          update: { $set: { user: user._id, telegramChatId: user.telegramChatId, name: origin+'↔'+dest+' RT ≤€'+RT_THRESHOLD, returnDate: ret, tripType: 'roundtrip', currency: 'EUR', priceThreshold: RT_THRESHOLD, paused: false } },
          upsert: true,
        }});
      }
    }
  }
  return bulkUpsert(ops);
}

async function pauseOldRoutes(user) {
  const r = await Route.updateMany({ telegramUserId: user.telegramUserId, paused: false }, { $set: { paused: true } });
  return r.modifiedCount || 0;
}

async function purgeStaleRoutes(user) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const r = await Route.deleteMany({ telegramUserId: user.telegramUserId, outboundDate: { $lt: cutoff } });
  return r.deletedCount || 0;
}

async function migrateOneUser(user) {
  logger.info('Building global AR↔EU routes (v7)', { userId: user.telegramUserId });
  const purged = await purgeStaleRoutes(user);
  logger.info('Purged stale routes', { purged });
  const paused = await pauseOldRoutes(user);
  logger.info('Paused old routes', { paused });
  const dates = generateRollingDates();
  logger.info('Rolling dates generated', { count: dates.length, first: dates[0], last: dates[dates.length - 1] });
  const ow = await createOneWayRoutes(user, dates);
  logger.info('One-way routes created', ow);
  const rt = await createRoundtripRoutes(user, dates);
  logger.info('Roundtrip routes created', rt);
  const totalActive = await Route.countDocuments({ telegramUserId: user.telegramUserId, paused: false });
  logger.info('Total active routes after v7 migration', { count: totalActive });
}

async function runMigration() {
  const users = await User.find({ routesMigrationVersion: { $lt: TARGET_VERSION } }).lean();

  if (users.length === 0) {
    const allUsers = await User.find({}).lean();
    if (allUsers.length === 0) {
      logger.info('No users found, skip migrateV7');
      return { migrated: 0 };
    }
    for (const u of allUsers) {
      const routeCount = await Route.countDocuments({ telegramUserId: u.telegramUserId, paused: false, outboundDate: { $gte: new Date() } });
      if (routeCount < 200) {
        logger.info('User has few active routes, forcing v7 refresh', { userId: u.telegramUserId, activeRoutes: routeCount });
        await migrateOneUser(u);
        await User.updateOne({ _id: u._id }, { routesMigrationVersion: TARGET_VERSION });
      }
    }
    return { migrated: 0, refreshed: allUsers.length };
  }

  logger.info('Migrating users to v7 (expanded AR↔EU strategy)', { count: users.length });
  let migrated = 0;
  for (const u of users) {
    try {
      await migrateOneUser(u);
      await User.updateOne({ _id: u._id }, { routesMigrationVersion: TARGET_VERSION });
      migrated += 1;
    } catch (err) {
      logger.error('migrateV7 failed for user', err);
    }
  }
  logger.info('migrateV7 completed', { migrated });
  return { migrated };
}

module.exports = { runMigration };
