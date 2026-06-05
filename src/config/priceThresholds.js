/**
 * Thresholds por ruta — valores en EUR (moneda de referencia del bot).
 *
 * v6.0 — Estrategia global AR ↔ EU全年 (todo el año).
 *
 *   • AR → EU one-way: alerta ≤ €500 (deal)
 *   • EU → AR one-way: alerta ≤ €400 (deal)
 *   • AR ↔ EU roundtrip: alerta ≤ €800 (deal)
 *
 * Niveles:
 *   • "high"   — sobre lo típico (no alerta)
 *   • "normal" — típico de temporada
 *   • "good"   — por debajo del promedio (-15%)
 *   • "great"  — oferta real del mercado (≤ deal)
 *   • "steal"  — ofertón / error-fare (≤ steal)
 *
 * @module config/priceThresholds
 */

'use strict';

/**
 * @typedef {Object} Threshold
 * @property {number} typical — precio típico/normal (EUR)
 * @property {number} deal — umbral de "great" oferta (EUR)
 * @property {number} steal — umbral de "steal" ofertón (EUR)
 * @property {string} [currency]
 */

// ── Helpers ────────────────────────────────────────────
const AR_ORIGINS = ['EZE', 'COR', 'MDQ', 'ROS'];
const EU_DESTS   = ['MAD', 'BCN', 'FCO', 'MXP', 'CDG', 'LHR', 'AMS', 'LIS', 'BER', 'VIE'];

/**
 * One-way (solo ida). Valores en EUR.
 *
 * AR → EU (threshold deal: €500):
 *   España/Portugal: cheapest (~€400-500 off-peak)
 *   Italia: mid (~€450-550)
 *   Francia/UK/NL/Alemania/Austria: higher (~€500-700)
 *
 * EU → AR (threshold deal: €400):
 *   Spain/Portugal: ~€350-500 off-peak
 *   Italy: ~€400-550
 *   Rest: ~€450-650
 *
 * @type {Record<string, Threshold>}
 */
