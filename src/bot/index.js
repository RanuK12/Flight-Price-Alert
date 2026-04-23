/**
 * Bot bootstrap — crea la instancia `node-telegram-bot-api`,
 * registra todos los handlers y dispatcha `callback_query`.
 *
 * @module bot
 */

'use strict';

const TelegramBot = require('node-telegram-bot-api');
const { config } = require('../config');
const logger = require('../utils/logger').child('bot');

const startHandler = require('./handlers/start');
const buscarHandler = require('./handlers/buscar');
const misAlertasHandler = require('./handlers/misAlertas');
const ofertasHandler = require('./handlers/ofertas');
const nuevaAlertaHandler = require('./handlers/nuevaAlerta');
const informeHandler = require('./handlers/informe');
const inspirarHandler = require('./handlers/inspirar');

/** @type {TelegramBot|null} */
let botInstance = null;

/**
 * Arranca el bot (singleton). Idempotente.
 * @returns {TelegramBot}
 */
function startBot() {
  if (botInstance) return botInstance;

  const token = config.telegram.botToken;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN missing — no puedo arrancar el bot.');
  }

  const bot = new TelegramBot(token, {
    polling: config.telegram.polling,
  });
  botInstance = bot;

  // Comandos de texto
  startHandler.register(bot);
  buscarHandler.register(bot);
  misAlertasHandler.register(bot);
  ofertasHandler.register(bot);
  nuevaAlertaHandler.register(bot);
  informeHandler.register(bot);
  inspirarHandler.register(bot);

  // Callbacks: probamos handlers en orden; el primero que consuma gana.
  bot.on('callback_query', async (cq) => {
    try {
      const consumed =
        (await startHandler.handleMenuCallback(bot, cq)) ||
        (await startHandler.handleConfigCallback(bot, cq)) ||
        (await buscarHandler.handleWizardCallback(bot, cq)) ||
        (await nuevaAlertaHandler.handleCallback(bot, cq)) ||
        (await inspirarHandler.handleCallback(bot, cq)) ||
        (await misAlertasHandler.handleRouteCallback(bot, cq));
      if (!consumed) {
        await bot.answerCallbackQuery(cq.id, { text: '🤷 Acción desconocida' }).catch(() => {});
      }
    } catch (err) {
      logger.error('callback_query failed', /** @type {Error} */ (err));
      await bot.answerCallbackQuery(cq.id, { text: '❌ Error interno' }).catch(() => {});
    }
  });

  // Texto libre: solo si algún wizard lo está esperando.
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    try {
      const consumed =
        (await buscarHandler.handleText(bot, msg)) ||
        (await nuevaAlertaHandler.handleText(bot, msg)) ||
        (await inspirarHandler.handleText(bot, msg));
      if (!consumed) {
        // Ignorado silenciosamente — no hay wizard activo.
      }
    } catch (err) {
      logger.error('message handler failed', /** @type {Error} */ (err));
    }
  });

  // polling_error recovery:
  //  - 409 Conflict = otro proceso está haciendo getUpdates con el mismo token.
  //    En Render suele ocurrir durante redeploys. node-telegram-bot-api
  //    reintenta automáticamente cada ~30s. NO reiniciamos polling manualmente
  //    porque stopPolling/startPolling pueden duplicar workers y empeorar el
  //    conflicto.
  let last409Log = 0;
  bot.on('polling_error', (err) => {
    const msg = /** @type {Error & {code?:string}} */ (err).message || '';
    const is409 = msg.includes('409') || msg.includes('terminated by other getUpdates');
    if (!is409) {
      logger.error('polling_error', /** @type {Error} */ (err));
      return;
    }
    // Loguear solo cada 30s para no saturar.
    const now = Date.now();
    if (now - last409Log > 30_000) {
      last409Log = now;
      logger.warn('polling 409 — otro proceso tiene el token, esperando...');
    }
  });

  // Commands menu nativo de Telegram
  bot.setMyCommands([
    { command: 'start', description: '🏠 Menú principal' },
    { command: 'buscar', description: '🔎 Buscar vuelos' },
    { command: 'mis_alertas', description: '📋 Mis alertas' },
    { command: 'ofertas', description: '🔔 Últimas ofertas' },
    { command: 'nueva_alerta', description: '➕ Nueva alerta' },
    { command: 'inspirar', description: '💡 Inspirarme' },
    { command: 'informe', description: '📄 Informe diario' },
    { command: 'cancel', description: '🚫 Cancelar acción' },
  ]).catch((e) => logger.warn('setMyCommands falló', { err: e.message }));

  logger.info('Bot iniciado', { polling: config.telegram.polling });
  return bot;
}

/** @returns {TelegramBot|null} */
function getBot() {
  return botInstance;
}

module.exports = { startBot, getBot };
