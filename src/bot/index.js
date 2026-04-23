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
  //    En Render suele ocurrir durante redeploys con overlap de contenedores
  //    que puede durar 30-60s. Paramos polling, esperamos backoff largo y
  //    reintentamos. Después de muchos intentos fallidos damos up para no
  //    saturar logs ni CPU.
  let pollingBackoffMs = 0;
  let recovering = false;
  let consecutive409s = 0;
  const MAX_409_RETRIES = 10;

  bot.on('polling_error', async (err) => {
    const msg = /** @type {Error & {code?:string}} */ (err).message || '';
    const is409 = msg.includes('409') || msg.includes('terminated by other getUpdates');
    if (!is409) {
      logger.error('polling_error', /** @type {Error} */ (err));
      return;
    }
    if (recovering) return;

    consecutive409s += 1;
    if (consecutive409s > MAX_409_RETRIES) {
      // Damos up: la instancia vieja probablemente sigue viva.
      // Logueamos solo cada 60s para no saturar.
      if (consecutive409s % 12 === 0) {
        logger.warn('polling 409 persistente — otro proceso tiene el token. Esperando...', {
          consecutive409s,
        });
      }
      return;
    }

    recovering = true;
    pollingBackoffMs = Math.min(120_000, Math.max(15_000, pollingBackoffMs * 2 || 15_000));
    logger.warn('polling 409 — reiniciando polling', { backoffMs: pollingBackoffMs, consecutive409s });
    try {
      await bot.stopPolling({ cancel: true }).catch(() => {});
      await new Promise((r) => setTimeout(r, pollingBackoffMs));
      await bot.startPolling({ restart: true, polling: { params: { allowed_updates: [] } } });
      // Cooldown: esperar 20s antes de considerar estable (evita colisión
      // inmediata si la instancia vieja aún no murió).
      await new Promise((r) => setTimeout(r, 20_000));
      // Resetear contador si sobrevivimos el cooldown sin nuevos 409.
      consecutive409s = 0;
      pollingBackoffMs = Math.max(15_000, Math.floor(pollingBackoffMs / 2));
      logger.info('polling reanudado OK');
    } catch (e) {
      logger.error('polling restart falló', /** @type {Error} */ (e));
    } finally {
      recovering = false;
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
