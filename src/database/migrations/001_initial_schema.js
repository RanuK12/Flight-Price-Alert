/**
 * Migración 001: schema base.
 * Replica lo que ya creaba `server/database/db.js` para bases existentes
 * (`CREATE TABLE IF NOT EXISTS`), de modo que correr esto sobre una DB
 * viva es idempotente y no pisa datos.
 *
 * @module database/migrations/001
 */

'use strict';

const { run } = require('../db');

const id = 1;
const name = 'initial_schema';

async function up() {
  await run(`
    CREATE TABLE IF NOT EXISTS flight_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      airline TEXT,
      price REAL NOT NULL,
      source TEXT,
      booking_url TEXT,
      departure_date TEXT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(route_id, airline, departure_date, recorded_at)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS saved_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      price_threshold REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(origin, destination)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id TEXT NOT NULL,
      price REAL,
      message TEXT,
      sent_to_telegram INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      searched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      price REAL NOT NULL,
      deal_level TEXT,
      outbound_date TEXT,
      return_date TEXT,
      trip_type TEXT DEFAULT 'oneway',
      airline TEXT,
      booking_url TEXT,
      savings REAL,
      savings_percent INTEGER,
      notified INTEGER DEFAULT 0,
      found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(origin, destination, outbound_date, price)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS flight_search_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      UNIQUE(provider, cache_key)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS provider_daily_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, usage_date)
    )
  `);
}

module.exports = { id, name, up };
