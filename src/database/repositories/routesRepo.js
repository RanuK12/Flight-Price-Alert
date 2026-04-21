/**
 * Routes repository — CRUD sobre `saved_routes` (post-migración 002).
 * Cada ruta pertenece a un usuario de Telegram y puede pausarse.
 *
 * @module database/repositories/routesRepo
 */

'use strict';

const { run, get, all } = require('../db');

/**
 * @typedef {Object} SavedRoute
 * @property {number} id
 * @property {number|null} telegram_user_id
 * @property {number|null} telegram_chat_id
 * @property {string|null} name
 * @property {string} origin
 * @property {string} destination
 * @property {string|null} outbound_date
 * @property {string|null} return_date
 * @property {'oneway'|'roundtrip'} trip_type
 * @property {string} currency
 * @property {number|null} price_threshold
 * @property {0|1} paused
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} CreateRouteInput
 * @property {number} telegramUserId
 * @property {number} telegramChatId
 * @property {string} origin
 * @property {string} destination
 * @property {string|null} [outboundDate]
 * @property {string|null} [returnDate]
 * @property {'oneway'|'roundtrip'} [tripType]
 * @property {string} [currency]
 * @property {number} [priceThreshold]
 * @property {string} [name]
 */

/** @param {CreateRouteInput} input @returns {Promise<SavedRoute>} */
async function createRoute(input) {
  const tripType = input.tripType || (input.returnDate ? 'roundtrip' : 'oneway');
  const result = await run(
    `INSERT INTO saved_routes
       (telegram_user_id, telegram_chat_id, name, origin, destination,
        outbound_date, return_date, trip_type, currency, price_threshold,
        paused, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(telegram_user_id, origin, destination, outbound_date)
       DO UPDATE SET
         telegram_chat_id = excluded.telegram_chat_id,
         name            = COALESCE(excluded.name, saved_routes.name),
         return_date     = excluded.return_date,
         trip_type       = excluded.trip_type,
         currency        = excluded.currency,
         price_threshold = excluded.price_threshold,
         paused          = 0,
         updated_at      = CURRENT_TIMESTAMP`,
    [
      input.telegramUserId,
      input.telegramChatId,
      input.name || null,
      input.origin.toUpperCase(),
      input.destination.toUpperCase(),
      input.outboundDate || null,
      input.returnDate || null,
      tripType,
      input.currency || 'USD',
      input.priceThreshold ?? null,
    ],
  );

  // En upserts (ON CONFLICT DO UPDATE), SQLite retorna lastID=0.
  // Fallback: buscar por clave natural.
  let route;
  if (result.lastID > 0) {
    route = await get(`SELECT * FROM saved_routes WHERE id = ?`, [result.lastID]);
  } else {
    route = await get(
      `SELECT * FROM saved_routes
         WHERE telegram_user_id = ? AND origin = ? AND destination = ?
           AND outbound_date IS ?`,
      [input.telegramUserId, input.origin.toUpperCase(), input.destination.toUpperCase(), input.outboundDate || null],
    );
  }
  return /** @type {SavedRoute} */ (route);
}

/** @param {number} telegramUserId @returns {Promise<SavedRoute[]>} */
async function listByUser(telegramUserId) {
  return /** @type {SavedRoute[]} */ (
    await all(
      `SELECT * FROM saved_routes
        WHERE telegram_user_id = ?
        ORDER BY paused ASC, created_at DESC`,
      [telegramUserId],
    )
  );
}

/** @param {number} id @returns {Promise<SavedRoute|undefined>} */
async function findById(id) {
  return /** @type {SavedRoute|undefined} */ (
    await get(`SELECT * FROM saved_routes WHERE id = ?`, [id])
  );
}

/**
 * Ruta accesible por el usuario (ownership check).
 * @param {number} id @param {number} telegramUserId
 */
async function findByIdForUser(id, telegramUserId) {
  return /** @type {SavedRoute|undefined} */ (
    await get(
      `SELECT * FROM saved_routes WHERE id = ? AND telegram_user_id = ?`,
      [id, telegramUserId],
    )
  );
}

/**
 * Pausar / reanudar.
 * @param {number} id @param {number} telegramUserId @param {boolean} paused
 */
async function setPaused(id, telegramUserId, paused) {
  const result = await run(
    `UPDATE saved_routes
        SET paused = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND telegram_user_id = ?`,
    [paused ? 1 : 0, id, telegramUserId],
  );
  return result.changes > 0;
}

/**
 * Elimina la ruta (sólo si es del usuario).
 * @param {number} id @param {number} telegramUserId
 */
async function deleteRoute(id, telegramUserId) {
  const result = await run(
    `DELETE FROM saved_routes WHERE id = ? AND telegram_user_id = ?`,
    [id, telegramUserId],
  );
  return result.changes > 0;
}

/**
 * Todas las rutas activas (para el monitoreo de fondo cron).
 * @returns {Promise<SavedRoute[]>}
 */
async function listAllActive() {
  return /** @type {SavedRoute[]} */ (
    await all(`SELECT * FROM saved_routes WHERE paused = 0`)
  );
}

module.exports = {
  createRoute,
  listByUser,
  findById,
  findByIdForUser,
  setPaused,
  deleteRoute,
  listAllActive,
};
