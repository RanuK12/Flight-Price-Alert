/**
 * Modelo UsageLog — tracking de cuota diaria/mensual por provider.
 *
 * @module database/models/UsageLog
 */

'use strict';

const mongoose = require('mongoose');

const usageLogSchema = new mongoose.Schema({
  provider: { type: String, required: true },
  usageDate: { type: String, required: true }, // YYYY-MM-DD
  used: { type: Number, default: 0 },
}, {
  timestamps: true,
});

usageLogSchema.index({ provider: 1, usageDate: 1 }, { unique: true });

module.exports = mongoose.model('UsageLog', usageLogSchema);
