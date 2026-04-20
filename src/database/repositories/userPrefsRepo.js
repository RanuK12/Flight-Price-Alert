/**
 * Preferencias por usuario (search_mode, alert_min_level, currency, etc).
 *
 * @module database/repositories/userPrefsRepo
 */

'use strict';

const { run, get } = require('../db');

/**
 * @typedef {Object} UserPrefs
 * @property {number} telegram_user_id
 * @property {number|null} telegram_chat_id
 * @property {'hybrid'|'amadeus'|'scraper'} search_mode
 * @property {'steal'|'great'|'good'|'all'} alert_min_level
 * @property {string} currency
 * @property {string|null} default_origin
 */

/** @type {Omit<UserPrefs,'telegram_user_id'|'telegram_chat_id'>} */
const DEFAULTS = Object.freeze({
  search_mode: 'hybrid',
  alert_min_level: 'steal',
  currency: 'EUR',
  default_origin: null,
});

/**
 * Devuelve las prefs del usuario, creándolas con defaults si no existen.
 * @param {number} telegramUserId
 * @param {number} [telegramChatId]
 * @returns {Promise<UserPrefs>}
 */
async function getOrCreate(telegramUserId, telegramChatId) {
  let row = await get(
    `SELECT * FROM user_prefs WHERE telegram_user_id = ?`,
    [telegramUserId],
  );
  if (!row) {
    await run(
      `INSERT INTO user_prefs (telegram_user_id, telegram_chat_id)
       VALUES (?, ?)`,
      [telegramUserId, telegramChatId ?? null],
    );
    row = await get(
      `SELECT * FROM user_prefs WHERE telegram_user_id = ?`,
      [telegramUserId],
    );
  }
  return /** @type {UserPrefs} */ (row);
}

/**
 * Actualiza campos. Sólo los provistos se modifican.
 * @param {number} telegramUserId
 * @param {Partial<UserPrefs>} patch
 */
async function update(telegramUserId, patch) {
  const allowed = ['telegram_chat_id', 'search_mode', 'alert_min_level', 'currency', 'default_origin'];
  const entries = Object.entries(patch).filter(([k]) => allowed.includes(k));
  if (entries.length === 0) return;

  const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => v);
  await run(
    `UPDATE user_prefs
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE telegram_user_id = ?`,
    [...values, telegramUserId],
  );
}

module.exports = { DEFAULTS, getOrCreate, update };
