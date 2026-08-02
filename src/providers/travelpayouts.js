/**
 * Travelpayouts (Aviasales) Data API — radar barato de precios.
 *
 * QUÉ ES Y QUÉ NO ES:
 *
 * Devuelve la caché de lo que buscó gente real en Aviasales en los últimos
 * días, no una consulta en vivo a las aerolíneas. Los precios pueden estar
 * desactualizados y no son reservables. **No sirve para alertar.**
 *
 * Sirve como RADAR: es gratis, no bloquea, y responde en milisegundos. Dice
 * qué rutas y qué meses vale la pena confirmar con Playwright, que es el
 * recurso caro (~15s por carga y con riesgo de bloqueo). El scraping se gasta
 * donde el radar marcó algo, en vez de repartirlo parejo entre 900 rutas.
 *
 * Sin `TRAVELPAYOUTS_TOKEN` configurado el módulo queda inerte: `isEnabled()`
 * devuelve false y nadie más lo llama. No rompe nada.
 *
 * Token gratis en https://travelpayouts.com/developers/api
 *
 * @module providers/travelpayouts
 */

'use strict';

const axios = require('axios');
const logger = require('../utils/logger').child('travelpayouts');

const BASE_URL = 'https://api.travelpayouts.com';
const TIMEOUT_MS = 8000;

/** Token de afiliado. Sin esto el proveedor queda apagado. */
function token() {
  return process.env.TRAVELPAYOUTS_TOKEN || '';
}

/** @returns {boolean} si el radar está configurado y se puede usar. */
function isEnabled() {
  return Boolean(token());
}

/**
 * GET contra la Data API. Nunca lanza: un radar caído no puede tumbar una
 * pasada de alertas.
 *
 * @param {string} path
 * @param {Record<string, string|number>} params
 * @returns {Promise<any|null>}
 */
async function get(path, params) {
  if (!isEnabled()) return null;
  try {
    const res = await axios.get(`${BASE_URL}${path}`, {
      params: { ...params, token: token(), currency: 'eur' },
      timeout: TIMEOUT_MS,
      headers: { 'X-Access-Token': token() },
    });
    if (!res.data?.success && res.data?.success !== undefined) {
      logger.debug('Respuesta sin success', { path, error: res.data?.error });
      return null;
    }
    return res.data?.data ?? null;
  } catch (err) {
    logger.debug('Fallo la consulta (radar es best-effort)', {
      path, err: /** @type {Error} */(err).message,
    });
    return null;
  }
}

/**
 * Precio mínimo por día para un mes, en una ruta.
 *
 * @param {string} origin - IATA
 * @param {string} destination - IATA
 * @param {string} month - "YYYY-MM-DD" (cualquier día del mes)
 * @returns {Promise<Array<{departureDate: string, returnDate: string|null, price: number, currency: string, stops: number, actual: boolean}>>}
 */
async function monthMatrix(origin, destination, month) {
  const data = await get('/v2/prices/month-matrix', { origin, destination, month });
  if (!Array.isArray(data)) return [];

  return data
    .filter(row => Number.isFinite(row?.value) && row.value > 0)
    .map(row => ({
      departureDate: row.depart_date,
      returnDate: row.return_date || null,
      price: Math.round(row.value),
      currency: 'EUR',
      stops: Number(row.number_of_changes ?? 0),
      // `actual:false` = precio viejo que Aviasales ya no considera vigente.
      actual: row.actual !== false,
    }))
    .sort((a, b) => a.price - b.price);
}

/**
 * Precio mínimo conocido de una ruta en una ventana de fechas.
 *
 * Es la pregunta que le hace el radar al proveedor: "¿hay algo que valga la
 * pena mirar en serio acá?". Si el mínimo de la caché está muy por encima del
 * umbral, gastar 15 segundos de Playwright en esa ruta es tirar tiempo.
 *
 * @param {string} origin
 * @param {string} destination
 * @param {string[]} dates - fechas ISO que interesan
 * @returns {Promise<{minPrice: number|null, samples: number, cheapestDate: string|null}>}
 */
async function radarMinPrice(origin, destination, dates) {
  if (!isEnabled() || !dates.length) {
    return { minPrice: null, samples: 0, cheapestDate: null };
  }

  const months = [...new Set(dates.map(d => `${String(d).slice(0, 7)}-01`))];
  const wanted = new Set(dates);
  let best = null;
  let samples = 0;

  for (const month of months) {
    const rows = await monthMatrix(origin, destination, month);
    for (const row of rows) {
      if (!row.actual || !wanted.has(row.departureDate)) continue;
      samples += 1;
      if (!best || row.price < best.price) best = row;
    }
  }

  return {
    minPrice: best?.price ?? null,
    samples,
    cheapestDate: best?.departureDate ?? null,
  };
}

module.exports = {
  isEnabled,
  monthMatrix,
  radarMinPrice,
};
