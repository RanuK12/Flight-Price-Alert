/**
 * Cache repository — wrapper sobre `flight_search_cache`.
 * Expone la shape esperada por `providers/amadeus/flightOffers.js`
 * (`get(prefix, key)` / `set(prefix, key, value)`), con TTL por provider.
 *
 * @module database/repositories/cacheRepo
 */

'use strict';

const { run, get } = require('../db');
const { config } = require('../../config');
const logger = require('../../utils/logger').child('db:cache');

/**
 * Busca una entrada válida (no expirada).
 * @param {string} prefix
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function getCache(prefix, key) {
  const row = await get(
    `SELECT response_json, expires_at FROM flight_search_cache
      WHERE provider = ? AND cache_key = ?`,
    [prefix, key],
  );
  if (!row) return null;

  const expiresAt = new Date(/** @type {string} */ (row.expires_at));
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    await run(
      `DELETE FROM flight_search_cache WHERE provider = ? AND cache_key = ?`,
      [prefix, key],
    ).catch(() => {});
    return null;
  }

  try {
    return JSON.parse(/** @type {string} */ (row.response_json));
  } catch (err) {
    logger.warn('Corrupt cache entry', {
      prefix, key, error: /** @type {Error} */ (err).message,
    });
    return null;
  }
}

/**
 * Guarda/actualiza una entrada con TTL específico.
 * @param {string} prefix
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlMs]
 */
async function setCache(prefix, key, value, ttlMs) {
  const effectiveTtl = ttlMs ?? config.cache.amadeusTtlMs;
  const expiresAt = new Date(Date.now() + effectiveTtl).toISOString();
  await run(
    `INSERT INTO flight_search_cache (provider, cache_key, response_json, created_at, expires_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(provider, cache_key)
       DO UPDATE SET response_json = excluded.response_json,
                     expires_at = excluded.expires_at,
                     created_at = CURRENT_TIMESTAMP`,
    [prefix, key, JSON.stringify(value), expiresAt],
  );
}

/** Borra entradas expiradas. Llamable desde cron periódico. */
async function purgeExpired() {
  const result = await run(`DELETE FROM flight_search_cache WHERE expires_at <= CURRENT_TIMESTAMP`);
  return result.changes;
}

/**
 * Adaptador que cumple la interfaz `CacheAdapter` esperada por providers.
 * TTL fijo por instancia → por defecto el de Amadeus.
 * @param {{ttlMs?: number}} [opts]
 */
function createAdapter(opts = {}) {
  const ttlMs = opts.ttlMs ?? config.cache.amadeusTtlMs;
  return {
    /** @param {string} prefix @param {string} key */
    get: (prefix, key) => getCache(prefix, key),
    /** @param {string} prefix @param {string} key @param {any} value */
    set: (prefix, key, value) => setCache(prefix, key, value, ttlMs),
  };
}

module.exports = { getCache, setCache, purgeExpired, createAdapter };
