/**
 * Constantes compartidas — valores "mágicos" concentrados en un solo lugar
 * para facilitar tuning sin tocar lógica.
 *
 * @module config/constants
 */

'use strict';

/** @readonly */
const PROVIDER_NAMES = Object.freeze({
  AMADEUS: 'amadeus',
  GOOGLE_FLIGHTS: 'google_flights',
  PUPPETEER: 'puppeteer',
});

/** @readonly */
const DEAL_LEVELS = Object.freeze({
  STEAL: 'steal',   // error de tarifa / ganga extrema
  GREAT: 'great',   // muy por debajo del típico
  GOOD: 'good',     // buen precio
  NORMAL: 'normal',
  HIGH: 'high',
});

/** @readonly */
const TRIP_TYPES = Object.freeze({
  ONEWAY: 'oneway',
  ROUNDTRIP: 'roundtrip',
});

/**
 * Configuración del token bucket de Amadeus.
 * El plan production permite ráfagas limitadas por endpoint.
 * Ser conservador evita 429s y penalizaciones.
 */
const AMADEUS_LIMITS = Object.freeze({
  DEFAULT_RPS: 8,                 // refill rate
  BURST_CAPACITY: 10,             // bucket size
  MAX_RETRIES: 3,                 // reintentos para 5xx/timeout (no 429)
  RETRY_BASE_MS: 500,             // backoff exponencial base
  RETRY_MAX_MS: 10_000,           // cap del backoff
  TOKEN_REFRESH_MARGIN_S: 300,    // renovar token 5 min antes de expirar
  DEFAULT_TIMEOUT_MS: 15_000,     // timeout por request
  DEFAULT_CURRENCY: 'EUR',        // EUR = moneda de referencia del usuario (rutas AR↔Europa)
  MAX_RESULTS_PER_SEARCH: 20,     // techo para no desperdiciar cuota
});

/** Endpoints de Amadeus relativos a AMADEUS_BASE_URL. */
const AMADEUS_ENDPOINTS = Object.freeze({
  TOKEN: '/v1/security/oauth2/token',
  FLIGHT_OFFERS_SEARCH: '/v2/shopping/flight-offers',
  FLIGHT_OFFERS_PRICING: '/v1/shopping/flight-offers/pricing',
  FLIGHT_DESTINATIONS: '/v1/shopping/flight-destinations',      // inspiration
  FLIGHT_DATES: '/v1/shopping/flight-dates',                    // cheapest dates
  AIRPORT_SEARCH: '/v1/reference-data/locations',
});

/** Cache keys prefixes para aislar namespaces en flight_search_cache. */
const CACHE_PREFIXES = Object.freeze({
  AMADEUS_OFFERS: 'amadeus:offers',
  AMADEUS_PRICING: 'amadeus:pricing',
  AMADEUS_INSPIRATION: 'amadeus:inspiration',
  GF_API: 'gf:api',
});

/** Códigos de error Amadeus que NO deben reintentarse. */
const AMADEUS_NON_RETRYABLE = Object.freeze(new Set([
  400, // bad request
  401, // unauthorized (token inválido — se reintenta una vez refrescándolo)
  403, // forbidden
  404, // not found
  422, // unprocessable (ej. fecha pasada)
]));

module.exports = {
  PROVIDER_NAMES,
  DEAL_LEVELS,
  TRIP_TYPES,
  AMADEUS_LIMITS,
  AMADEUS_ENDPOINTS,
  CACHE_PREFIXES,
  AMADEUS_NON_RETRYABLE,
};
