/**
 * Handlers de menú principal: /start, /help, /cancel
 * y el callback router del menú.
 *
 * @module bot/handlers/start
 */

'use strict';

const kb = require('../keyboards');
const fmt = require('../formatters');
const sessions = require('../sessions');
const userPrefsRepo = require('../../database/repositories/userPrefsRepo');

/** @param {import('node-telegram-bot-api')} bot */
function register(bot) {
  bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || chatId;
    await userPrefsRepo.getOrCreate(userId, chatId);
    await sessions.clearSession(chatId);
    await bot.sendMessage(chatId, fmt.welcome(msg.from?.first_name), {
      parse_mode: 'HTML',
      reply_markup: kb.mainMenu(),
    });
  });

  bot.onText(/^\/help(?:@\w+)?$/, async (msg) => {
    await bot.sendMessage(msg.chat.id, fmt.welcome(msg.from?.first_name), {
      parse_mode: 'HTML',
      reply_markup: kb.mainMenu(),
    });
  });

  bot.onText(/^\/cancel(?:@\w+)?$/, async (msg) => {
    await sessions.clearSession(msg.chat.id);
    await bot.sendMessage(msg.chat.id, '🚫 Acción cancelada.', {
      reply_markup: kb.mainMenu(),
    });
  });
}

/**
 * Callback handler para acciones del menú principal (`menu:*`).
 * Devuelve true si consumió el callback.
 *
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').CallbackQuery} cq
 * @returns {Promise<boolean>}
 */
async function handleMenuCallback(bot, cq) {
  const data = cq.data || '';
  if (!data.startsWith('menu:')) return false;
  const action = data.slice('menu:'.length);
  const chatId = cq.message?.chat.id;
  const userId = cq.from.id;
  if (!chatId) return true;

  const prefs = await userPrefsRepo.getOrCreate(userId, chatId);

  if (action === 'main') {
    await bot.editMessageText(fmt.welcome(cq.from.first_name), {
      chat_id: chatId, message_id: cq.message.message_id,
      parse_mode: 'HTML', reply_markup: kb.mainMenu(),
    }).catch(() => {});
    return true;
  }

  if (action === 'config') {
    // eslint-disable-next-line global-require
    const hybrid = require('../../services/hybridSearch');
    const budget = await hybrid.checkAmadeusBudget();
    const dayPct = budget.dailyBudget > 0
      ? Math.round((budget.usedToday / budget.dailyBudget) * 100) : 0;
    const monthPct = budget.budget > 0
      ? Math.round((budget.used / budget.budget) * 100) : 0;
    await bot.editMessageText(
      '⚙️ <b>Configuración</b>\n\n' +
      `🔀 Modo: <b>${fmt.esc(prefs.search_mode)}</b>\n` +
      `🚨 Alertas: <b>${fmt.esc(prefs.alert_min_level)}</b>\n` +
      `💱 Moneda: <b>${fmt.esc(prefs.currency)}</b>\n\n` +
      `🎫 <b>Cuota Amadeus</b>\n` +
      `   · Hoy: ${budget.usedToday}/${budget.dailyBudget} (${dayPct}%)\n` +
      `   · Mes: ${budget.used}/${budget.budget} (${monthPct}%)`,
      {
        chat_id: chatId, message_id: cq.message.message_id,
        parse_mode: 'HTML', reply_markup: kb.configMenu(),
      },
    ).catch(() => {});
    return true;
  }

  if (action === 'config:mode') {
    await bot.editMessageText(fmt.searchModeInfo(prefs.search_mode), {
      chat_id: chatId, message_id: cq.message.message_id,
      parse_mode: 'HTML', reply_markup: kb.searchModeMenu(prefs.search_mode),
    }).catch(() => {});
    return true;
  }

  if (action === 'config:level') {
    await bot.editMessageText(
      '🚨 <b>Nivel mínimo de alerta</b>\n\n' +
      'Qué tan "oferta" tiene que ser para que te avise.',
      {
        chat_id: chatId, message_id: cq.message.message_id,
        parse_mode: 'HTML', reply_markup: kb.alertLevelMenu(prefs.alert_min_level),
      },
    ).catch(() => {});
    return true;
  }

  if (action === 'config:currency') {
    await bot.editMessageText('💱 <b>Moneda preferida</b>', {
      chat_id: chatId, message_id: cq.message.message_id,
      parse_mode: 'HTML', reply_markup: kb.currencyMenu(prefs.currency),
    }).catch(() => {});
    return true;
  }

  // Delegaciones a otros handlers (import lazy para evitar ciclos)
  if (action === 'buscar') {
    const { startBuscarFlow } = require('./buscar');
    return startBuscarFlow(bot, chatId, userId);
  }
  if (action === 'mis_alertas') {
    const { renderMisAlertas } = require('./misAlertas');
    return renderMisAlertas(bot, chatId, userId, cq.message.message_id);
  }
  if (action === 'ofertas') {
    const { renderOfertas } = require('./ofertas');
    return renderOfertas(bot, chatId, userId, cq.message.message_id);
  }
  if (action === 'nueva_alerta') {
    const { startNuevaAlertaFlow } = require('./nuevaAlerta');
    return startNuevaAlertaFlow(bot, chatId, userId);
  }
  if (action === 'informe') {
    const { sendInformeOnDemand } = require('./informe');
    return sendInformeOnDemand(bot, chatId, userId);
  }
  if (action === 'inspirar') {
    const { startInspirarFlow } = require('./inspirar');
    return startInspirarFlow(bot, chatId, userId);
  }

  return true;
}

/**
 * Callback handler para `config:*` (selección de modo, moneda, etc).
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').CallbackQuery} cq
 * @returns {Promise<boolean>}
 */
async function handleConfigCallback(bot, cq) {
  const data = cq.data || '';
  if (!data.startsWith('config:')) return false;
  const [, kind, value] = data.split(':');
  const chatId = cq.message?.chat.id;
  const userId = cq.from.id;
  if (!chatId) return true;

  if (kind === 'mode' && ['hybrid', 'amadeus', 'scraper'].includes(value)) {
    await userPrefsRepo.update(userId, { search_mode: /** @type {any} */ (value) });
    await bot.answerCallbackQuery(cq.id, { text: `Modo: ${value}` });
    await bot.editMessageText(fmt.searchModeInfo(value), {
      chat_id: chatId, message_id: cq.message.message_id,
      parse_mode: 'HTML', reply_markup: kb.searchModeMenu(value),
    }).catch(() => {});
    return true;
  }

  if (kind === 'level' && ['steal', 'great', 'good', 'all'].includes(value)) {
    await userPrefsRepo.update(userId, { alert_min_level: /** @type {any} */ (value) });
    await bot.answerCallbackQuery(cq.id, { text: `Nivel: ${value}` });
    await bot.editMessageText('🚨 <b>Nivel mínimo de alerta actualizado</b>', {
      chat_id: chatId, message_id: cq.message.message_id,
      parse_mode: 'HTML', reply_markup: kb.alertLevelMenu(value),
    }).catch(() => {});
    return true;
  }

  if (kind === 'currency' && ['EUR', 'USD'].includes(value)) {
    await userPrefsRepo.update(userId, { currency: value });
    await bot.answerCallbackQuery(cq.id, { text: `Moneda: ${value}` });
    await bot.editMessageText(`💱 Moneda: <b>${value}</b>`, {
      chat_id: chatId, message_id: cq.message.message_id,
      parse_mode: 'HTML', reply_markup: kb.currencyMenu(value),
    }).catch(() => {});
    return true;
  }

  return false;
}

module.exports = { register, handleMenuCallback, handleConfigCallback };
