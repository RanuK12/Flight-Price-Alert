/**
 * Modelo Notification — historial de notificaciones enviadas.
 *
 * @module database/models/Notification
 */

'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', default: null },
  origin: { type: String, required: true },
  destination: { type: String, required: true },
  departureDate: { type: Date, required: true },
  returnDate: { type: Date, default: null },
  price: { type: Number, required: true },
  currency: { type: String, default: 'EUR' },
  dealLevel: { type: String, required: true },
  threshold: { type: Number, default: null },
  provider: { type: String, default: '' },
  dedupKey: { type: String, required: true, unique: true },
  sentAt: { type: Date, default: Date.now },
  silent: { type: Boolean, default: false },
}, {
  timestamps: true,
});

notificationSchema.index({ user: 1, sentAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
