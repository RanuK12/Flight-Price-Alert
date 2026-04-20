/**
 * Thresholds por ruta — valores en EUR (moneda de referencia del bot).
 *
 * Fuente: datos de mercado reales abr-2026 reportados por el usuario
 * + cross-check con tarifas Iberia/Air Europa/AR/LATAM en jun-jul 2026.
 *
 * "steal" = ofertón (error de tarifa / promo loca, el único nivel que
 * dispara alerta cuando el usuario pide "solo ofertones").
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
  'EZE-MAD': { typical: 600, deal: 500, steal: 420 },
  'EZE-BCN': { typical: 600, deal: 500, steal: 420 },
  'EZE-FCO': { typical: 700, deal: 580, steal: 500 },
  'EZE-MXP': { typical: 700, deal: 580, steal: 500 },

  // ── Córdoba → Europa ─────────────────────────────────
  'COR-MAD': { typical: 650, deal: 550, steal: 470 },
  'COR-BCN': { typical: 650, deal: 550, steal: 470 },
  'COR-FCO': { typical: 750, deal: 620, steal: 540 },
  'COR-MXP': { typical: 750, deal: 620, steal: 540 },

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
