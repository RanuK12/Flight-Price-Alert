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
  // Rutas VENTANA: cuando estos campos están, la ruta no representa una fecha
  // sola sino un rango, y `outboundDate`/`returnDate` son el inicio.
  //
  // Antes hacía falta una ruta por cada combinación de fechas: 8 idas x 8
  // vueltas = 64 rutas para un solo par de aeropuertos, y 640 en total. Emilio
  // no quiere 64 avisos, quiere uno que diga "LIS↔EZE, 18 sep → 7 nov, €780".
  // La "Tabla de fechas" de Google devuelve las 64 combinaciones en 4 cargas
  // (ver services/gridScan), así que una ruta por par alcanza y sobra.
  outboundDateEnd: { type: Date, default: null },
  returnDateEnd: { type: Date, default: null },
  // Mejor combinación encontrada dentro de la ventana (la que se alerta).
  bestOutboundDate: { type: Date, default: null },
  bestReturnDate: { type: Date, default: null },
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