const PRICE_THRESHOLDS = {
  // ── Doméstico Argentina (one-way) ────────────────────
  'MDQ-COR': { typical: 95, deal: 75, steal: 60 },
  'COR-MDQ': { typical: 95, deal: 75, steal: 60 },

  // ── España → Chicago (legacy) ────────────────────────
  'MAD-ORD': { typical: 520, deal: 420, steal: 360 },
  'BCN-ORD': { typical: 530, deal: 410, steal: 330 },

  // ══════════════════════════════════════════════════════
  //  AR → EU ONE-WAY  (deal ≤ €500)
  // ══════════════════════════════════════════════════════

  // ── EZE → Europa ────────────────────────────────────
  'EZE-MAD': { typical: 780, deal: 500, steal: 380 },
  'EZE-BCN': { typical: 780, deal: 500, steal: 380 },
  'EZE-FCO': { typical: 850, deal: 500, steal: 400 },
  'EZE-MXP': { typical: 850, deal: 500, steal: 400 },
  'EZE-CDG': { typical: 820, deal: 500, steal: 400 },
  'EZE-LHR': { typical: 900, deal: 500, steal: 420 },
  'EZE-AMS': { typical: 850, deal: 500, steal: 400 },
  'EZE-LIS': { typical: 750, deal: 500, steal: 380 },
  'EZE-BER': { typical: 830, deal: 500, steal: 400 },
  'EZE-VIE': { typical: 870, deal: 500, steal: 400 },

  // ── COR → Europa ────────────────────────────────────
  'COR-MAD': { typical: 860, deal: 500, steal: 400 },
  'COR-BCN': { typical: 860, deal: 500, steal: 400 },
  'COR-FCO': { typical: 920, deal: 500, steal: 420 },
  'COR-MXP': { typical: 920, deal: 500, steal: 420 },
  'COR-CDG': { typical: 900, deal: 500, steal: 420 },
  'COR-LHR': { typical: 980, deal: 500, steal: 440 },
  'COR-AMS': { typical: 930, deal: 500, steal: 420 },
  'COR-LIS': { typical: 830, deal: 500, steal: 400 },
  'COR-BER': { typical: 910, deal: 500, steal: 420 },
  'COR-VIE': { typical: 950, deal: 500, steal: 420 },

  // ── MDQ → Europa ────────────────────────────────────
  'MDQ-MAD': { typical: 900, deal: 500, steal: 400 },
  'MDQ-BCN': { typical: 900, deal: 500, steal: 400 },
  'MDQ-FCO': { typical: 960, deal: 500, steal: 420 },
  'MDQ-MXP': { typical: 960, deal: 500, steal: 420 },
  'MDQ-CDG': { typical: 940, deal: 500, steal: 420 },
  'MDQ-LHR': { typical: 1020, deal: 500, steal: 440 },
  'MDQ-AMS': { typical: 970, deal: 500, steal: 420 },
  'MDQ-LIS': { typical: 870, deal: 500, steal: 400 },
  'MDQ-BER': { typical: 950, deal: 500, steal: 420 },
  'MDQ-VIE': { typical: 990, deal: 500, steal: 420 },

  // ── ROS → Europa ────────────────────────────────────
  'ROS-MAD': { typical: 880, deal: 500, steal: 400 },
  'ROS-BCN': { typical: 880, deal: 500, steal: 400 },
  'ROS-FCO': { typical: 940, deal: 500, steal: 420 },
  'ROS-MXP': { typical: 940, deal: 500, steal: 420 },
  'ROS-CDG': { typical: 920, deal: 500, steal: 420 },
  'ROS-LHR': { typical: 1000, deal: 500, steal: 440 },
  'ROS-AMS': { typical: 950, deal: 500, steal: 420 },
  'ROS-LIS': { typical: 850, deal: 500, steal: 400 },
  'ROS-BER': { typical: 930, deal: 500, steal: 420 },
  'ROS-VIE': { typical: 970, deal: 500, steal: 420 },

  // ══════════════════════════════════════════════════════
  //  EU → AR ONE-WAY  (deal ≤ €400)
  // ══════════════════════════════════════════════════════

  // ── España → AR ─────────────────────────────────────
  'MAD-EZE': { typical: 680, deal: 400, steal: 300 },
  'BCN-EZE': { typical: 680, deal: 400, steal: 300 },
  'MAD-COR': { typical: 750, deal: 400, steal: 320 },
  'BCN-COR': { typical: 750, deal: 400, steal: 320 },
  'MAD-MDQ': { typical: 780, deal: 400, steal: 320 },
  'BCN-MDQ': { typical: 780, deal: 400, steal: 320 },
  'MAD-ROS': { typical: 760, deal: 400, steal: 320 },
  'BCN-ROS': { typical: 760, deal: 400, steal: 320 },

  // ── Italia → AR ─────────────────────────────────────
  'FCO-EZE': { typical: 700, deal: 400, steal: 310 },
  'MXP-EZE': { typical: 700, deal: 400, steal: 310 },
  'FCO-COR': { typical: 780, deal: 400, steal: 330 },
  'MXP-COR': { typical: 780, deal: 400, steal: 330 },
  'FCO-MDQ': { typical: 800, deal: 400, steal: 330 },
  'MXP-MDQ': { typical: 800, deal: 400, steal: 330 },
  'FCO-ROS': { typical: 780, deal: 400, steal: 330 },
  'MXP-ROS': { typical: 780, deal: 400, steal: 330 },

  // ── Francia/UK/NL → AR ──────────────────────────────
  'CDG-EZE': { typical: 750, deal: 400, steal: 320 },
  'CDG-COR': { typical: 830, deal: 400, steal: 340 },
  'CDG-MDQ': { typical: 850, deal: 400, steal: 340 },
  'CDG-ROS': { typical: 830, deal: 400, steal: 340 },
  'LHR-EZE': { typical: 800, deal: 400, steal: 330 },
  'LHR-COR': { typical: 880, deal: 400, steal: 350 },
  'LHR-MDQ': { typical: 900, deal: 400, steal: 350 },
  'LHR-ROS': { typical: 880, deal: 400, steal: 350 },
  'AMS-EZE': { typical: 780, deal: 400, steal: 330 },
  'AMS-COR': { typical: 860, deal: 400, steal: 350 },
  'AMS-MDQ': { typical: 880, deal: 400, steal: 350 },
  'AMS-ROS': { typical: 860, deal: 400, steal: 350 },

  // ── Alemania/Austria/Portugal/Grecia → AR ───────────
  'LIS-EZE': { typical: 650, deal: 400, steal: 300 },
  'LIS-COR': { typical: 730, deal: 400, steal: 320 },
  'LIS-MDQ': { typical: 750, deal: 400, steal: 320 },
  'LIS-ROS': { typical: 730, deal: 400, steal: 320 },
  'BER-EZE': { typical: 760, deal: 400, steal: 320 },
  'BER-COR': { typical: 840, deal: 400, steal: 340 },
  'BER-MDQ': { typical: 860, deal: 400, steal: 340 },
  'BER-ROS': { typical: 840, deal: 400, steal: 340 },
  'VIE-EZE': { typical: 770, deal: 400, steal: 320 },
  'VIE-COR': { typical: 850, deal: 400, steal: 340 },
  'VIE-MDQ': { typical: 870, deal: 400, steal: 340 },
  'VIE-ROS': { typical: 850, deal: 400, steal: 340 },

  // ── Italia → Tokio (legacy) ──────────────────────────
  'FCO-TYO': { typical: 1200, deal: 970, steal: 840 },
  'MXP-TYO': { typical: 1200, deal: 970, steal: 840 },
};

