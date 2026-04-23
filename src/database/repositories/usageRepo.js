/**
 * Usage repository — tracking de cuota diaria/mensual por provider (MongoDB).
 *
 * @module database/repositories/usageRepo
 */

'use strict';

const UsageLog = require('../models/UsageLog');

/** YYYY-MM-DD en timezone del proceso. */
function today() {
  return new Date().toISOString().split('T')[0];
}

/** @param {string} provider */
async function getToday(provider) {
  const row = await UsageLog.findOne({ provider, usageDate: today() }).lean();
  return Number(row?.used ?? 0);
}

/**
 * @param {string} provider
 * @param {number} [by=1]
 */
async function increment(provider, by = 1) {
  await UsageLog.findOneAndUpdate(
    { provider, usageDate: today() },
    { $inc: { used: by } },
    { upsert: true }
  );
}

/**
 * Uso acumulado del mes en curso (YYYY-MM).
 * @param {string} provider
 */
async function getMonthly(provider) {
  const month = today().slice(0, 7); // YYYY-MM
  const rows = await UsageLog.aggregate([
    { $match: { provider, usageDate: { $regex: `^${month}-` } } },
    { $group: { _id: null, total: { $sum: '$used' } } },
  ]);
  return rows.length ? Number(rows[0].total) : 0;
}

/** Resumen mensual por provider (para /stats). */
async function monthlySummary() {
  const month = today().slice(0, 7);
  return UsageLog.aggregate([
    { $match: { usageDate: { $regex: `^${month}-` } } },
    { $group: { _id: '$provider', total: { $sum: '$used' } } },
    { $sort: { total: -1 } },
    { $project: { provider: '$_id', total: 1, _id: 0 } },
  ]);
}

module.exports = { getToday, increment, getMonthly, monthlySummary };
