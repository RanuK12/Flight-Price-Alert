/**
 * /ofertas — muestra las últimas notificaciones de oferta que recibió
 * el usuario, reutilizando los deep-links. Útil para "rescatar" ofertas
 * que no abriste al momento.
 *
 * @module bot/handlers/ofertas
 */

'use strict';

const kb = require('../keyboards');
const fmt = require('../formatters');
const notificationsRepo = require('../../database/repositories/notificationsRepo');
const { buildLinksForFlight } = require('../deepLinks');

const PAGE_SIZE = 8;

/** @param {import('node-telegram-bot-api')} bot */
function register(bot) {
  bot.onText(/^\/ofertas(?:@\w+)?$/, async (msg) => {
    await renderOfertas(bot, msg.chat.id, msg.from?.id || msg.chat.id);
  });
}

/**
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number} userId
 * @param {number} [messageId] para editar si viene de callback
 */
async function renderOfertas(bot, chatId, userId, messageId) {
  const [list, stats] = await Promise.all([
    notificationsRepo.listLatestForUser(userId, PAGE_SIZE),
    notificationsRepo.statsLast24h(userId),
  ]);

  if (!list || list.length === 0) {
    const empty =
      '🔔 <b>Últimas ofertas</b>\n\n' +
      'Todavía no hay notificaciones.\n' +
      'Cuando el monitoreo detecte un precio bajo en alguna de tus alertas, ' +
      'te llegará acá y aparecerá en esta lista.';
    if (messageId) {
      await bot.editMessageText(empty, {
        chat_id: chatId, message_id: messageId,
        parse_mode: 'HTML', reply_markup: kb.mainMenu(),
      }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, empty, { parse_mode: 'HTML', reply_markup: kb.mainMenu() });
    }
    return true;
  }

  const header =
    `🔔 <b>Últimas ofertas</b> (top ${list.length})\n` +
    `Últimas 24h: <b>${stats.count}</b> ofertas · ` +
    `🚨 ${stats.steals || 0} ofertones · 🔥 ${stats.greats || 0} muy buenas` +
    (stats.min_price ? ` · mejor <b>${fmt.price(stats.min_price, list[0].currency)}</b>` : '');

  if (messageId) {
    await bot.editMessageText(header, {
      chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
    }).catch(() => {});
  } else {
    await bot.sendMessage(chatId, header, { parse_mode: 'HTML' });
  }

  for (const n of list) {
    const fakeFlight = /** @type {import('../../providers/base').Flight} */ ({
      source: n.provider || 'unknown',
      origin: n.origin,
      destination: n.destination,
      price: n.price,
      currency: n.currency,
      tripType: /** @type {any} */ (n.trip_type),
      departureDate: n.departure_date,
      returnDate: n.return_date,
      airline: n.airline || 'Unknown',
      carrierCodes: [],
      stops: n.stops ?? 0,
      bookingUrl: n.booking_url || undefined,
    });
    const badge = ({ steal: '🚨', great: '🔥', good: '✅' }[n.deal_level]) || '✈️';
    const card = fmt.flightCard(fakeFlight, { level: n.deal_level, badge });
    const sentAgo = timeAgo(n.sent_at);
    const text = `${card}\n<i>🕒 ${sentAgo}</i>`;

    const links = buildLinksForFlight(fakeFlight);
    const rows = [];
    if (links.primary) rows.push([{ text: `🛒 ${links.primary.label}`, url: links.primary.url }]);
    for (const alt of links.alternatives.slice(0, 1)) {
      rows.push([{ text: `🔗 ${alt.label}`, url: alt.url }]);
    }

    await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: rows.length ? { inline_keyboard: rows } : undefined,
    });
  }

  await bot.sendMessage(chatId, '⬇️', { reply_markup: kb.mainMenu() });
  return true;
}

/** "hace 12 min", "hace 3 h", "hace 2 días". */
function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return `hace ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

module.exports = { register, renderOfertas };
