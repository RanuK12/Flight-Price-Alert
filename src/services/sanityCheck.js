/**
 * SanityCheck — middleware de validacion anti-falso-positivo.
 *
 * Tres capas de defensa, en orden de costo creciente:
 *
 *   1. HARD FLOOR absoluto (sub-ms, in-memory).
 *      Bloquea precios fisicamente imposibles. Anti-bug parser.
 *      Long-haul OW < $250: bloqueado. Domestico AR < $25: bloqueado.
 *
 *   2. THRESHOLD-BASED FLOOR (sub-ms).
 *      Si la ruta esta en priceThresholds.js, bloqueamos < 60% del piso
 *      "steal". Esto cubre rutas conocidas con alta confianza.
 *
 *   3. HISTORICAL p25 ROLLING (~10ms, cacheado 30min).
 *      Para rutas no listadas en priceThresholds, calculamos el percentil
 *      25 historico (90 dias) y bloqueamos < 40% del p25. Auto-aprendiendo.
 *
 * Cada capa retorna severity:
 *   - 'block': descartar y NO persistir. Precio fisicamente imposible.
 *   - 'quarantine': persistir con verificationRequired=true. Telegram NO.
 *     El llamador puede intentar cross-check con Amadeus antes de descartar.
 *   - 'pass': pasa todos los checks.
 *
 * @module services/sanityCheck
 */

'use strict';

const Notification = require('../database/models/Notification');
const { getThreshold } = require('../config/priceThresholds');
const { toEur } = require('../utils/currency');
const logger = require('../utils/logger').child('sanityCheck');

/** TTL del cache de stats historicas. 30 min es buen balance: refresca rapido sin agredir Mongo. */
const STATS_TTL_MS = 30 * 60 * 1000;
/** Ventana historica para el calculo de p25. 90 dias = suficiente cobertura sin arrastrar precios obsoletos. */
const HISTORICAL_LOOKBACK_MS = 90 * 24 * 3600 * 1000;
/** Minimo de muestras para que el historico sea estadisticamente util. */
const MIN_SAMPLE = 5;
/** Si el precio es < FLOOR_RATIO * p25, lo cuarentenamos. */
const FLOOR_RATIO = 0.40;
/** Cache in-memory de stats historicas. Key = "ORIGIN-DEST-tripType". */
const _statsCache = new Map();

/** Aeropuertos AR considerados domesticos para el clasificador de hard floor. */
const AR_AIRPORTS = new Set([
  'EZE', 'AEP', 'COR', 'MDZ', 'BRC', 'USH', 'MDQ', 'ROS', 'IGR', 'NQN',
  'BHI', 'TUC', 'SLA', 'JUJ', 'CRD', 'REL', 'RGL', 'FTE', 'PSS',
]);

/**
 * @param {string} origin
 * @param {string} destination
 * @returns {boolean} true si AL MENOS un aeropuerto NO es AR (long-haul/regional).
 */
function isInternational(origin, destination) {
  const oAR = AR_AIRPORTS.has(origin);
  const dAR = AR_AIRPORTS.has(destination);
  return !(oAR && dAR);
}

/**
 * Stats historicas de una ruta (cacheado).
 *
 * IMPORTANTE: filtra notifs cuarentenadas (verificationRequired=true)
 * para evitar self-poisoning del historico.
 *
 * @param {string} origin
 * @param {string} destination
 * @param {'oneway'|'roundtrip'} tripType
 * @returns {Promise<{count:number, p25:number|null, median:number|null, avg:number|null}>}
 */
