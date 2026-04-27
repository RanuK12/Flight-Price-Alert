/**
 * Amadeus Flight Offers Search — búsqueda principal de vuelos.
 * Mapea la respuesta cruda a la shape normalizada `Flight` definida
 * en `providers/base.js`.
 *
 * @module providers/amadeus/flightOffers
 */

'use strict';

const { AMADEUS_ENDPOINTS, AMADEUS_LIMITS, CACHE_PREFIXES } = require('../../config/constants');
const { FlightProvider } = require('../base');
const { NoResultsError } = require('../../utils/errors');
const logger = require('../../utils/logger').child('amadeus:offers');
const { getClient } = require('./client');

/**
 * @typedef {import('../base').FlightSearchParams} FlightSearchParams
 * @typedef {import('../base').FlightSearchResult} FlightSearchResult
 * @typedef {import('../base').Flight} Flight
 * @typedef {import('../base').FlightSegment} FlightSegment
 */

/**
 * Provider Amadeus para búsqueda de ofertas.
 * Extiende FlightProvider para cumplir el contrato común.
 */
class AmadeusFlightOffersProvider extends FlightProvider {
  /** @param {{cache?: CacheAdapter}} [deps] */
  constructor(deps = {}) {
    super('amadeus');
    this.client = getClient();
    this.cache = deps.cache || null;
  }

  /**
   * Busca ofertas. Consulta cache primero si hay adaptador.
   * @param {FlightSearchParams} params
   * @returns {Promise<FlightSearchResult>}
   */
  async search(params) {
    const normalized = normalizeParams(params);
    const cacheKey = buildCacheKey(normalized);

    if (this.cache) {
      const hit = await this.cache.get(CACHE_PREFIXES.AMADEUS_OFFERS, cacheKey);
      if (hit) {
        logger.debug('cache hit', { cacheKey });
        return { ...hit, cached: true };
      }
    }

    const query = buildQuery(normalized);
    logger.info('Searching Amadeus', {
      origin: normalized.origin,
      destination: normalized.destination,
      departureDate: normalized.departureDate,
      returnDate: normalized.returnDate || null,
    });

    const data = await this.client.request({
      method: 'GET',
      url: AMADEUS_ENDPOINTS.FLIGHT_OFFERS_SEARCH,
      params: query,
    });

    const offers = Array.isArray(data?.data) ? data.data : [];
    const dictionaries = data?.dictionaries || {};
    const flights = offers
      .map((offer) => mapOfferToFlight(offer, dictionaries, normalized))
      .filter(Boolean);

    const result = {
      flights,
      source: 'amadeus',
      cached: false,
      fetchedAt: new Date().toISOString(),
      meta: {
        count: flights.length,
        rawCount: offers.length,
      },
    };

    if (this.cache && flights.length > 0) {
      await this.cache.set(CACHE_PREFIXES.AMADEUS_OFFERS, cacheKey, result);
    }

    if (flights.length === 0) {
      // No es error, pero lo señalamos por trazabilidad
      logger.debug('No results', { cacheKey });
    }

    return result;
  }

  /** Healthcheck: intenta obtener token. */
  async health() {
    try {
      await this.client.getToken();
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: /** @type {Error} */ (err).message };
    }
  }
}

/**
 * @typedef {Object} CacheAdapter
 * @property {(prefix: string, key: string) => Promise<any|null>} get
 * @property {(prefix: string, key: string, value: any) => Promise<void>} set
 */

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Aplica defaults y saneamiento.
 * @param {FlightSearchParams} p
 */
function normalizeParams(p) {
  if (!p?.origin || !p?.destination || !p?.departureDate) {
    throw new Error('origin, destination, departureDate are required');
  }
  return {
    origin: String(p.origin).toUpperCase(),
    destination: String(p.destination).toUpperCase(),
    departureDate: p.departureDate,
    returnDate: p.returnDate || null,
    adults: p.adults ?? 1,
    children: p.children ?? 0,
    infants: p.infants ?? 0,
    currency: p.currency || AMADEUS_LIMITS.DEFAULT_CURRENCY,
    max: Math.min(p.max ?? 10, AMADEUS_LIMITS.MAX_RESULTS_PER_SEARCH),
    travelClass: p.travelClass,
    nonStop: p.nonStop ?? false,
  };
}

/**
 * Construye los query params de la API de Amadeus.
 * @param {ReturnType<typeof normalizeParams>} p
 */
function buildQuery(p) {
  /** @type {Record<string, string|number|boolean>} */
  const q = {
    originLocationCode: p.origin,
    destinationLocationCode: p.destination,
    departureDate: p.departureDate,
    adults: p.adults,
    currencyCode: p.currency,
    max: p.max,
  };
  if (p.returnDate) q.returnDate = p.returnDate;
  if (p.children > 0) q.children = p.children;
  if (p.infants > 0) q.infants = p.infants;
  if (p.travelClass) q.travelClass = p.travelClass;
  if (p.nonStop) q.nonStop = true;
  return q;
}

/**
 * Clave de cache determinística para una búsqueda.
 * @param {ReturnType<typeof normalizeParams>} p
 */
