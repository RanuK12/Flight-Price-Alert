/**
 * HybridSearch — capa de decisión que enruta búsquedas a Amadeus o al
 * scraper según el contexto, respetando la cuota mensual y cayendo a
 * fallbacks si un provider falla.
 *
 * Reglas de enrutamiento (simplificadas):
 *   • Interactivo (bot `/buscar`):   Amadeus → fallback GoogleFlights
 *   • Monitoreo masivo (cron):       GoogleFlights (scraper)
 *   • Validación pre-alerta:         Amadeus (pricing confirm)
 *   • Rutas nuevas / inspiración:    Amadeus (exclusivo)
 *
 * Si el budget mensual de Amadeus está agotado se degrada a scraper
 * para operaciones on-demand, con warning al usuario.
 *
 * @module services/hybridSearch
 */

'use strict';

const { config } = require('../config');
const { PROVIDER_NAMES, CACHE_PREFIXES } = require('../config/constants');
const logger = require('../utils/logger').child('hybrid');
const amadeus = require('../providers/amadeus');
const cacheRepo = require('../database/repositories/cacheRepo');
const usageRepo = require('../database/repositories/usageRepo');
const {
  QuotaExceededError,
  RateLimitError,
  CircuitOpenError,
  UpstreamError,
} = require('../utils/errors');

/**
 * @typedef {import('../providers/base').FlightSearchParams} FlightSearchParams
 * @typedef {import('../providers/base').FlightSearchResult} FlightSearchResult
 */

/** Modos de uso que influyen en la decisión. */
const MODE = Object.freeze({
  INTERACTIVE: 'interactive',   // búsqueda sincrónica en el bot
  BACKGROUND:  'background',    // cron, monitoreo masivo
  VALIDATION:  'validation',    // confirmar oferta antes de alertar
});

/** Adapter singleton para cache de Amadeus. */
const amadeusCache = cacheRepo.createAdapter({ ttlMs: config.cache.amadeusTtlMs });

/** Provider singleton con cache enganchado. */
const amadeusProvider = new amadeus.FlightOffersProvider({ cache: amadeusCache });

/**
 * Indica si podemos usar Amadeus ahora mismo (budget mensual + diario).
 * `ok` es true sólo si quedan llamadas en ambos cubetas.
 * @returns {Promise<{ok: boolean, okMonthly: boolean, okDaily: boolean,
 *   used: number, budget: number, usedToday: number, dailyBudget: number}>}
 */
async function checkAmadeusBudget() {
  const [used, usedToday] = await Promise.all([
    usageRepo.getMonthly(PROVIDER_NAMES.AMADEUS),
    usageRepo.getToday(PROVIDER_NAMES.AMADEUS),
  ]);
  const budget = config.amadeus.monthlyBudget;
  const dailyBudget = config.amadeus.dailyBudget;
  const okMonthly = used < budget;
  const okDaily = usedToday < dailyBudget;
  return {
    ok: okMonthly && okDaily,
    okMonthly, okDaily,
    used, budget,
    usedToday, dailyBudget,
  };
}

/**
 * Busca vuelos respetando el modo solicitado.
 *
 * @param {FlightSearchParams} params
 * @param {{mode?: 'interactive'|'background'|'validation', forceProvider?: 'amadeus'|'google_flights'}} [opts]
 * @returns {Promise<FlightSearchResult & {providerUsed: string, warnings?: string[]}>}
 */
async function search(params, opts = {}) {
  const mode = opts.mode || MODE.INTERACTIVE;
  const warnings = [];

  // forceProvider override: salta la lógica híbrida y usa el provider pedido.
  if (opts.forceProvider === PROVIDER_NAMES.GOOGLE_FLIGHTS) {
    return runScraper(params, warnings);
  }
  if (opts.forceProvider === PROVIDER_NAMES.AMADEUS) {
    const budget = await checkAmadeusBudget();
    if (!budget.ok) {
      const which = !budget.okDaily ? 'daily' : 'monthly';
      throw new QuotaExceededError(
        `Amadeus ${which} budget reached ` +
        `(day ${budget.usedToday}/${budget.dailyBudget}, ` +
        `month ${budget.used}/${budget.budget})`,
      );
    }
    const result = await amadeusProvider.search(params);
    if (!result.cached) await usageRepo.increment(PROVIDER_NAMES.AMADEUS);
    return { ...result, providerUsed: PROVIDER_NAMES.AMADEUS, warnings };
  }

  const preferAmadeus = mode === MODE.INTERACTIVE || mode === MODE.VALIDATION;

  if (preferAmadeus) {
    const budget = await checkAmadeusBudget();
    if (!budget.ok) {
      const which = !budget.okDaily ? 'diaria' : 'mensual';
      warnings.push(
        `Cuota Amadeus ${which} agotada — usando scraper ` +
        `(día ${budget.usedToday}/${budget.dailyBudget}, ` +
        `mes ${budget.used}/${budget.budget})`,
      );
      logger.warn('Amadeus budget exhausted, falling back', budget);
      return runScraper(params, warnings);
    }

    try {
      const result = await amadeusProvider.search(params);
      if (!result.cached) {
        await usageRepo.increment(PROVIDER_NAMES.AMADEUS);
      }
      return { ...result, providerUsed: PROVIDER_NAMES.AMADEUS, warnings };
    } catch (err) {
      const fallbackable =
        err instanceof RateLimitError ||
        err instanceof CircuitOpenError ||
        err instanceof UpstreamError ||
        err instanceof QuotaExceededError;

      if (!fallbackable) throw err;

      warnings.push(`Amadeus unavailable: ${/** @type {Error} */ (err).message}`);
      logger.warn('Amadeus failed, falling back to scraper', {
        error: /** @type {Error} */ (err).message,
      });
      try {
        return await runScraper(params, warnings);
      } catch (scraperErr) {
        const msg = /** @type {Error} */(scraperErr).message || 'unknown';
        if (msg.includes('scraper-timeout')) {
          warnings.push('Scraper timeout (>30s) — intentá de nuevo más tarde');
          logger.warn('Scraper timeout, no fallback available');
          return emptyResult(warnings);
        }
        throw scraperErr;
      }
    }
  }

  // Background: scraper primero (evitar gastar Amadeus en cron masivos).
  try {
    return await runScraper(params, warnings);
  } catch (scraperErr) {
    const msg = /** @type {Error} */(scraperErr).message || 'unknown';
    if (msg.includes('scraper-timeout')) {
      warnings.push('Scraper timeout (>30s) — intentá de nuevo más tarde');
      logger.warn('Scraper timeout en background');
      return emptyResult(warnings);
    }
    throw scraperErr;
  }
}

