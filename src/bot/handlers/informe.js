/**
 * /informe — envía el informe diario PDF on-demand.
 * Delega al servicio legacy `server/services/dailyReport.js`.
 *
 * @module bot/handlers/informe
 */

'use strict';

const kb = require('../keyboards');
const logger = require('../../utils/logger').child('bot:informe');

/** @param {import('node-telegram-bot-api')} bot */
function register(bot) {
  bot.onText(/^\/informe(?:@\w+)?$/, async (msg) => {
    await sendInformeOnDemand(bot, msg.chat.id, msg.from?.id || msg.chat.id);
  });
}

/**
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number} _userId
 */
async function sendInformeOnDemand(bot, chatId, _userId) {
  await bot.sendMessage(chatId, '📄 Generando informe diario… esto puede tardar unos segundos.');
  try {
    // eslint-disable-next-line global-require
    const { runDaily } = require('../../services/dailyReport');
    await runDaily();
  } catch (err) {
    logger.error('Informe failed', /** @type {Error} */ (err));
    await bot.sendMessage(chatId,
      `❌ No pude generar el informe: <code>${/** @type {Error} */ (err).message}</code>`,
      { parse_mode: 'HTML', reply_markup: kb.mainMenu() });
  }
  return true;
}

module.exports = { register, sendInformeOnDemand };
