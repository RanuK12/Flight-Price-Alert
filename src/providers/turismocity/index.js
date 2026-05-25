/**
 * TurismoCity provider — wrapper sobre el scraper Puppeteer
 * (`server/scrapers/turismocity.js`) que adapta su salida al contrato
 * `FlightProvider` definido en `providers/base.js`.
 *
 * Roles dentro del sistema:
 *   • Tercer fallback en background (después de Google Flights). Útil
 *     cuando Google no devuelve nada (rutas de bajo volumen) o queremos
 *     una segunda fuente para detectar tarifas anómalas.
 *   • Metabuscador AR-céntrico: cubre OTAs (Almundo, Avantrip, Despegar,
 *     Iberia, Air Europa, ITA, Plus Ultra, Wamos Air...) que Amadeus no
 *     siempre indexa con el precio final post-impuestos AR.
 *
 * Particularidades:
 *   • Devuelve precios en la moneda que TurismoCity muestre (suele ser
 *     ARS para usuarios desde Argentina, USD/EUR según ruta). El
 *     alertEngine ya convierte a EUR vía utils/currency.toEur antes de
 *     comparar contra thresholds, así que no hace falta convertir acá.
 *   • Si Puppeteer no está disponible (sandbox sin Chrome, Render free
 *     OOM, etc.), el scraper devuelve `unavailable: true` y nosotros
 *     producimos un FlightSearchResult vacío con `meta.unavailable`,
 *     sin lanzar excepción. Así el caller puede seguir su pipeline.
 *
 * @module providers/turismocity
 */

'use strict';

const { FlightProvider } = require('../base');
const { CACHE_PREFIXES, PROVIDER_NAMES } = require('../../config/constants');
const logger = require('../../utils/logger').child('turismocity');

// ─── Lazy require del scraper para evitar fallas en arranque si
// Puppeteer no está instalado. El módulo turismocity.js maneja eso
// internamente, pero require() puede fallar si fs/puppeteer-extra
// faltan en runtime. Lo envolvemos en try/catch al primer uso.
let _scraper = null;
function getScraper() {
  if (_scraper) return _scraper;
  try {
    // eslint-disable-next-line global-require
    _scraper = require('../../../server/scrapers/turismocity');
    return _scraper;
  } catch (err) {
    logger.warn('TurismoCity scraper require failed', {
      err: /** @type {Error} */ (err).message,
    });
    return null;
  }
}

/**
 * @typedef {import('../base').FlightSearchParams} FlightSearchParams
 * @typedef {import('../base').FlightSearchResult} FlightSearchResult
 * @typedef {import('../base').Flight} Flight
 */

/**
 * Provider TurismoCity.
 */
class TurismoCityProvider extends FlightProvider {
  /** @param {{cache?: import('../../database/repositories/cacheRepo').CacheAdapter}} [deps] */
  constructor(deps = {}) {
    super(PROVIDER_NAMES.TURISMOCITY);
    this.cache = deps.cache || null;
  }