/**
 * Invoca al scraper vía scraperWorker (con timeout) y lo normaliza
 * a la shape `FlightSearchResult`.
 *
 * @param {FlightSearchParams} params
 * @param {string[]} warnings
 */
async function runScraper(params, warnings) {
  const scraperWorker = require('./scraperWorker');

  const cacheKey = [
    params.origin, params.destination, params.departureDate,
    params.returnDate || 'ow', params.adults || 1,
  ].join('|');

  const cached = await cacheRepo.getCache(CACHE_PREFIXES.GF_API, cacheKey);
  if (cached) {
    return { ...cached, cached: true, providerUsed: PROVIDER_NAMES.GOOGLE_FLIGHTS, warnings };
  }

  const raw = await scraperWorker.search(
    params.origin,
    params.destination,
    params.departureDate,
    params.returnDate || null,
  );

  const flights = (raw?.flights || []).map((f) => ({
    source: 'google_flights',
    origin: params.origin,
    destination: params.destination,
    price: Number(f.price),
    currency: f.currency || 'USD',
    tripType: params.returnDate ? 'roundtrip' : 'oneway',
    departureDate: params.departureDate,
    returnDate: params.returnDate || null,
    airline: f.airline || 'Unknown',
    carrierCodes: f.carrierCodes || [],
    stops: Number(f.stops ?? 0),
    duration: f.totalDuration ? `PT${f.totalDuration}M` : undefined,
    bookingUrl: raw.searchUrl,
    fetchedAt: new Date().toISOString(),
  }));

  const result = {
    flights,
    source: PROVIDER_NAMES.GOOGLE_FLIGHTS,
    cached: false,
    fetchedAt: new Date().toISOString(),
    meta: { count: flights.length },
  };

  if (flights.length > 0) {
    await cacheRepo.setCache(CACHE_PREFIXES.GF_API, cacheKey, result, config.cache.gfTtlMs);
  }
  await usageRepo.increment(PROVIDER_NAMES.GOOGLE_FLIGHTS);

  return { ...result, providerUsed: PROVIDER_NAMES.GOOGLE_FLIGHTS, warnings };
}

/**
 * Resultado vacío cuando el scraper timeout y no hay fallback.
 * @param {string[]} warnings
 * @returns {import('../providers/base').FlightSearchResult & {providerUsed: string, warnings: string[]}}
 */
function emptyResult(warnings) {
  return {
    flights: [],
    source: PROVIDER_NAMES.GOOGLE_FLIGHTS,
    cached: false,
    fetchedAt: new Date().toISOString(),
    meta: { count: 0 },
    providerUsed: PROVIDER_NAMES.GOOGLE_FLIGHTS,
    warnings,
  };
}

/**
 * Pricing confirmation (sólo Amadeus). Si la oferta original no viene
 * de Amadeus no se puede confirmar → devolvemos `{confirmed:false, reason}`.
 *
 * @param {import('../providers/base').Flight & {raw?: any}} flight
 */
async function confirmPrice(flight) {
  if (flight.source !== PROVIDER_NAMES.AMADEUS || !flight.raw) {
    return { confirmed: false, reason: 'Not an Amadeus offer' };
  }
  const budget = await checkAmadeusBudget();
  if (!budget.ok) {
    return {
      confirmed: false,
      reason: `Amadeus budget exhausted (day ${budget.usedToday}/${budget.dailyBudget})`,
    };
  }
  const result = await amadeus.pricing.confirmOffer(flight.raw);
  await usageRepo.increment(PROVIDER_NAMES.AMADEUS);
  return { confirmed: true, ...result };
}

/**
 * Inspiration search — exclusivo Amadeus. Si no hay presupuesto,
 * lanza QuotaExceededError (no hay fallback razonable).
 *
 * @param {import('../providers/amadeus/inspirationSearch').InspirationParams} params
 */
async function inspire(params) {
  const budget = await checkAmadeusBudget();
  if (!budget.ok) {
    const which = !budget.okDaily ? 'diaria' : 'mensual';
    throw new QuotaExceededError(
      `Cuota Amadeus ${which} agotada ` +
      `(día ${budget.usedToday}/${budget.dailyBudget}, ` +
      `mes ${budget.used}/${budget.budget}). Probá de nuevo mañana.`,
    );
  }
  const results = await amadeus.inspiration.searchDestinations(params);
  await usageRepo.increment(PROVIDER_NAMES.AMADEUS);
  return results;
}

module.exports = {
  MODE,
  search,
  confirmPrice,
  inspire,
  checkAmadeusBudget,
};
