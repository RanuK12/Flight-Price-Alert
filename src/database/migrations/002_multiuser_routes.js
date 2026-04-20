/**
 * Migración 002: soporte multiusuario para alertas.
 *
 * Cambios sobre `saved_routes`:
 *  + telegram_user_id   INTEGER   (nullable para compat con existentes)
 *  + telegram_chat_id   INTEGER
 *  + name               TEXT      (etiqueta legible: "Mi vuelo a Roma")
 *  + paused             INTEGER   DEFAULT 0
 *  + outbound_date      TEXT
 *  + return_date        TEXT
 *  + trip_type          TEXT      DEFAULT 'oneway'
 *  + currency           TEXT      DEFAULT 'USD'
 *  + updated_at         DATETIME
 *
 * Se dropea el UNIQUE(origin, destination) anterior y se reemplaza por
 * UNIQUE(telegram_user_id, origin, destination, outbound_date).
 *
 * SQLite no soporta DROP CONSTRAINT → usamos la técnica estándar:
 * crear tabla nueva, copiar, renombrar.
 *
 * @module database/migrations/002
 */

'use strict';

const { run, all } = require('../db');

const id = 2;
const name = 'multiuser_routes';

async function up() {
  // Detectar si la tabla vieja existe y tiene datos para migrar
  const existingRoutes = await all('SELECT * FROM saved_routes');

  await run('DROP TABLE IF EXISTS saved_routes_new');

  await run(`
    CREATE TABLE saved_routes_new (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id   INTEGER,
      telegram_chat_id   INTEGER,
      name               TEXT,
      origin             TEXT NOT NULL,
      destination        TEXT NOT NULL,
      outbound_date      TEXT,
      return_date        TEXT,
      trip_type          TEXT DEFAULT 'oneway',
      currency           TEXT DEFAULT 'USD',
      price_threshold    REAL,
      paused             INTEGER DEFAULT 0,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(telegram_user_id, origin, destination, outbound_date)
    )
  `);

  // Copiar datos existentes (sin user — eran rutas "globales" del v1).
  for (const r of existingRoutes) {
    await run(
      `INSERT INTO saved_routes_new
        (id, origin, destination, price_threshold, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [r.id, r.origin, r.destination, r.price_threshold, r.created_at],
    );
  }

  await run('DROP TABLE saved_routes');
  await run('ALTER TABLE saved_routes_new RENAME TO saved_routes');

  await run('CREATE INDEX IF NOT EXISTS idx_routes_user ON saved_routes(telegram_user_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_routes_active ON saved_routes(paused, origin, destination)');

  // Tabla de sesiones conversacionales (wizard state del bot).
  // Persistida así sobrevive a redeploys en Render.
  await run(`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      chat_id       INTEGER PRIMARY KEY,
      user_id       INTEGER,
      state         TEXT NOT NULL,        -- ej. 'buscar:awaiting_origin'
      data_json     TEXT NOT NULL DEFAULT '{}',
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at    DATETIME
    )
  `);

  // Índice para limpiar sesiones vencidas.
  await run('CREATE INDEX IF NOT EXISTS idx_bot_sessions_expiry ON bot_sessions(expires_at)');
}

module.exports = { id, name, up };
