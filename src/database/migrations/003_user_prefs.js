/**
 * Migración 003: preferencias por usuario.
 *
 * `user_prefs` guarda configuración elegida desde el bot:
 *   - search_mode     'hybrid' | 'amadeus' | 'scraper'
 *   - alert_min_level 'steal' | 'great' | 'good' | 'all'
 *   - currency        'EUR' | 'USD'
 *   - default_origin  IATA favorito para /buscar (opcional)
 *
 * Multi-user ready: clave primaria = telegram_user_id.
 *
 * @module database/migrations/003
 */

'use strict';

const { run } = require('../db');

const id = 3;
const name = 'user_prefs';

async function up() {
  await run(`
    CREATE TABLE IF NOT EXISTS user_prefs (
      telegram_user_id   INTEGER PRIMARY KEY,
      telegram_chat_id   INTEGER,
      search_mode        TEXT DEFAULT 'hybrid',
      alert_min_level    TEXT DEFAULT 'steal',
      currency           TEXT DEFAULT 'EUR',
      default_origin     TEXT,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

module.exports = { id, name, up };
