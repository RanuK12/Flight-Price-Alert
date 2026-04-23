/**
 * /mis_alertas — dashboard paginado de rutas del usuario.
 *
 * Un único mensaje editable que muestra 1 alerta por página (card)
 * con botones inline para pausar/reanudar, eliminar y navegar.
 *
 * @module bot/handlers/misAlertas
 */

'use strict';

const kb = require('../keyboards');
const fmt = require('../formatters');
const routesRepo = require('../../database/repositories/routesRepo');
const paginator = require('../paginator');
const logger = require('../../utils/logger').child('bot:misAlertas');

const NAMESPACE = 'alerts';
const PER_PAGE = 1;

/** @param {import('node-telegram-bot-api')} bot */
function register(bot) {
  bot.onText(/^\/mis_alertas(?:@\w+)?$/, async (msg) => {
    await renderMisAlertas(bot, msg.chat.id, msg.from?.id || msg.chat.id);
  });
}

/**
 * Envía (o edita) la lista de rutas del usuario como dashboard paginado.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number} userId
 * @param {number} [messageId]
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

  await paginator.render(bot, chatId, {
    namespace: NAMESPACE,
    items: routes,
    perPage: PER_PAGE,
    formatItem: (r) => fmt.routeLine(r),
    itemKeyboard: (r) => kb.routeCard({ id: r._id.toString(), paused: r.paused ? 1 : 0 }),
    header: `📋 <b>Mis alertas</b> (${routes.length})`,
    messageId,
  });

  return true;
}

/**
 * Callback handler para acciones sobre rutas (`route:pause|resume|delete:<id>`)
 * y navegación del paginador.
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').CallbackQuery} cq
 * @returns {Promise<boolean>}
 */
async function handleRouteCallback(bot, cq) {
  const data = cq.data || '';
  const chatId = cq.message?.chat.id;
  const userId = cq.from.id;
  if (!chatId) return true;

  // Navegación del paginador
  const pagConsumed = await paginator.handleNavigation(bot, cq, {
    namespace: NAMESPACE,
    perPage: PER_PAGE,
    fetchItems: () => routesRepo.listByUser(userId),
    formatItem: (r) => fmt.routeLine(r),
    itemKeyboard: (r) => kb.routeCard({ id: r._id.toString(), paused: r.paused ? 1 : 0 }),
    header: `📋 <b>Mis alertas</b>`,
  });
  if (pagConsumed) return true;

  // Acciones sobre rutas
  if (!data.startsWith('route:')) return false;

  const [, action, idStr] = data.split(':');
  if (!idStr) return true;

  try {
    if (action === 'pause') {
      const ok = await routesRepo.setPaused(idStr, userId, true);
      await bot.answerCallbackQuery(cq.id, { text: ok ? '⏸️ Pausada' : 'No encontrada' });
    } else if (action === 'resume') {
      const ok = await routesRepo.setPaused(idStr, userId, false);
      await bot.answerCallbackQuery(cq.id, { text: ok ? '▶️ Reanudada' : 'No encontrada' });
    } else if (action === 'delete') {
      const ok = await routesRepo.deleteRoute(idStr, userId);
      await bot.answerCallbackQuery(cq.id, { text: ok ? '🗑️ Eliminada' : 'No encontrada' });
    } else {
      return true;
    }

    // Re-renderizar dashboard
    await renderMisAlertas(bot, chatId, userId, cq.message.message_id);
  } catch (err) {
    logger.error('Route callback failed', /** @type {Error} */ (err));
    await bot.answerCallbackQuery(cq.id, { text: '❌ Error' });
  }
  return true;
}

module.exports = { register, renderMisAlertas, handleRouteCallback };