  /**
   * Busca vuelos en TurismoCity para una ruta específica.
   *
   * @param {FlightSearchParams} params
   * @returns {Promise<FlightSearchResult>}
   */
  async search(params) {
    const normalized = normalizeParams(params);
    const ck = buildCacheKey(normalized);

    if (this.cache) {
      try {
        const hit = await this.cache.get(CACHE_PREFIXES.TURISMOCITY, ck);
        if (hit) {
          return { ...hit, cached: true };
        }
      } catch (err) {
        // Cache no debe romper la búsqueda
        logger.debug('Cache get failed', { err: /** @type {Error} */ (err).message });
      }
    }

    const scraper = getScraper();
    if (!scraper) {
      return emptyResult(normalized, { unavailable: true, reason: 'scraper-not-loadable' });
    }

    if (!scraper.isAvailable()) {
      return emptyResult(normalized, { unavailable: true, reason: 'puppeteer-disabled' });
    }

    logger.info('Searching TurismoCity', {
      origin: normalized.origin,
      destination: normalized.destination,
      departureDate: normalized.departureDate,
      returnDate: normalized.returnDate || null,
    });

    let raw;
    try {
      raw = await scraper.scrapeTurismoCity(
        normalized.origin,
        normalized.destination,
        normalized.departureDate,
        normalized.returnDate || null,
      );
    } catch (err) {
      logger.warn('TurismoCity scrape threw', {
        err: /** @type {Error} */ (err).message,
      });
      return emptyResult(normalized, { error: /** @type {Error} */ (err).message });
    }

    if (!raw) return emptyResult(normalized, { error: 'empty-scrape-result' });

    if (raw.unavailable) {
      // El scraper se autodeclaró indisponible (no Chrome / forzado off).
      return emptyResult(normalized, { unavailable: true, reason: raw.error });
    }

    const flights = (raw.flights || [])
      .map((f) => mapToFlight(f, normalized, raw.searchUrl))
      .filter(Boolean);

    /** @type {FlightSearchResult} */
    const result = {
      flights,
      source: PROVIDER_NAMES.TURISMOCITY,
      cached: false,
      fetchedAt: new Date().toISOString(),
      meta: {
        count: flights.length,
        rawCount: raw.flights?.length || 0,
        searchUrl: raw.searchUrl,
        ...(raw.error ? { error: raw.error } : {}),
        ...(raw.meta || {}),
      },
    };

    if (this.cache && flights.length > 0) {
      try {
        await this.cache.set(CACHE_PREFIXES.TURISMOCITY, ck, result);
      } catch (err) {
        logger.debug('Cache set failed', { err: /** @type {Error} */ (err).message });
      }
    }

    return result;
  }

  /** Healthcheck: solo informa si el scraper está cargado/habilitado. */
  // eslint-disable-next-line class-methods-use-this
  async health() {
    const s = getScraper();
    if (!s) return { ok: false, detail: 'scraper-not-loadable' };
    return s.isAvailable()
      ? { ok: true }
      : { ok: false, detail: 'puppeteer-disabled-or-unavailable' };
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
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
    currency: p.currency || 'EUR',
  };
}

function buildCacheKey(p) {
  return [p.origin, p.destination, p.departureDate, p.returnDate || 'ow', p.adults]
    .join('|');
}

/**
 * Convierte la salida del scraper a la shape `Flight`.
 *
 * @param {{
 *   price:number, currency:string, airline:string, stops:number|null,
 *   source:string, departureDate:string, returnDate:string|null,
 *   tripType:string, link:string,
 * }} f
 * @param {ReturnType<typeof normalizeParams>} params
 * @param {string} fallbackUrl
 * @returns {Flight|null}
 */
function mapToFlight(f, params, fallbackUrl) {
  if (!Number.isFinite(f.price) || f.price <= 0) return null;
  const tripType = f.returnDate ? 'roundtrip' : 'oneway';
  return {
    source: PROVIDER_NAMES.TURISMOCITY,
    origin: params.origin,
    destination: params.destination,
    price: Number(f.price),
    currency: (f.currency || 'ARS').toUpperCase(),
    tripType,
    departureDate: f.departureDate || params.departureDate,
    returnDate: f.returnDate || params.returnDate || null,
    airline: f.airline || 'Multiple',
    carrierCodes: [],
    stops: typeof f.stops === 'number' && f.stops >= 0 ? f.stops : 0,
    duration: undefined,
    segments: undefined,
    returnSegments: undefined,
    bookingUrl: f.link || fallbackUrl,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * @param {ReturnType<typeof normalizeParams>} params
 * @param {{unavailable?:boolean, reason?:string, error?:string}} [meta]
 * @returns {FlightSearchResult}
 */
function emptyResult(params, meta = {}) {
  return {
    flights: [],
    source: PROVIDER_NAMES.TURISMOCITY,
    cached: false,
    fetchedAt: new Date().toISOString(),
    meta: { count: 0, ...meta, params: { ...params } },
  };
}

module.exports = {
  TurismoCityProvider,
  // Helper funcional (paridad con providers/amadeus).
  /** @param {FlightSearchParams} params */
  search: async (params) => new TurismoCityProvider().search(params),
};
