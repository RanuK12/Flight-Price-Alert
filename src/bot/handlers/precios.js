/**
 * /precios y /grilla — las dos secciones del informe diario, a demanda.
 *
 * Existían sólo dentro del informe de las 21:00, que además tarda porque
 * arma el PDF. Estas leen lo que el bot ya guardó en las rutas
 * (lastPriceEur, bestOutboundDate), así que contestan al instante y sin
 * tocar Google.
 *
 * @module bot/handlers/precios
 */

'use strict';

const kb = require('../keyboards');
const logger = require('../../utils/logger').child('bot:precios');

/** @param {import('node-telegram-bot-api')} bot */
function register(bot) {
  bot.onText(/^\/precios(?:@\w+)?$/, async (msg) => {
    await sendMejoresPrecios(bot, msg.chat.id, msg.from?.id || msg.chat.id);
  });
  bot.onText(/^\/grilla(?:@\w+)?$/, async (msg) => {
    await sendGrilla(bot, msg.chat.id, msg.from?.id || msg.chat.id);
  });
}

/**
 * Manda una sección del informe, o un aviso claro si todavía no hay datos.
 *
 * El "todavía no hay datos" importa: pasa entre un deploy y el primer
 * barrido, y sin explicarlo parece que el bot está roto.
 *
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number} userId
 * @param {'precios'|'grilla'} which
 * @returns {Promise<boolean>}
 */
async function sendSection(bot, chatId, userId, which) {
  // eslint-disable-next-line global-require
  const report = require('../../services/dailyReport');
  const build = which === 'precios' ? report.buildBestPricesSection : report.buildGridSection;

  try {
    const html = await build(userId);
    if (!html) {
      await bot.sendMessage(chatId,
        'ℹ️ Todavía no hay precios guardados. El bot los va anotando a medida ' +
        'que revisa tus rutas; probá de nuevo después de la próxima pasada.',
        { reply_markup: kb.mainMenu() });
      return true;
    }
    await bot.sendMessage(chatId, html, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: kb.mainMenu(),
    });
  } catch (err) {
    logger.error(`Sección ${which} falló`, /** @type {Error} */ (err));
    await bot.sendMessage(chatId,
      `❌ No pude armar esa vista: <code>${/** @type {Error} */ (err).message}</code>`,
      { parse_mode: 'HTML', reply_markup: kb.mainMenu() });
  }
  return true;
}

/**
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
function sendMejoresPrecios(bot, chatId, userId) {
  return sendSection(bot, chatId, userId, 'precios');
}

/**
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
function sendGrilla(bot, chatId, userId) {
  return sendSection(bot, chatId, userId, 'grilla');
}

module.exports = { register, sendMejoresPrecios, sendGrilla };
