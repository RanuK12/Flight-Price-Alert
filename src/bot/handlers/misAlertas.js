/**
 * /mis_alertas — lista las rutas guardadas del usuario con controles
 * pause / resume / delete.
 *
 * @module bot/handlers/misAlertas
 */

'use strict';

const kb = require('../keyboards');
const fmt = require('../formatters');
const routesRepo = require('../../database/repositories/routesRepo');
const logger = require('../../utils/logger').child('bot:misAlertas');

/** @param {import('node-telegram-bot-api')} bot */
function register(bot) {
  bot.onText(/^\/mis_alertas(?:@\w+)?$/, async (msg) => {
    await renderMisAlertas(bot, msg.chat.id, msg.from?.id || msg.chat.id);
  });
}

/**
 * Envía (o edita) la lista de rutas del usuario.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number} userId
 * @param {number} [messageId] si se provee, se intenta editar
 */
async function renderMisAlertas(bot, chatId, userId, messageId) {
  const routes = await routesRepo.listByUser(userId);

  if (routes.length === 0) {
    const text = '📋 <b>Mis alertas</b>\n\nTodavía no tenés rutas guardadas.\nUsá ➕ <b>Nueva alerta</b> para crear una.';
    if (messageId) {
      await bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId,
        parse_mode: 'HTML', reply_markup: kb.mainMenu(),
      }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: kb.mainMenu() });
    }
    return true;
  }

  const header = `📋 <b>Mis alertas</b> (${routes.length})\n`;
  if (messageId) {
    await bot.editMessageText(header, {
      chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
    }).catch(() => {});
  } else {
    await bot.sendMessage(chatId, header, { parse_mode: 'HTML' });
  }

  for (const r of routes) {
    await bot.sendMessage(chatId, fmt.routeLine(r), {
      parse_mode: 'HTML',
      reply_markup: kb.routeCard({ id: r.id, paused: r.paused }),
    });
  }

  await bot.sendMessage(chatId, '⬇️', { reply_markup: kb.mainMenu() });
  return true;
}

/**
 * Callback handler para `route:pause|resume|delete:<id>`.
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').CallbackQuery} cq
 * @returns {Promise<boolean>}
 */
async function handleRouteCallback(bot, cq) {
  const data = cq.data || '';
  if (!data.startsWith('route:')) return false;
  const chatId = cq.message?.chat.id;
  const userId = cq.from.id;
  if (!chatId) return true;

  const [, action, idStr] = data.split(':');
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    await bot.answerCallbackQuery(cq.id, { text: 'ID inválido' });
    return true;
  }

  try {
    if (action === 'pause') {
      const ok = await routesRepo.setPaused(id, userId, true);
      await bot.answerCallbackQuery(cq.id, { text: ok ? '⏸️ Pausada' : 'No encontrada' });
    } else if (action === 'resume') {
      const ok = await routesRepo.setPaused(id, userId, false);
      await bot.answerCallbackQuery(cq.id, { text: ok ? '▶️ Reanudada' : 'No encontrada' });
    } else if (action === 'delete') {
      const ok = await routesRepo.deleteRoute(id, userId);
      await bot.answerCallbackQuery(cq.id, { text: ok ? '🗑️ Eliminada' : 'No encontrada' });
      if (ok) {
        await bot.deleteMessage(chatId, cq.message.message_id).catch(() => {});
        return true;
      }
    } else {
      return true;
    }

    const route = await routesRepo.findByIdForUser(id, userId);
    if (route) {
      await bot.editMessageText(fmt.routeLine(route), {
        chat_id: chatId, message_id: cq.message.message_id,
        parse_mode: 'HTML', reply_markup: kb.routeCard({ id: route.id, paused: route.paused }),
      }).catch(() => {});
    }
  } catch (err) {
    logger.error('Route callback failed', /** @type {Error} */ (err));
    await bot.answerCallbackQuery(cq.id, { text: 'Error' });
  }
  return true;
}

module.exports = { register, renderMisAlertas, handleRouteCallback };
