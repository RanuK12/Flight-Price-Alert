/**
 * Helpers comunes para los wizards conversacionales.
 *
 * @module bot/handlers/wizardUtils
 */

'use strict';

/** Validación básica de código IATA (3 letras mayúsculas). */
const IATA_REGEX = /^[A-Z]{3}$/;

/** Orígenes/destinos frecuentes para quick-picks. */
const COMMON_AR = ['EZE', 'COR', 'MDQ', 'AEP', 'ROS'];
const COMMON_EU = ['MAD', 'BCN', 'FCO', 'MXP', 'CDG', 'LHR'];
const COMMON_US = ['MIA', 'JFK', 'ORD', 'LAX', 'MCO'];

/** @param {string} s */
function isValidIata(s) {
  return typeof s === 'string' && IATA_REGEX.test(s.toUpperCase());
}

/**
 * Parsea una fecha en formato flexible: "YYYY-MM-DD", "DD/MM/YYYY", "DD-MM".
 * Retorna la fecha normalizada o null.
 * @param {string} input
 * @param {Date} [reference]
 * @returns {string|null}
 */
function parseDate(input, reference) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : s;
  }

  // DD/MM/YYYY o DD-MM-YYYY
  const m1 = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/.exec(s);
  if (m1) {
    const [, dd, mm, yRaw] = m1;
    const yyyy = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    const d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  }

  // DD/MM con year ≡ año de referencia (default: próximo en el futuro)
  const m2 = /^(\d{1,2})[/\-](\d{1,2})$/.exec(s);
  if (m2) {
    const [, dd, mm] = m2;
    const base = reference || new Date();
    const year = base.getFullYear();
    const candidate = new Date(`${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
    if (candidate < new Date()) candidate.setFullYear(year + 1);
    if (Number.isNaN(candidate.getTime())) return null;
    return candidate.toISOString().split('T')[0];
  }

  return null;
}

/** @param {string} date ISO date */
function isFutureDate(date) {
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d >= today;
}

module.exports = {
  IATA_REGEX,
  COMMON_AR,
  COMMON_EU,
  COMMON_US,
  isValidIata,
  parseDate,
  isFutureDate,
};
