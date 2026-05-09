/**
 * Modelo User — preferencias y perfil del usuario de Telegram.
 *
 * @module database/models/User
 */

'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramUserId: { type: Number, required: true, unique: true, index: true },
  telegramChatId: { type: Number, required: true },
  currency: { type: String, default: 'EUR' },
  searchMode: { type: String, enum: ['hybrid', 'amadeus', 'scraper'], default: 'hybrid' },
  alertMinLevel: { type: String, enum: ['steal', 'great', 'good', 'all'], default: 'good' },
  routesMigrationVersion: { type: Number, default: 0 },
}, {
  timestamps: true,
});

module.exports = mongoose.model('User', userSchema);
