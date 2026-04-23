/**
 * Cache repository — adaptado a MongoDB (PriceCache model) con TTL.
 *
 * @module database/repositories/cacheRepo
 */

'use strict';

const PriceCache = require('../models/PriceCache');
const { config } = require('../../config');
const logger = require('../../utils/logger').child('db:cache');

/**
 * Busca una entrada válida (no expirada). MongoDB TTL la borra, pero
 * verificamos por si acaso.
 * @param {string} prefix
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function getCache(prefix, key) {
  const entry = await PriceCache.findOne({ key: `${prefix}:${key}` }).lean();
  if (!entry) return null;
  if (entry.expiresAt && new Date(entry.expiresAt) <= new Date()) {
    await PriceCache.deleteOne({ _id: entry._id }).catch(() => {});
    return null;
  }
  try {
    return entry.payload;
  } catch (err) {
    logger.warn('Corrupt cache entry', { prefix, key, error: /** @type {Error} */(err).message });
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
  const expiresAt = new Date(Date.now() + effectiveTtl);
  await PriceCache.findOneAndUpdate(
    { key: `${prefix}:${key}` },
    { provider: prefix, payload: value, expiresAt },
    { upsert: true }
  );
}

/** Borra entradas expiradas (redundante con TTL de MongoDB, pero útil para forzar cleanup). */
async function purgeExpired() {
  const result = await PriceCache.deleteMany({ expiresAt: { $lte: new Date() } });
  return result.deletedCount || 0;
}

/**
 * Adaptador que cumple la interfaz `CacheAdapter` esperada por providers.
 * @param {{ttlMs?: number}} [opts]
 */
function createAdapter(opts = {}) {
  const ttlMs = opts.ttlMs ?? config.cache.amadeusTtlMs;
  return {
    get: (prefix, key) => getCache(prefix, key),
    set: (prefix, key, value) => setCache(prefix, key, value, ttlMs),
  };
}

module.exports = { getCache, setCache, purgeExpired, createAdapter };
