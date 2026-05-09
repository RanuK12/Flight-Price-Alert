/**
 * Conversión de moneda minimalista.
 *
 * El bot usa EUR como moneda de referencia para thresholds y clasificación
 * (priceThresholds.js). Sin embargo, el scraper de Google Flights suele
 * devolver precios en USD (no siempre respeta el currency pedido, sobre
 * todo para rutas originadas en Argentina).
 *
 * Para evitar el bug "precios USD comparados contra thresholds EUR"
 * (falsos "high" que bloquean toda notificación), este módulo provee una
 * conversión a EUR barata y resiliente:
 *
 *   • Usa tasas hardcodeadas conservadoras por defecto (offline).
 *   • Refresca en background cada 12h desde exchangerate.host (si hay red).
 *   • Nunca bloquea: si la red falla, sigue usando la última tasa conocida.
 *
 * @module utils/currency
 */

'use strict';

const logger = require('./logger').child('currency');

/**
 * Tasas fallback conservadoras (may-2026). Unidades: "cuántos EUR es 1 X".
 * Valores elegidos para ser levemente CONSERVADORES (sobre-estimar EUR)
 * de forma que un precio convertido nunca se subestime y disparemos alertas
 * falsas. Mejor que alguna vez no alertemos a que alertemos con un falso
 * precio bajo.
 * @type {Record<string, number>}
 */
const FALLBACK_RATES = {
  EUR: 1.00,
  USD: 0.92,   // 1 USD ≈ 0.92 EUR
  GBP: 1.17,
  ARS: 0.0009,
  BRL: 0.16,
  JPY: 0.0059,
  MXN: 0.050,
};

/** Tasas vigentes (mutable, se refrescan en background). */
let currentRates = { ...FALLBACK_RATES };
let lastRefreshAt = 0;

/**
 * Convierte un monto a EUR. Nunca falla: si la moneda no se reconoce,
 * asume EUR (no convierte) y loggea warn.
 *
 * @param {number} amount
 * @param {string} [currency='EUR']
 * @returns {number} monto en EUR, redondeado a entero
 */
function toEur(amount, currency = 'EUR') {
  if (!Number.isFinite(amount)) return NaN;
  const code = String(currency || 'EUR').toUpperCase();
  const rate = currentRates[code];
  if (!rate) {
    logger.warn('Moneda desconocida, asumiendo EUR', { currency: code });
    return Math.round(amount);
  }
  return Math.round(amount * rate);
}

/**
 * Refresca las tasas desde la API pública exchangerate.host.
 * Silenciosa: no propaga errores.
 * @returns {Promise<boolean>} true si se actualizó, false si falló/skip.
 */
async function refreshRates() {
  const HALF_DAY = 12 * 60 * 60 * 1000;
  if (Date.now() - lastRefreshAt < HALF_DAY) return false;

  try {
    // lightweight: solo fetch nativo (Node 18+). Si no está disponible, skip.
    if (typeof fetch !== 'function') return false;
    const symbols = Object.keys(FALLBACK_RATES).filter(c => c !== 'EUR').join(',');
    const url = `https://api.exchangerate.host/latest?base=EUR&symbols=${symbols}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const json = await res.json();
    if (!json?.rates) return false;

    // json.rates[X] = cuántos X equivalen a 1 EUR. Nosotros guardamos al
    // revés: cuántos EUR es 1 X. → invertir.
    const updated = { EUR: 1.00 };
    for (const [code, perEur] of Object.entries(json.rates)) {
      if (typeof perEur === 'number' && perEur > 0) {
        updated[code] = 1 / perEur;
      }
    }
    currentRates = { ...FALLBACK_RATES, ...updated };
    lastRefreshAt = Date.now();
    logger.info('FX rates actualizadas', {
      USD: currentRates.USD?.toFixed(4),
      GBP: currentRates.GBP?.toFixed(4),
    });
    return true;
  } catch (err) {
    logger.debug('FX refresh falló (usando fallback)', {
      err: /** @type {Error} */ (err).message,
    });
    return false;
  }
}

/** Devuelve la tasa vigente (testing/debug). @param {string} code */
function getRate(code) {
  return currentRates[String(code || 'EUR').toUpperCase()] ?? null;
}

// Kickoff async (no bloqueante). Si el bot corre en un entorno offline
// o la API está caída, seguimos con FALLBACK_RATES.
refreshRates().catch(() => {});

module.exports = { toEur, refreshRates, getRate, FALLBACK_RATES };
