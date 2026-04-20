/**
 * Sistema de migraciones simple. Las migraciones son módulos con
 * `id` (int) y `up(db)` async. Se aplican en orden y se registran
 * en `schema_migrations`.
 *
 * Uso:
 *   const { runMigrations } = require('./database/migrations');
 *   await runMigrations();
 *
 * @module database/migrations
 */

'use strict';

const { run, get, all } = require('../db');
const logger = require('../../utils/logger').child('db:migrations');

/**
 * @typedef {Object} Migration
 * @property {number} id
 * @property {string} name
 * @property {() => Promise<void>} up
 */

/** @type {Migration[]} */
const MIGRATIONS = [
  require('./001_initial_schema'),
  require('./002_multiuser_routes'),
  require('./003_user_prefs'),
];

async function ensureRegistryTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/** Aplica todas las migraciones pendientes en orden. */
async function runMigrations() {
  await ensureRegistryTable();

  const applied = new Set(
    (await all('SELECT id FROM schema_migrations')).map((r) => /** @type {number} */ (r.id)),
  );

  for (const m of MIGRATIONS.sort((a, b) => a.id - b.id)) {
    if (applied.has(m.id)) continue;
    logger.info('Applying migration', { id: m.id, name: m.name });
    await m.up();
    await run('INSERT INTO schema_migrations (id, name) VALUES (?, ?)', [m.id, m.name]);
    logger.info('Migration applied', { id: m.id });
  }
}

/** Devuelve el estado actual de migraciones (para /stats o diagnóstico). */
async function status() {
  await ensureRegistryTable();
  const applied = await all('SELECT id, name, applied_at FROM schema_migrations ORDER BY id ASC');
  return {
    applied,
    pending: MIGRATIONS.filter((m) => !applied.some((a) => a.id === m.id)).map((m) => ({
      id: m.id, name: m.name,
    })),
  };
}

module.exports = { runMigrations, status };

// Silence unused
void get;
