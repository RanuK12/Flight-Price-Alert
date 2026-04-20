/**
 * Daily report (v4) — resumen diario rico en Telegram + PDF legacy.
 *
 * Arma un mensaje HTML con:
 *   · Top 5 ofertas de las últimas 24h (flightCard estilo bot).
 *   · Stats: ofertones, muy buenas, mejor precio, total de rutas activas.
 *   · Estado del budget mensual de Amadeus.
 *   · CTA botones → Últimas ofertas / Mis alertas / Menú.
 *
 * Luego dispara el PDF legacy (`server/services/dailyReport`) como adjunto.
 *
 * @module services/dailyReport
 */

'use strict';

const { config } = require('../config');
const fmt = require('../bot/formatters');
const { buildLinksForFlight } = require('../bot/deepLinks');
const { getBot } = require('../bot');
const notificationsRepo = require('../database/repositories/notificationsRepo');
const routesRepo = require('../database/repositories/routesRepo');
const hybrid = require('./hybridSearch');
const logger = require('../utils/logger').child('dailyReport');

/**
 * Genera el resumen + dispara el PDF legacy (best-effort).
 */
async function runDaily() {
  const bot = getBot();
  if (!bot) {
    logger.warn('Bot no inicializado, skip daily report');
    return;
  }

  const chatIds = config.telegram.chatIds;
  if (!chatIds.length) {
    logger.warn('Sin TELEGRAM_CHAT_ID, skip daily report');
    return;
  }

  for (const chatId of chatIds) {
    const userId = Number(chatId);
    try {
      await sendSummaryForUser(bot, userId, Number(chatId));
    } catch (err) {
      logger.error('Fallo resumen', /** @type {Error} */ (err));
    }
  }

  // PDF legacy como adjunto (best-effort, no bloquea).
  try {
    // eslint-disable-next-line global-require
    const { generateAndSendDailyReport } = require('../../server/services/dailyReport');
    await generateAndSendDailyReport();
  } catch (err) {
    logger.warn('PDF legacy falló (continuando)', { err: /** @type {Error} */ (err).message });
  }
}

/**
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} userId
 * @param {number} chatId
 */
async function sendSummaryForUser(bot, userId, chatId) {
  const [routes, stats, latest, budget] = await Promise.all([
    routesRepo.listByUser(userId),
    notificationsRepo.statsLast24h(userId),
    notificationsRepo.listLatestForUser(userId, 5),
    hybrid.checkAmadeusBudget(),
  ]);

  const activeRoutes = routes.filter((r) => !r.paused).length;
  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const monthPct = budget.budget > 0 ? Math.round((budget.used / budget.budget) * 100) : 0;
  const dayPct = budget.dailyBudget > 0
    ? Math.round((budget.usedToday / budget.dailyBudget) * 100) : 0;

  const header =
    `📄 <b>Informe diario — ${today}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🗺️  Rutas activas: <b>${activeRoutes}</b>${routes.length !== activeRoutes ? ` (${routes.length - activeRoutes} pausadas)` : ''}\n` +
    `🔔 Ofertas 24h: <b>${stats.count}</b>` +
    ` · 🚨 ${stats.steals || 0} · 🔥 ${stats.greats || 0}\n` +
    (stats.min_price
      ? `💰 Mejor del día: <b>${fmt.price(stats.min_price, latest[0]?.currency || 'EUR')}</b>\n`
      : '') +
    `🎫 Cuota Amadeus:\n` +
    `   · Hoy:  <b>${budget.usedToday}/${budget.dailyBudget}</b> ${progressBar(dayPct)} ${dayPct}%\n` +
    `   · Mes:  <b>${budget.used}/${budget.budget}</b> ${progressBar(monthPct)} ${monthPct}%`;

  await bot.sendMessage(chatId, header, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  if (latest.length === 0) {
    await bot.sendMessage(chatId,
      'ℹ️ Hoy no hubo ofertas que cumplieran tu nivel mínimo de alerta.\n' +
      'Podés bajarlo desde <b>⚙️ Configuración → 🚨 Nivel de alertas</b>.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚙️ Configuración', callback_data: 'menu:config' }],
            [{ text: '🏠 Menú', callback_data: 'menu:main' }],
          ],
        },
      },
    );
    return;
  }

  await bot.sendMessage(chatId, `🏆 <b>Top ${latest.length} ofertas</b>`, { parse_mode: 'HTML' });

  for (const n of latest) {
    const fakeFlight = /** @type {import('../providers/base').Flight} */ ({
      source: n.provider || 'unknown',
      origin: n.origin, destination: n.destination,
      price: n.price, currency: n.currency,
      tripType: /** @type {any} */ (n.trip_type),
      departureDate: n.departure_date, returnDate: n.return_date,
      airline: n.airline || 'Unknown',
      carrierCodes: [], stops: n.stops ?? 0,
      bookingUrl: n.booking_url || undefined,
    });
    const badge = ({ steal: '🚨', great: '🔥', good: '✅' }[n.deal_level]) || '✈️';
    const card = fmt.flightCard(fakeFlight, { level: n.deal_level, badge });
    const links = buildLinksForFlight(fakeFlight);
    const rows = [];
    if (links.primary) rows.push([{ text: `🛒 ${links.primary.label}`, url: links.primary.url }]);
    for (const alt of links.alternatives.slice(0, 1)) {
      rows.push([{ text: `🔗 ${alt.label}`, url: alt.url }]);
    }

    await bot.sendMessage(chatId, card, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: rows.length ? { inline_keyboard: rows } : undefined,
    });
  }

  await bot.sendMessage(chatId, '¿Qué querés hacer ahora?', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔔 Últimas ofertas', callback_data: 'menu:ofertas' },
          { text: '📋 Mis alertas', callback_data: 'menu:mis_alertas' },
        ],
        [{ text: '🏠 Menú', callback_data: 'menu:main' }],
      ],
    },
  });
}

/** Barra de progreso ASCII (10 cells). */
function progressBar(pct) {
  const filled = Math.min(10, Math.max(0, Math.round(pct / 10)));
  return '▓'.repeat(filled) + '░'.repeat(10 - filled);
}

module.exports = { runDaily };