function buildCacheKey(p) {
  return [
    p.origin, p.destination, p.departureDate, p.returnDate || 'ow',
    p.adults, p.children, p.infants, p.currency, p.max,
    p.travelClass || 'any', p.nonStop ? '1' : '0',
  ].join('|');
}

/**
 * Convierte una oferta Amadeus a nuestra shape `Flight`.
 * Retorna null si la oferta no se puede parsear.
 *
 * @param {Record<string, any>} offer
 * @param {Record<string, any>} dictionaries
 * @param {ReturnType<typeof normalizeParams>} params
 * @returns {Flight|null}
 */
function mapOfferToFlight(offer, dictionaries, params) {
  try {
    const itineraries = offer.itineraries || [];
    if (itineraries.length === 0) return null;

    const outbound = itineraries[0];
    const inbound = itineraries[1];

    const outSegments = (outbound.segments || []).map(mapSegment);
    const inSegments = inbound ? (inbound.segments || []).map(mapSegment) : undefined;

    const carriers = new Set();
    for (const s of outSegments) carriers.add(s.carrierCode);
    if (inSegments) for (const s of inSegments) carriers.add(s.carrierCode);
    const carrierCodes = Array.from(carriers);
    const airlineName = carrierCodes.length === 1
      ? (dictionaries?.carriers?.[carrierCodes[0]] || carrierCodes[0])
      : 'Multiple';

    const firstSeg = outSegments[0];
    const lastSeg = outSegments[outSegments.length - 1];
    const departureDate = firstSeg?.departureAt?.split('T')[0] || params.departureDate;
    const returnDate = inbound
      ? inSegments?.[0]?.departureAt?.split('T')[0] || params.returnDate
      : null;

    return {
      source: 'amadeus',
      origin: firstSeg?.origin || params.origin,
      destination: lastSeg?.destination || params.destination,
      price: Number.parseFloat(offer.price?.total ?? offer.price?.grandTotal ?? '0'),
      currency: offer.price?.currency || params.currency,
      tripType: inbound ? 'roundtrip' : 'oneway',
      departureDate,
      returnDate: returnDate || null,
      airline: airlineName,
      carrierCodes,
      stops: Math.max(0, outSegments.length - 1),
      duration: outbound.duration,
      segments: outSegments,
      returnSegments: inSegments,
      // NOTA: No usamos Google Flights porque los precios pueden diferir
        bookingUrl: null, // Sin link - Amadeus no provee deep link universal
      offerId: offer.id,
      fetchedAt: new Date().toISOString(),
      // raw: offer, // activar para debug; desactivado en prod por tamaño
    };
  } catch (err) {
    logger.warn('Failed to map offer', { error: /** @type {Error} */ (err).message });
    return null;
  }
}

/**
 * @param {Record<string, any>} segment
 * @returns {FlightSegment}
 */
function mapSegment(segment) {
  return {
    origin: segment.departure?.iataCode,
    destination: segment.arrival?.iataCode,
    departureAt: segment.departure?.at,
    arrivalAt: segment.arrival?.at,
    carrierCode: segment.carrierCode,
    flightNumber: segment.number ? `${segment.carrierCode}${segment.number}` : undefined,
    duration: segment.duration,
    aircraft: segment.aircraft?.code,
    cabin: undefined, // Se llena desde travelerPricings si se necesita detalle
  };
}

/**
 * Deep link a Google Flights (fallback universal para reserva).
 * Amadeus no provee URL directa de booking.
 *
 * @param {string} origin
 * @param {string} destination
 * @param {string} departureDate
 * @param {string|null} [returnDate]
 */
function buildGoogleFlightsDeepLink(origin, destination, departureDate, returnDate) {
  const parts = [`Flights from ${origin} to ${destination} on ${departureDate}`];
  if (returnDate) parts.push(`returning ${returnDate}`);
  const q = encodeURIComponent(parts.join(' '));
  return `https://www.google.com/travel/flights?q=${q}&curr=USD&hl=es`;
}

/**
 * Helper funcional para uso rápido sin instanciar el provider.
 * (Compatibilidad con `server/scrapers/amadeus.js` actual.)
 *
 * @param {FlightSearchParams} params
 * @returns {Promise<FlightSearchResult>}
 */
async function searchFlights(params) {
  const provider = new AmadeusFlightOffersProvider();
  return provider.search(params);
}

/**
 * Wrapper de solo ida (compat con el módulo viejo).
 * @param {string} origin
 * @param {string} destination
 * @param {string} departureDate
 */
async function searchOneWay(origin, destination, departureDate) {
  return searchFlights({ origin, destination, departureDate });
}

/**
 * Wrapper de ida y vuelta (compat con el módulo viejo).
 * @param {string} origin
 * @param {string} destination
 * @param {string} departureDate
 * @param {string} returnDate
 */
async function searchRoundTrip(origin, destination, departureDate, returnDate) {
  return searchFlights({ origin, destination, departureDate, returnDate });
}

module.exports = {
  AmadeusFlightOffersProvider,
  searchFlights,
  searchOneWay,
  searchRoundTrip,
  mapOfferToFlight, // export para tests
};

/* eslint no-unused-vars: 0 */
void NoResultsError;
