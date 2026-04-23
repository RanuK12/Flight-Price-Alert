/**
 * Modelo Route — alertas de vuelo creadas por los usuarios.
 *
 * @module database/models/Route
 */

'use strict';

const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  telegramUserId: { type: Number, required: true, index: true },
  telegramChatId: { type: Number, required: true },
  origin: { type: String, required: true, uppercase: true, trim: true },
  destination: { type: String, required: true, uppercase: true, trim: true },
  tripType: { type: String, enum: ['oneway', 'roundtrip'], required: true },
  outboundDate: { type: Date, required: true },
  returnDate: { type: Date, default: null },
  priceThreshold: { type: Number, default: null },
  name: { type: String, default: '' },
  paused: { type: Boolean, default: false },
}, {
  timestamps: true,
});

routeSchema.index({ telegramUserId: 1, paused: 1 });
routeSchema.index({ origin: 1, destination: 1, outboundDate: 1 });

module.exports = mongoose.model('Route', routeSchema);
