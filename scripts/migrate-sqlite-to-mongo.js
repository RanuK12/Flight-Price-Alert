/**
 * Script one-off: migra datos de SQLite local a MongoDB Atlas.
 *
 * Uso:
 *   node scripts/migrate-sqlite-to-mongo.js
 *
 * Tablas migradas:
 *   - user_prefs        → User
 *   - saved_routes      → Route
 *   - offer_notifications → Notification
 *   - provider_daily_usage → UsageLog
 *
 * Requiere MONGODB_URI configurado en .env
 */

'use strict';

require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const mongoose = require('mongoose');
const User = require('../src/database/models/User');
const Route = require('../src/database/models/Route');
const Notification = require('../src/database/models/Notification');
const UsageLog = require('../src/database/models/UsageLog');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '../data/flights.db');
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI no está configurado. Setealo en .env');
  process.exit(1);
}

const db = new sqlite3.Database(SQLITE_PATH, sqlite3.OPEN_READONLY);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function migrateUsers() {
  const rows = await all('SELECT * FROM user_prefs');
  console.log(`👤 Migrando ${rows.length} usuarios...`);
  for (const r of rows) {
    await User.findOneAndUpdate(
      { telegramUserId: r.telegram_user_id },
      {
        telegramChatId: r.telegram_chat_id,
        searchMode: r.search_mode || 'hybrid',
        alertMinLevel: r.alert_min_level || 'steal',
        currency: r.currency || 'EUR',
      },
      { upsert: true }
    );
  }
  console.log('✅ Usuarios migrados');
}

async function migrateRoutes() {
  const rows = await all('SELECT * FROM saved_routes');
  console.log(`✈️ Migrando ${rows.length} rutas...`);
  for (const r of rows) {
    const user = await User.findOne({ telegramUserId: r.telegram_user_id }).lean();
    if (!user) {
      console.warn(`   ⚠️ Usuario ${r.telegram_user_id} no encontrado, saltando ruta ${r.id}`);
      continue;
    }
    await Route.findOneAndUpdate(
      {
        telegramUserId: r.telegram_user_id,
        origin: r.origin,
        destination: r.destination,
        outboundDate: r.outbound_date ? new Date(r.outbound_date) : null,
      },
      {
        user: user._id,
        telegramChatId: r.telegram_chat_id,
        name: r.name || undefined,
        returnDate: r.return_date ? new Date(r.return_date) : null,
        tripType: r.trip_type || 'oneway',
        currency: r.currency || 'USD',
        priceThreshold: r.price_threshold ?? null,
        paused: r.paused === 1,
      },
      { upsert: true }
    );
  }
  console.log('✅ Rutas migradas');
}

async function migrateNotifications() {
  const rows = await all('SELECT * FROM offer_notifications');
  console.log(`🔔 Migrando ${rows.length} notificaciones...`);
  for (const r of rows) {
    const user = await User.findOne({ telegramUserId: r.telegram_user_id }).lean();
    if (!user) continue;

    // Buscar route correspondiente
    let route = null;
    if (r.route_id) {
      route = await Route.findOne({ telegramUserId: r.telegram_user_id })
        .sort({ createdAt: 1 })
        .skip(r.route_id - 1)
        .lean();
    }

    await Notification.create({
      user: user._id,
      route: route ? route._id : null,
      origin: r.origin,
      destination: r.destination,
      departureDate: r.departure_date ? new Date(r.departure_date) : new Date(),
      returnDate: r.return_date ? new Date(r.return_date) : null,
      price: r.price,
      currency: r.currency || 'EUR',
      dealLevel: r.deal_level,
      threshold: r.threshold ?? null,
      provider: r.provider || '',
      dedupKey: r.dedup_key,
      sentAt: r.sent_at ? new Date(r.sent_at) : new Date(),
      silent: false,
    });
  }
  console.log('✅ Notificaciones migradas');
}

async function migrateUsageLogs() {
  const rows = await all('SELECT * FROM provider_daily_usage');
  console.log(`📊 Migrando ${rows.length} registros de uso...`);
  for (const r of rows) {
    await UsageLog.findOneAndUpdate(
      { provider: r.provider, usageDate: r.usage_date },
      { used: r.used },
      { upsert: true }
    );
  }
  console.log('✅ Uso migrado');
}

async function main() {
  console.log('🚀 Iniciando migración SQLite → MongoDB');
  console.log(`   SQLite: ${SQLITE_PATH}`);
  console.log(`   MongoDB: ${MONGODB_URI.replace(/:.*@/, ':***@')}`);

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Conectado a MongoDB\n');

  await migrateUsers();
  await migrateRoutes();
  await migrateNotifications();
  await migrateUsageLogs();

  console.log('\n🎉 Migración completada');
  await mongoose.disconnect();
  db.close();
}

main().catch((err) => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
