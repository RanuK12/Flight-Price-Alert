/**
 * Conexión SQLite + helpers promisificados.
 * Reemplazo modular del antiguo `server/database/db.js` — mantiene
 * el mismo schema pero divide responsabilidades: schema/migraciones
 * viven en `./migrations`, consultas específicas en `./repositories`.
 *
 * @module database/db
 */

'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const { config } = require('../config');
const logger = require('../utils/logger').child('db');

const SQLITE_PATH = path.resolve(process.cwd(), config.paths.sqlitePath);
const DATA_DIR = path.dirname(SQLITE_PATH);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(SQLITE_PATH, (err) => {
  if (err) {
    logger.error('Failed to open SQLite database', err);
  } else {
    logger.info('SQLite connected', { path: SQLITE_PATH });
  }
});

// PRAGMAs recomendados: WAL para mejor concurrencia, foreign keys on.
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA busy_timeout = 5000');
});

/**
 * Ejecuta una sentencia de modificación (INSERT/UPDATE/DELETE/DDL).
 * @param {string} query
 * @param {Array<unknown>} [params]
 * @returns {Promise<{lastID:number, changes:number}>}
 */
function run(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function cb(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/**
 * Devuelve la primera fila de una consulta.
 * @param {string} query
 * @param {Array<unknown>} [params]
 * @returns {Promise<Record<string, unknown>|undefined>}
 */
function get(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

/**
 * Devuelve todas las filas.
 * @param {string} query
 * @param {Array<unknown>} [params]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
function all(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

/**
 * Cierra la conexión. Útil para tests y shutdown limpio.
 * @returns {Promise<void>}
 */
function close() {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

module.exports = { db, run, get, all, close };
