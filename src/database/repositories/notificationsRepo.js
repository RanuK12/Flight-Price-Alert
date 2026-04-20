/**
 * Repo de `offer_notifications` — historial de alertas disparadas.
 *
 * @module database/repositories/notificationsRepo
 */

'use strict';

const { run, get, all } = require('../db');

/**
 * @typedef {Object} NotifRow
 * @property {number} id
 * @property {number} telegram_user_id
 * @property {number} telegram_chat_id
 * @property {number|null} route_id
 * @property {string} origin
 * @property {string} destination
 * @property {string} trip_type
 * @property {string|null} departure_date
 * @property {string|null} return_date
 * @property {string|null} airline
 * @property {number|null} stops
 * @property {number} price
 * @property {string} currency
 * @property {string} deal_level
 * @property {number|null} threshold
 * @property {string|null} provider
 * @property {string|null} booking_url
 * @property {string} dedup_key
 * @property {string} sent_at
 */

/**
 * Clave de deduplicación. Misma ruta + fecha + precio redondeado a 5
 * se considera la misma oferta.
 * @param {{telegramUserId:number, origin:string, destination:string, departureDate?:string|null, returnDate?:string|null, price:number}} f
 */
function buildDedupKey(f) {
  const bucket = Math.round(f.price / 5) * 5;
  return [
    f.telegramUserId,
    f.origin, f.destination,
    f.departureDate || 'none',
    f.returnDate || 'ow',
    bucket,
  ].join('|');
}

/**
 * ¿Ya se notificó esta oferta hace menos de `withinMs`?
 * @param {string} dedupKey @param {number} [withinMs=12*60*60*1000]
 * @returns {Promise<boolean>}
 */
async function wasNotifiedRecently(dedupKey, withinMs = 12 * 60 * 60 * 1000) {
  const row = await get(
    `SELECT sent_at FROM offer_notifications
       WHERE dedup_key = ?
       ORDER BY sent_at DESC LIMIT 1`,
    [dedupKey],
  );
  if (!row) return false;
  const t = new Date(row.sent_at).getTime();
  return Date.now() - t < withinMs;
}

/**
 * Inserta una notificación.
 * @param {Omit<NotifRow,'id'|'sent_at'>} input
 * @returns {Promise<number>} id insertado
 */
async function insertNotification(input) {
  const res = await run(
    `INSERT INTO offer_notifications
       (telegram_user_id, telegram_chat_id, route_id, origin, destination,
        trip_type, departure_date, return_date, airline, stops,
        price, currency, deal_level, threshold, provider, booking_url, dedup_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.telegram_user_id, input.telegram_chat_id, input.route_id ?? null,
      input.origin, input.destination, input.trip_type,
      input.departure_date ?? null, input.return_date ?? null,
      input.airline ?? null, input.stops ?? null,
      input.price, input.currency,
      input.deal_level, input.threshold ?? null,
      input.provider ?? null, input.booking_url ?? null,
      input.dedup_key,
    ],
  );
  return res.lastID;
}

/**
 * Últimas N notificaciones del usuario.
 * @param {number} telegramUserId @param {number} [limit=10]
 * @returns {Promise<NotifRow[]>}
 */
async function listLatestForUser(telegramUserId, limit = 10) {
  return /** @type {NotifRow[]} */ (
    await all(
      `SELECT * FROM offer_notifications
         WHERE telegram_user_id = ?
         ORDER BY sent_at DESC
         LIMIT ?`,
      [telegramUserId, limit],
    )
  );
}

/**
 * Stats de ofertas del usuario en las últimas 24h.
 * @param {number} telegramUserId
 */
async function statsLast24h(telegramUserId) {
  const row = await get(
    `SELECT
       COUNT(*) AS count,
       MIN(price) AS min_price,
       SUM(CASE WHEN deal_level = 'steal' THEN 1 ELSE 0 END) AS steals,
       SUM(CASE WHEN deal_level = 'great' THEN 1 ELSE 0 END) AS greats
     FROM offer_notifications
     WHERE telegram_user_id = ?
       AND sent_at >= datetime('now', '-24 hours')`,
    [telegramUserId],
  );
  return row || { count: 0, min_price: null, steals: 0, greats: 0 };
}

module.exports = {
  buildDedupKey,
  wasNotifiedRecently,
  insertNotification,
  listLatestForUser,
  statsLast24h,
};
