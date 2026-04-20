/**
 * Usage repository — tracking de cuota diaria/mensual por provider.
 * Se apoya en `provider_daily_usage` (ya existente).
 *
 * @module database/repositories/usageRepo
 */

'use strict';

const { run, get, all } = require('../db');

/** YYYY-MM-DD en timezone del proceso. */
function today() {
  return new Date().toISOString().split('T')[0];
}

/** @param {string} provider */
async function getToday(provider) {
  const row = await get(
    `SELECT used FROM provider_daily_usage WHERE provider = ? AND usage_date = ?`,
    [provider, today()],
  );
  return Number(row?.used ?? 0);
}

/**
 * @param {string} provider
 * @param {number} [by=1]
 */
async function increment(provider, by = 1) {
  await run(
    `INSERT INTO provider_daily_usage (provider, usage_date, used, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(provider, usage_date)
       DO UPDATE SET used = used + ?, updated_at = CURRENT_TIMESTAMP`,
    [provider, today(), by, by],
  );
}

/**
 * Uso acumulado del mes en curso (YYYY-MM).
 * @param {string} provider
 */
async function getMonthly(provider) {
  const month = today().slice(0, 7); // YYYY-MM
  const row = await get(
    `SELECT COALESCE(SUM(used), 0) as total FROM provider_daily_usage
      WHERE provider = ? AND usage_date LIKE ?`,
    [provider, `${month}-%`],
  );
  return Number(row?.total ?? 0);
}

/** Resumen mensual por provider (para /stats). */
async function monthlySummary() {
  const month = today().slice(0, 7);
  return all(
    `SELECT provider, COALESCE(SUM(used), 0) as total
       FROM provider_daily_usage
      WHERE usage_date LIKE ?
      GROUP BY provider
      ORDER BY total DESC`,
    [`${month}-%`],
  );
}

module.exports = { getToday, increment, getMonthly, monthlySummary };