async function getRouteStats(origin, destination, tripType) {
  const key = `${origin}-${destination}-${tripType}`;
  const cached = _statsCache.get(key);
  if (cached && Date.now() - cached.ts < STATS_TTL_MS) return cached.stats;

  const since = new Date(Date.now() - HISTORICAL_LOOKBACK_MS);
  const baseMatch = {
    origin,
    destination,
    sentAt: { $gte: since },
    verificationRequired: { $ne: true },
  };
  if (tripType === 'roundtrip') {
    baseMatch.returnDate = { $ne: null };
  } else {
    baseMatch.returnDate = null;
  }

  let stats = { count: 0, p25: null, median: null, avg: null };
  try {
    const rows = await Notification.aggregate([
      { $match: baseMatch },
      { $project: { price: 1, currency: 1 } },
      { $group: {
          _id: null,
          count: { $sum: 1 },
          prices: { $push: '$price' },
          avgPrice: { $avg: '$price' },
      } },
    ]);

    if (rows.length && Array.isArray(rows[0].prices) && rows[0].prices.length) {
      const sorted = [...rows[0].prices].sort((a, b) => a - b);
      const p25 = sorted[Math.floor(sorted.length * 0.25)];
      const med = sorted[Math.floor(sorted.length * 0.50)];
      stats = { count: sorted.length, p25, median: med, avg: rows[0].avgPrice };
    }
  } catch (err) {
    logger.warn('aggregate fallo, sin stats historicas', { err: /** @type {Error} */(err).message });
  }

  _statsCache.set(key, { ts: Date.now(), stats });
  return stats;
}

/**
 * Limpia el cache de stats. Util para tests o tras un cleanup masivo.
 */
function clearStatsCache() {
  _statsCache.clear();
}

/**
 * @typedef {Object} SanityVerdict
 * @property {boolean} ok
 * @property {'pass'|'quarantine'|'block'} severity
 * @property {string} [reason]
 * @property {object} [stats]
 */

/**
 * Valida un Flight contra las 3 capas. Determinista y sin side-effects.
 *
 * @param {{
 *   origin:string, destination:string, price:number, currency?:string,
 *   tripType?:'oneway'|'roundtrip',
 * }} flight
 * @param {{ skipHistorical?: boolean }} [opts]
 * @returns {Promise<SanityVerdict>}
 */
async function check(flight, opts = {}) {
  const { skipHistorical = false } = opts;

  if (!Number.isFinite(flight.price) || flight.price <= 0) {
    return { ok: false, severity: 'block', reason: 'price not finite or <=0' };
  }

  const intl = isInternational(flight.origin, flight.destination);
  const isRT = flight.tripType === 'roundtrip';

  // === Capa 1: HARD FLOOR absoluto ===
  // Calibrado con datos reales (logs 2026-04..05): EZE→Europa OW
  // jamas vimos precios reales <$700 USD; piso conservador en $250.
  const hardFloor = intl
    ? (isRT ? 350 : 250)  // long-haul: RT pisos mas bajos por compensacion
    : 25;                  // domestico AR: pueden haber promos LCC
  if (flight.price < hardFloor) {
    return {
      ok: false, severity: 'block',
      reason: `price ${flight.price} ${flight.currency || 'EUR'} below hard floor ${hardFloor} (intl=${intl}, rt=${isRT})`,
    };
  }

  // === Capa 2: THRESHOLD-BASED FLOOR ===
  const t = getThreshold(flight.origin, flight.destination, isRT ? 'roundtrip' : 'oneway');
  if (t) {
    const priceEur = toEur(flight.price, flight.currency || 'EUR');
    const tightFloor = t.steal * 0.6;
    if (priceEur < tightFloor) {
      return {
        ok: false, severity: 'quarantine',
        reason: `priceEur ${priceEur} below 60% of steal floor (steal=${t.steal} EUR, floor=${tightFloor.toFixed(0)})`,
      };
    }
  }

  // === Capa 3: HISTORICAL p25 ===
  if (!skipHistorical) {
    const stats = await getRouteStats(
      flight.origin, flight.destination,
      isRT ? 'roundtrip' : 'oneway',
    );
    if (stats.count >= MIN_SAMPLE && stats.p25) {
      const histFloor = stats.p25 * FLOOR_RATIO;
      if (flight.price < histFloor) {
        return {
          ok: false, severity: 'quarantine',
          reason: `price ${flight.price} <${(FLOOR_RATIO * 100) | 0}% of historical p25 ${stats.p25} (n=${stats.count})`,
          stats,
        };
      }
    }
  }

  return { ok: true, severity: 'pass' };
}

module.exports = {
  check,
  getRouteStats,
  isInternational,
  clearStatsCache,
  // constantes exportadas para tests/observabilidad
  HARD_FLOORS: { intlOneWay: 250, intlRoundtrip: 350, domestic: 25 },
  FLOOR_RATIO,
  MIN_SAMPLE,
};
