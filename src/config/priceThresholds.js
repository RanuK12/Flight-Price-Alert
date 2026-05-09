/**
 * Thresholds por ruta — valores en EUR (moneda de referencia del bot).
 *
 * Fuente: datos de mercado reales abr-may 2026 reportados por el usuario,
 * + cross-check con tarifas Iberia/Air Europa/AR/LATAM/ITA en jun-jul 2026,
 * + observaciones del scraper (logs may-2026: EZE→FCO min $752-755 USD
 *   en ITA/Iberia directo ≈ €680-685 EUR).
 *
 * Niveles (EUR):
 *   • "high"   — sobre lo típico (no alerta nunca)
 *   • "normal" — típico de temporada (sin alerta por defecto)
 *   • "good"   — por debajo del promedio (-15%); alerta si user = good+
 *   • "great"  — oferta real del mercado (-20/25%); alerta si user = great+
 *   • "steal"  — ofertón (-30% o error-fare); alerta siempre
 *
 * IMPORTANTE: en el pipeline (alertEngine) los precios del scraper suelen
 * venir en USD. Se convierten a EUR antes de classifyPrice vía
 * utils/currency.toEur. Mantener los valores acá SIEMPRE en EUR.
 *
 * @module config/priceThresholds
 */

'use strict';

/**
 * @typedef {Object} Threshold
 * @property {number} typical
 * @property {number} deal
 * @property {number} steal
 * @property {string} [currency]
 */

/**
 * One-way (solo ida). Valores en EUR.
 *
 * Argentina→Europa temporada alta jun-jul:
 *   • EZE→MAD/BCN: tarifa baja €460-580, directos Iberia/AE rara vez <€750.
 *   • EZE→FCO/MXP: €580-700 (€50-100 más que España).
 *   • COR→MAD/BCN: piso más alto por menor competencia (€550-650).
 *   • COR→FCO/MXP: €620-750.
 *
 * @type {Record<string, Threshold>}
 */
const PRICE_THRESHOLDS = {
  // ── Doméstico Argentina (one-way) ────────────────────
  // Típico mayo: €87-105. Ganga: €71-80. Ofertón: <€60.
  'MDQ-COR': { typical: 95, deal: 75, steal: 60 },
  'COR-MDQ': { typical: 95, deal: 75, steal: 60 },

  // ── España → Chicago ─────────────────────────────────
  'MAD-ORD': { typical: 520, deal: 420, steal: 360 },
  'BCN-ORD': { typical: 530, deal: 410, steal: 330 },

  // ── Buenos Aires → Europa (jun-jul) ──────────────────
  // Recalibrado may-2026 tras observar piso de mercado real en logs:
  // EZE→FCO/MXP directos ITA/Iberia: $752-755 USD ≈ €690.
  // Umbrales en EUR. Usamos 'deal' (great) ≈ piso real del mercado,
  // para que alertMinLevel='good' dispare cuando aparece ese piso.
  'EZE-MAD': { typical: 780, deal: 640, steal: 520 },
  'EZE-BCN': { typical: 780, deal: 640, steal: 520 },
  'EZE-FCO': { typical: 850, deal: 720, steal: 600 },
  'EZE-MXP': { typical: 850, deal: 720, steal: 600 },

  // ── Córdoba → Europa ─────────────────────────────────
  // COR tiene menos competencia directa, piso típicamente €50-80 más alto.
  'COR-MAD': { typical: 860, deal: 700, steal: 580 },
  'COR-BCN': { typical: 860, deal: 700, steal: 580 },
  'COR-FCO': { typical: 920, deal: 780, steal: 640 },
  'COR-MXP': { typical: 920, deal: 780, steal: 640 },

  // ── Italia → Tokio (sep/oct) ─────────────────────────
  'FCO-TYO': { typical: 1200, deal: 970, steal: 840 },
  'MXP-TYO': { typical: 1200, deal: 970, steal: 840 },
};

/**
 * Roundtrip (ida+vuelta). Valores en EUR.
 *
 * COR↔MDQ RT 7 días (mayo, temporada baja):
 *   • Ganga: €71-80 (muy baja, con escalas)
 *   • Promedio: €87-105
 *   • Directos: ~€115
 *   • Ofertón: <€65 (requiere promo o error de tarifa)
 *
 * @type {Record<string, Threshold>}
 */
const PRICE_THRESHOLDS_RT = {
  'COR-MDQ': { typical: 95, deal: 80, steal: 65 },
  'MDQ-COR': { typical: 95, deal: 80, steal: 65 },
};

/**
 * Devuelve el threshold de una ruta.
 * @param {string} origin
 * @param {string} destination
 * @param {'oneway'|'roundtrip'} [tripType='oneway']
 * @returns {Threshold|null}
 */
function getThreshold(origin, destination, tripType = 'oneway') {
  const key = `${origin}-${destination}`;
  const table = tripType === 'roundtrip' ? PRICE_THRESHOLDS_RT : PRICE_THRESHOLDS;
  return table[key] || null;
}

/**
 * Clasifica un precio contra sus thresholds.
 * @param {string} origin
 * @param {string} destination
 * @param {number} price
 * @param {'oneway'|'roundtrip'} [tripType='oneway']
 * @returns {{level: 'steal'|'great'|'good'|'normal'|'high', threshold: Threshold|null}}
 */
function classifyPrice(origin, destination, price, tripType = 'oneway') {
  const threshold = getThreshold(origin, destination, tripType);
  if (!threshold) return { level: 'normal', threshold: null };
  if (price <= threshold.steal) return { level: 'steal', threshold };
  if (price <= threshold.deal) return { level: 'great', threshold };
  if (price <= threshold.typical * 0.85) return { level: 'good', threshold };
  if (price <= threshold.typical) return { level: 'normal', threshold };
  return { level: 'high', threshold };
}

module.exports = {
  PRICE_THRESHOLDS,
  PRICE_THRESHOLDS_RT,
  getThreshold,
  classifyPrice,
};
