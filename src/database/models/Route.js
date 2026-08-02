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
  // Moneda del priceThreshold. Estaba ausente del schema aunque las
  // migraciones y routesRepo la setean: en modo strict mongoose la
  // descartaba silenciosamente.
  currency: { type: String, default: 'EUR', uppercase: true, trim: true },
  name: { type: String, default: '' },
  paused: { type: Boolean, default: false },
  // Última vez que el alertEngine consultó esta ruta, y el mejor precio
  // visto en esa consulta (EUR). Sirven para dos cosas: priorizar las rutas
  // más desactualizadas en cada pasada (antes era un offset en memoria que
  // se reseteaba en cada reinicio de Render) y alimentar el resumen diario
  // con precios reales aunque no se haya disparado ninguna alerta.
  lastCheckedAt: { type: Date, default: null, index: true },
  lastPriceEur: { type: Number, default: null },
}, {
  timestamps: true,
});

routeSchema.index({ telegramUserId: 1, paused: 1 });
routeSchema.index({ origin: 1, destination: 1, outboundDate: 1 });
routeSchema.index({ paused: 1, lastCheckedAt: 1 });

module.exports = mongoose.model('Route', routeSchema);
