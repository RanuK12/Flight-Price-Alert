/**
 * Amadeus Flight Inspiration Search — "¿a dónde puedo ir con X USD
 * saliendo desde Y?". Endpoints útiles:
 *
 *   - /v1/shopping/flight-destinations  → destinos desde un origen
 *   - /v1/shopping/flight-dates         → fechas más baratas para ruta dada
 *
 * Feature exclusiva de Amadeus (no posible con scraper). Soporta el
 * command `/inspirar` del bot.
 *
 * @module providers/amadeus/inspirationSearch
 */

'use strict';

const { AMADEUS_ENDPOINTS } = require('../../config/constants');
const logger = require('../../utils/logger').child('amadeus:inspiration');
const { getClient } = require('./client');

/**
 * @typedef {Object} InspirationDestination
 * @property {string} origin
 * @property {string} destination
 * @property {string} departureDate
 * @property {string|null} returnDate
 * @property {number} price
 * @property {string} currency
 * @property {string} [bookingUrl]
 */

/**
 * @typedef {Object} InspirationParams
 * @property {string} origin               IATA origen
 * @property {number} [maxPrice]           Presupuesto máximo
 * @property {string} [departureDate]      "YYYY-MM-DD" o rango "YYYY-MM-DD,YYYY-MM-DD"
 * @property {boolean} [oneWay=false]
 * @property {number} [duration]           Duración del viaje en días (sólo con oneWay=false)
 * @property {boolean} [nonStop=false]
 * @property {string} [viewBy]             "COUNTRY" | "DATE" | "DESTINATION" | "DURATION" | "WEEK"
 */

/**
 * Devuelve destinos baratos desde un origen.
 * @param {InspirationParams} params
 * @returns {Promise<InspirationDestination[]>}
 */
async function searchDestinations(params) {
  if (!params?.origin) throw new Error('origin is required');

  const client = getClient();
  /** @type {Record<string, string|number|boolean>} */
  const query = { origin: String(params.origin).toUpperCase() };

  if (params.maxPrice) query.maxPrice = params.maxPrice;
  if (params.departureDate) query.departureDate = params.departureDate;
  if (params.oneWay) query.oneWay = true;
  if (params.duration) query.duration = params.duration;
  if (params.nonStop) query.nonStop = true;
  if (params.viewBy) query.viewBy = params.viewBy;

  logger.info('Searching inspiration destinations', { origin: query.origin });

  const data = await client.request({
    method: 'GET',
    url: AMADEUS_ENDPOINTS.FLIGHT_DESTINATIONS,
    params: query,
  });

  const items = Array.isArray(data?.data) ? data.data : [];
  const currency = data?.meta?.currency || data?.dictionaries?.currencies
    ? Object.keys(data.dictionaries?.currencies || {})[0]
    : 'USD';

  return items.map((item) => ({
    origin: item.origin,
    destination: item.destination,
    departureDate: item.departureDate,
    returnDate: item.returnDate || null,
    price: Number.parseFloat(item.price?.total ?? '0'),
    currency: item.price?.currency || currency,
    bookingUrl: item.links?.flightOffers,
  }));
}

/**
 * Devuelve las fechas más baratas para una ruta específica
 * dentro de los próximos N meses.
 *
 * @param {Object} params
 * @param {string} params.origin
 * @param {string} params.destination
 * @param {string} [params.departureDate]    Rango "YYYY-MM-DD,YYYY-MM-DD"
 * @param {boolean} [params.oneWay=false]
 * @param {number} [params.duration]
 * @param {boolean} [params.nonStop=false]
 * @returns {Promise<Array<{departureDate: string, returnDate: string|null, price: number, currency: string}>>}
 */
async function searchCheapestDates(params) {
  if (!params?.origin || !params?.destination) {
    throw new Error('origin and destination are required');
  }

  const client = getClient();
  /** @type {Record<string, string|number|boolean>} */
  const query = {
    origin: String(params.origin).toUpperCase(),
    destination: String(params.destination).toUpperCase(),
  };
  if (params.departureDate) query.departureDate = params.departureDate;
  if (params.oneWay) query.oneWay = true;
  if (params.duration) query.duration = params.duration;
  if (params.nonStop) query.nonStop = true;

  logger.info('Searching cheapest dates', {
    origin: query.origin,
    destination: query.destination,
  });

  const data = await client.request({
    method: 'GET',
    url: AMADEUS_ENDPOINTS.FLIGHT_DATES,
    params: query,
  });

  const items = Array.isArray(data?.data) ? data.data : [];
  return items.map((item) => ({
    departureDate: item.departureDate,
    returnDate: item.returnDate || null,
    price: Number.parseFloat(item.price?.total ?? '0'),
    currency: item.price?.currency || 'USD',
  }));
}

module.exports = {
  searchDestinations,
  searchCheapestDates,
};