/**
 * Roundtrip (ida+vuelta). Valores en EUR.
 * deal ≤ €800 para todos los pares AR ↔ EU.
 *
 * @type {Record<string, Threshold>}
 */
const PRICE_THRESHOLDS_RT = {
  'COR-MDQ': { typical: 95, deal: 80, steal: 65 },
  'MDQ-COR': { typical: 95, deal: 80, steal: 65 },

  // ══════════════════════════════════════════════════════
  //  AR ↔ EU ROUNDTRIP  (deal ≤ €800)
  // ══════════════════════════════════════════════════════

  // ── EZE roundtrips ──────────────────────────────────
  'EZE-MAD': { typical: 1200, deal: 800, steal: 600 },
  'EZE-BCN': { typical: 1200, deal: 800, steal: 600 },
  'EZE-FCO': { typical: 1300, deal: 800, steal: 650 },
  'EZE-MXP': { typical: 1300, deal: 800, steal: 650 },
  'EZE-CDG': { typical: 1250, deal: 800, steal: 630 },
  'EZE-LHR': { typical: 1350, deal: 800, steal: 660 },
  'EZE-AMS': { typical: 1300, deal: 800, steal: 650 },
  'EZE-LIS': { typical: 1150, deal: 800, steal: 600 },
  'EZE-BER': { typical: 1280, deal: 800, steal: 640 },
  'EZE-VIE': { typical: 1320, deal: 800, steal: 650 },

  // ── COR roundtrips ──────────────────────────────────
  'COR-MAD': { typical: 1350, deal: 800, steal: 650 },
  'COR-BCN': { typical: 1350, deal: 800, steal: 650 },
  'COR-FCO': { typical: 1420, deal: 800, steal: 680 },
  'COR-MXP': { typical: 1420, deal: 800, steal: 680 },
  'COR-CDG': { typical: 1380, deal: 800, steal: 660 },
  'COR-LHR': { typical: 1480, deal: 800, steal: 700 },
  'COR-AMS': { typical: 1430, deal: 800, steal: 680 },
  'COR-LIS': { typical: 1280, deal: 800, steal: 640 },
  'COR-BER': { typical: 1400, deal: 800, steal: 670 },
  'COR-VIE': { typical: 1450, deal: 800, steal: 680 },

  // ── MDQ roundtrips ──────────────────────────────────
  'MDQ-MAD': { typical: 1400, deal: 800, steal: 660 },
  'MDQ-BCN': { typical: 1400, deal: 800, steal: 660 },
  'MDQ-FCO': { typical: 1470, deal: 800, steal: 690 },
  'MDQ-MXP': { typical: 1470, deal: 800, steal: 690 },
  'MDQ-CDG': { typical: 1430, deal: 800, steal: 670 },
  'MDQ-LHR': { typical: 1530, deal: 800, steal: 710 },
  'MDQ-AMS': { typical: 1480, deal: 800, steal: 690 },
  'MDQ-LIS': { typical: 1330, deal: 800, steal: 650 },
  'MDQ-BER': { typical: 1450, deal: 800, steal: 680 },
  'MDQ-VIE': { typical: 1500, deal: 800, steal: 690 },

  // ── ROS roundtrips ──────────────────────────────────
  'ROS-MAD': { typical: 1380, deal: 800, steal: 650 },
  'ROS-BCN': { typical: 1380, deal: 800, steal: 650 },
  'ROS-FCO': { typical: 1450, deal: 800, steal: 680 },
  'ROS-MXP': { typical: 1450, deal: 800, steal: 680 },
  'ROS-CDG': { typical: 1410, deal: 800, steal: 670 },
  'ROS-LHR': { typical: 1510, deal: 800, steal: 700 },
  'ROS-AMS': { typical: 1460, deal: 800, steal: 680 },
  'ROS-LIS': { typical: 1310, deal: 800, steal: 640 },
  'ROS-BER': { typical: 1430, deal: 800, steal: 670 },
  'ROS-VIE': { typical: 1480, deal: 800, steal: 680 },
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
