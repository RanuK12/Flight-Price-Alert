/**
 * Wizard / conversation state persistido en MongoDB (BotSession model).
 *
 * Cada chat puede tener 1 sesión activa con:
 *   - state:  nombre del paso actual
 *   - data:   objeto con lo que se fue recolectando
 *   - expires_at: TTL (default 20 min)
 *
 * Al persistir en MongoDB, las sesiones sobreviven a redeploys de Render
 * y se limpian automáticamente vía TTL index.
 *
 * @module bot/sessions
 */

'use strict';

const BotSession = require('../database/models/BotSession');

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
  const doc = await BotSession.findOne({ chatId }).lean();
  if (!doc) return null;

  if (doc.expiresAt && new Date(doc.expiresAt) <= new Date()) {
    await clearSession(chatId).catch(() => {});
    return null;
  }

  return {
    chatId: doc.chatId,
    userId: doc.userId,
    state: doc.state,
    data: doc.data || {},
    updatedAt: doc.updatedAt?.toISOString() || new Date().toISOString(),
    expiresAt: doc.expiresAt?.toISOString() || null,
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
  const expiresAt = new Date(Date.now() + ttlMs);
  const data = input.data || {};

  await BotSession.findOneAndUpdate(
    { chatId },
    {
      userId: input.userId ?? null,
      state: input.state,
      data,
      expiresAt,
    },
    { upsert: true }
  );

  return {
    chatId,
    userId: input.userId ?? null,
    state: input.state,
    data,
    updatedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
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
  await BotSession.deleteOne({ chatId });
}

/** Housekeeping — borrar sesiones vencidas (redundante con TTL, pero útil). */
async function purgeExpired() {
  const result = await BotSession.deleteMany({ expiresAt: { $lte: new Date() } });
  return result.deletedCount || 0;
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
