/**
 * Modelo PriceCache — cache de búsquedas híbridas.
 * TTL index en expiresAt.
 *
 * @module database/models/PriceCache
 */

'use strict';

const mongoose = require('mongoose');

const priceCacheSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  provider: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
}, {
  timestamps: true,
});

priceCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PriceCache', priceCacheSchema);
