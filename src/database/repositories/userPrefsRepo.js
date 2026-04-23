/**
 * Preferencias por usuario — adaptado a MongoDB (User model).
 *
 * @module database/repositories/userPrefsRepo
 */

'use strict';

const User = require('../models/User');

/** @type {Object} */
const DEFAULTS = Object.freeze({
  searchMode: 'hybrid',
  alertMinLevel: 'steal',
  currency: 'EUR',
});

/**
 * Devuelve las prefs del usuario, creándolas con defaults si no existen.
 * @param {number} telegramUserId
 * @param {number} [telegramChatId]
 * @returns {Promise<Object>}
 */
async function getOrCreate(telegramUserId, telegramChatId) {
  let user = await User.findOne({ telegramUserId }).lean();
  if (!user) {
    user = await User.create({
      telegramUserId,
      telegramChatId: telegramChatId ?? null,
      ...DEFAULTS,
    });
    user = user.toObject();
  }
  // Normalizar nombres para compatibilidad con código existente
  return {
    telegram_user_id: user.telegramUserId,
    telegram_chat_id: user.telegramChatId,
    search_mode: user.searchMode,
    alert_min_level: user.alertMinLevel,
    currency: user.currency,
    default_origin: null,
  };
}

/**
 * Actualiza campos. Sólo los provistos se modifican.
 * @param {number} telegramUserId
 * @param {Object} patch
 */
async function update(telegramUserId, patch) {
  const allowed = ['search_mode', 'alert_min_level', 'currency', 'default_origin'];
  const mongoMap = {
    search_mode: 'searchMode',
    alert_min_level: 'alertMinLevel',
    currency: 'currency',
    default_origin: 'defaultOrigin',
  };
  const update = {};
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.includes(k) && mongoMap[k]) {
      update[mongoMap[k]] = v;
    }
  }
  if (Object.keys(update).length === 0) return;
  await User.updateOne({ telegramUserId }, update);
}

module.exports = { DEFAULTS, getOrCreate, update };
