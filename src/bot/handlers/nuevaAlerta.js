/**
 * /nueva_alerta — crea/edita alertas de vuelo guardadas en DB.
 *
 * @module bot/handlers/nuevaAlerta
 */

'use strict';

const kb = require('../keyboards');
const fmt = require('../formatters');
const routesRepo = require('../../database/repositories/routesRepo');
const logger = require('../../utils/logger').child('bot:nuevaAlerta');

/** @param {import('node-telegram-bot-api')} bot */
function register(bot) {
  bot.onText(/^\/nueva_alerta(?:@\w+)?$/, async (msg) => {
    await showCreateEditMenu(bot, msg.chat.id, msg.from?.id || msg.chat.id);
  });
}

/**
 * Muestra el menú de "Crear/Editar alerta" con botones para acciones.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number} userId
 */
async function showCreateEditMenu(bot, chatId, userId) {
  try {
    const routes = await routesRepo.listByUser(userId);
    const hasRoutes = routes.length > 0;

    let text = '➕ <b>Crear/Editar alerta de vuelo</b>\n\n';
    if (hasRoutes) {
      text += '📌 <b>Tus alertas actuales:</b>\n';
      for (const r of routes.slice(0, 5)) {
        const label = fmt.routeLine(r);
        text += `• ${label}\n`;
      }
      if (routes.length > 5) text += `... y ${routes.length - 5} más\n`;
      text += '\n';
    }
    text += 'Seleccioná una opción:\n';

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🔄 Crear nueva alerta', callback_data: 'alert:new' },
          { text: '✏️ Editar alerta existente', callback_data: 'alert:edit' },
        ],
        [{ text: '⬅️ Volver al menú', callback_data: 'menu:main' }],
      ],
    };

    if (hasRoutes) {
      keyboard.inline_keyboard.push([
        { text: '📋 Ver/gestionar todas', callback_data: 'menu:mis_alertas' },
      ]);
    }

    await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (err) {
    logger.error('showCreateEditMenu failed', /** @type {Error} */ (err));
    await bot.sendMessage(chatId, '❌ Error al cargar menú de alertas', { reply_markup: kb.mainMenu() });
  }
}

/**
 * Callback handler para el menú de crear/editar alertas.
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').CallbackQuery} cq
 * @returns {Promise<boolean>}
 */
async function handleCallback(bot, cq) {
  const data = cq.data || '';
  const chatId = cq.message?.chat.id;
  const userId = cq.from.id;
  if (!chatId) return true;

  if (data === 'alert:new') {
    await bot.answerCallbackQuery(cq.id, { text: '🔄 Creando nueva alerta...' });
    await bot.editMessageText('✍️ Enviame el origen (ej: BUE, CBA, ROS):', {
      chat_id: chatId,
      message_id: cq.message.message_id,
      parse_mode: 'HTML',
      reply_markup: kb.cancelOnly(),
    });
    return true;
  }

  if (data === 'alert:edit') {
    await bot.answerCallbackQuery(cq.id);
    await showEditSelector(bot, chatId, userId, cq.message.message_id);
    return true;
  }

  return false;
}

/**
 * Muestra selector de alertas existentes para editar.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number} userId
 * @param {number} messageId
 */
async function showEditSelector(bot, chatId, userId, messageId) {
  try {
    const routes = await routesRepo.listByUser(userId);
    if (routes.length === 0) {
      await bot.editMessageText('📋 <b>Tus alertas</b>\n\nTodavía no tenés rutas guardadas.\nUsá ➕ <b>Nueva alerta</b> para crear una.', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: kb.mainMenu(),
      });
      return;
    }

    const keyboard = {
      inline_keyboard: routes.map((r) => [
        { text: fmt.routeLine(r), callback_data: `alert:edit:${r._id.toString()}` },
      ]),
    };
    keyboard.inline_keyboard.push([{ text: '⬅️ Volver', callback_data: 'alert:back' }]);

    await bot.editMessageText('✏️ Seleccioná la alerta a editar:', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (err) {
    logger.error('showEditSelector failed', /** @type {Error} */ (err));
    await bot.answerCallbackQuery(cq.id, { text: '❌ Error al cargar alertas' });
  }
}

/**
 * Maneja texto libre para origen/destino/precio al crear alerta.
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').Message} msg
 * @returns {Promise<boolean>}
 */
async function handleText(bot, msg) {
  // TODO: implementar lógica de wizard para crear/editar alertas
  // Por ahora solo consumimos el mensaje para no interferir
  return false;
}

module.exports = { register, showCreateEditMenu, handleCallback, showEditSelector, handleText };