/**
 * Modelo BotSession — estado de wizard conversacional.
 * TTL index en expiresAt para auto-cleanup.
 *
 * @module database/models/BotSession
 */

'use strict';

const mongoose = require('mongoose');

const botSessionSchema = new mongoose.Schema({
  chatId: { type: Number, required: true, unique: true },
  userId: { type: Number, default: null },
  state: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  expiresAt: { type: Date, required: true },
}, {
  timestamps: true,
});

// TTL: MongoDB borra documentos automáticamente cuando expiresAt < now
botSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('BotSession', botSessionSchema);
