/**
 * Wizard / conversation state persistido en SQLite.
 *
 * Cada chat puede tener 1 sesión activa con:
 *   - state:  nombre del paso actual (ej. 'buscar:awaiting_origin')
 *   - data:   objeto con lo que se fue recolectando
 *   - expires_at: TTL (default 20 min)
 *
 * Al persistir en DB, las sesiones sobreviven a redeploys de Render.
 *
 * @module bot/sessions
 */

'use strict';

const { run, get, all } = require('../database/db');

/** TTL default de una sesión activa (20 min). */
const DEFAULT_TTL_MS = 20 * 60 * 1000;

/**
 * @typedef {Object} Session
 * @property {number} chatId
 * @property {number|null} userId
 * @property {string} state
 * @property {Record<string, unknown>} data
 * @property {string} updatedAt
 * @property {string|null} expiresAt
 */

/**
 * Lee la sesión activa del chat. Si expiró, la limpia y devuelve null.
 * @param {number} chatId
 * @returns {Promise<Session|null>}
 */
async function getSession(chatId) {
  const row = /** @type {Record<string, any>|undefined} */ (
    await get(`SELECT * FROM bot_sessions WHERE chat_id = ?`, [chatId])
  );
  if (!row) return null;

  if (row.expires_at) {
    const expires = new Date(row.expires_at);
    if (expires <= new Date()) {
      await clearSession(chatId).catch(() => {});
      return null;
    }
  }

  let data = {};
  try { data = JSON.parse(row.data_json || '{}'); } catch { /* empty */ }

  return {
    chatId: row.chat_id,
    userId: row.user_id,
    state: row.state,
    data,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Crea o actualiza la sesión del chat.
 * @param {number} chatId
 * @param {{userId?: number|null, state: string, data?: Record<string, unknown>, ttlMs?: number}} input
 * @returns {Promise<Session>}
 */
async function setSession(chatId, input) {
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const dataJson = JSON.stringify(input.data || {});
  await run(
    `INSERT INTO bot_sessions (chat_id, user_id, state, data_json, updated_at, expires_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
        user_id    = excluded.user_id,
        state      = excluded.state,
        data_json  = excluded.data_json,
        updated_at = CURRENT_TIMESTAMP,
        expires_at = excluded.expires_at`,
    [chatId, input.userId ?? null, input.state, dataJson, expiresAt],
  );
  return /** @type {Session} */ ({
    chatId,
    userId: input.userId ?? null,
    state: input.state,
    data: input.data || {},
    updatedAt: new Date().toISOString(),
    expiresAt,
  });
}

/**
 * Merge parcial de `data` manteniendo el state actual.
 * @param {number} chatId
 * @param {Partial<Record<string, unknown>>} patch
 */
async function patchData(chatId, patch) {
  const current = await getSession(chatId);
  if (!current) return null;
  return setSession(chatId, {
    userId: current.userId,
    state: current.state,
    data: { ...current.data, ...patch },
  });
}

/**
 * Cambia de paso manteniendo data.
 * @param {number} chatId @param {string} nextState
 */
async function transition(chatId, nextState) {
  const current = await getSession(chatId);
  if (!current) return null;
  return setSession(chatId, {
    userId: current.userId,
    state: nextState,
    data: current.data,
  });
}

/** @param {number} chatId */
async function clearSession(chatId) {
  await run(`DELETE FROM bot_sessions WHERE chat_id = ?`, [chatId]);
}

/** Housekeeping — borrar sesiones vencidas. */
async function purgeExpired() {
  const result = await run(
    `DELETE FROM bot_sessions WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`,
  );
  return result.changes;
}

module.exports = {
  DEFAULT_TTL_MS,
  getSession,
  setSession,
  patchData,
  transition,
  clearSession,
  purgeExpired,
};

// silence unused
void all;
