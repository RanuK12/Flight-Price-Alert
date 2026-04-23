/**
 * Paginator genérico para mensajes editables de Telegram.
 * Mantiene el estado de página en la sesión del usuario.
 *
 * @module bot/paginator
 */

'use strict';

const sessions = require('./sessions');
const logger = require('../utils/logger').child('bot:paginator');

/**
 * Renderiza (o re-renderiza) una lista paginada como mensaje editable.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {Object} opts
 * @param {string} opts.namespace          ej. 'alerts'
 * @param {Array<any>} opts.items          items a paginar
 * @param {number} [opts.page=0]           página inicial
 * @param {number} [opts.perPage=1]        items por página
 * @param {(item:any, idx:number) => string} opts.formatItem  fn que devuelve texto HTML del item
 * @param {(item:any) => Object} [opts.itemKeyboard] fn que devuelve inline_keyboard extra para el item
 * @param {string} [opts.emptyText]        texto cuando no hay items
 * @param {string} [opts.header]           texto de header (sin paginación)
 * @param {number} [opts.messageId]        si se provee, edita; si no, envía
 * @returns {Promise<{messageId:number, totalPages:number}>}
 */
async function render(bot, chatId, opts) {
  const {
    namespace,
    items,
    page = 0,
    perPage = 1,
    formatItem,
    itemKeyboard,
    emptyText = 'Sin elementos.',
    header = '',
    messageId,
  } = opts;

  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const currentPage = Math.min(Math.max(0, page), totalPages - 1);

  // Guardar estado de paginación en sesión
  const session = await sessions.getSession(chatId);
  if (session) {
    await sessions.patchData(chatId, {
      [`_paginator_${namespace}`]: { page: currentPage, perPage, totalPages },
    });
  }

  let text;
  let keyboard = { inline_keyboard: [] };

  if (items.length === 0) {
    text = emptyText;
    keyboard.inline_keyboard.push([{ text: '🏠 Menú principal', callback_data: 'menu:main' }]);
  } else {
    const start = currentPage * perPage;
    const pageItems = items.slice(start, start + perPage);
    const body = pageItems.map((it, i) => formatItem(it, start + i)).join('\n\n');
    const footer = `\n\n— Página ${currentPage + 1}/${totalPages} —`;
    text = (header ? header + '\n\n' : '') + body + footer;

    // Botones del item
    if (itemKeyboard && pageItems.length === 1) {
      const itemKb = itemKeyboard(pageItems[0]);
      if (itemKb?.inline_keyboard) {
        keyboard.inline_keyboard.push(...itemKb.inline_keyboard);
      }
    }

    // Navegación
    const navRow = [];
    if (currentPage > 0) {
      navRow.push({ text: '◀️ Anterior', callback_data: `pag:${namespace}:prev` });
    }
    if (currentPage < totalPages - 1) {
      navRow.push({ text: '▶️ Siguiente', callback_data: `pag:${namespace}:next` });
    }
    if (navRow.length) {
      keyboard.inline_keyboard.push(navRow);
    }

    keyboard.inline_keyboard.push([{ text: '🏠 Menú principal', callback_data: 'menu:main' }]);
  }

  let resultMessageId = messageId;
  if (messageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      // Si el mensaje no cambia, Telegram tira 400. Enviamos nuevo.
      const sent = await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
      resultMessageId = sent.message_id;
    }
  } else {
    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
    resultMessageId = sent.message_id;
  }

  return { messageId: resultMessageId, totalPages };
}

/**
 * Handler de callbacks de navegación del paginador.
 * Devuelve true si consumió el callback.
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').CallbackQuery} cq
 * @param {Object} opts
 * @param {string} opts.namespace
 * @param {() => Promise<Array<any>>} opts.fetchItems  fn async que trae los items frescos
 * @param {(item:any, idx:number) => string} opts.formatItem
 * @param {(item:any) => Object} [opts.itemKeyboard]
 * @param {string} [opts.header]
 * @returns {Promise<boolean>}
 */
async function handleNavigation(bot, cq, opts) {
  const data = cq.data || '';
  if (!data.startsWith('pag:')) return false;

  const [, namespace, action] = data.split(':');
  const chatId = cq.message?.chat.id;
  if (!chatId) return true;

  if (opts.namespace !== namespace) return false;

  const session = await sessions.getSession(chatId);
  const pagState = session?.data?.[`_paginator_${namespace}`];
  let currentPage = pagState?.page ?? 0;

  if (action === 'prev') currentPage = Math.max(0, currentPage - 1);
  if (action === 'next') currentPage = currentPage + 1;

  await bot.answerCallbackQuery(cq.id);

  const items = await opts.fetchItems();
  await render(bot, chatId, {
    namespace,
    items,
    page: currentPage,
    perPage: opts.perPage || 1,
    formatItem: opts.formatItem,
    itemKeyboard: opts.itemKeyboard,
    header: opts.header,
    messageId: cq.message.message_id,
  });

  return true;
}

module.exports = { render, handleNavigation };
