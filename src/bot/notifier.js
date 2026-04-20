/**
 * Notifier — dispara notificaciones de oferta por Telegram usando
 * el mismo estilo visual que el bot interactivo (flightCard +
 * deep-links por carrier + emojis según deal level). Persiste cada
 * notificación en `offer_notifications` para:
 *   · Deduplicar (no reenviar lo mismo en <12h).
 *   · Exponer el historial en el bot ("🔔 Últimas ofertas").
 *
 * @module bot/notifier
 */

'use strict';

const fmt = require('./formatters');
const { buildLinksForFlight } = require('./deepLinks');
const notificationsRepo = require('../database/repositories/notificationsRepo');
const logger = require('../utils/logger').child('notifier');
const { getBot } = require('./index');

/**
 * @typedef {Object} OfferContext
 * @property {number} telegramUserId
 * @property {number} telegramChatId
 * @property {number|null} [routeId]
 * @property {string} dealLevel
 * @property {number|null} [threshold]
 * @property {string} [routeName]
 */

/**
 * Envía una notificación de oferta si no se envió recientemente.
 * @param {import('../providers/base').Flight} flight
 * @param {OfferContext} ctx
 * @returns {Promise<{sent: boolean, reason?: string, id?: number}>}
 */
async function notifyOffer(flight, ctx) {
  const bot = getBot();
  if (!bot) {
    logger.warn('Bot no inicializado, skip notify');
    return { sent: false, reason: 'bot-not-ready' };
  }

  const dedupKey = notificationsRepo.buildDedupKey({
    telegramUserId: ctx.telegramUserId,
    origin: flight.origin,
    destination: flight.destination,
    departureDate: flight.departureDate,
    returnDate: flight.returnDate,
    price: flight.price,
  });

  if (await notificationsRepo.wasNotifiedRecently(dedupKey)) {
    return { sent: false, reason: 'dedup' };
  }

  const emoji = ({
    steal: '🚨🔥 OFERTÓN',
    great: '🔥 Muy buena',
    good: '✅ Buen precio',
  }[ctx.dealLevel]) || '✈️ Precio';

  const routeTitle = ctx.routeName ? ` — <i>${fmt.esc(ctx.routeName)}</i>` : '';
  const thresholdLine = ctx.threshold
    ? `🎯 Umbral: <b>${fmt.price(ctx.threshold, flight.currency)}</b>\n`
    : '';

  const card = fmt.flightCard(flight, { level: ctx.dealLevel, badge: emoji.split(' ')[0] });

  const text =
    `${emoji}${routeTitle}\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `${card}\n` +
    thresholdLine +
    `<i>Detectado ${fmt.date(new Date().toISOString())}</i>`;

  // Deep-links (primary + hasta 2 alternativas).
  const links = buildLinksForFlight(flight);
  const inlineRows = [];
  if (links.primary) {
    inlineRows.push([{ text: `🛒 ${links.primary.label}`, url: links.primary.url }]);
  }
  for (const alt of links.alternatives.slice(0, 2)) {
    inlineRows.push([{ text: `🔗 ${alt.label}`, url: alt.url }]);
  }
  inlineRows.push([
    { text: '📋 Mis alertas', callback_data: 'menu:mis_alertas' },
    { text: '🏠 Menú', callback_data: 'menu:main' },
  ]);

  try {
    await bot.sendMessage(ctx.telegramChatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: inlineRows },
    });
  } catch (err) {
    logger.error('sendMessage falló', /** @type {Error} */ (err));
    return { sent: false, reason: 'send-failed' };
  }

  const id = await notificationsRepo.insertNotification({
    telegram_user_id: ctx.telegramUserId,
    telegram_chat_id: ctx.telegramChatId,
    route_id: ctx.routeId ?? null,
    origin: flight.origin,
    destination: flight.destination,
    trip_type: flight.tripType,
    departure_date: flight.departureDate,
    return_date: flight.returnDate || null,
    airline: flight.airline,
    stops: flight.stops ?? null,
    price: flight.price,
    currency: flight.currency,
    deal_level: ctx.dealLevel,
    threshold: ctx.threshold ?? null,
    provider: flight.source,
    booking_url: links.primary?.url || flight.bookingUrl || null,
    dedup_key: dedupKey,
  });

  logger.info('Notified offer', {
    user: ctx.telegramUserId,
    route: `${flight.origin}-${flight.destination}`,
    price: flight.price,
    level: ctx.dealLevel,
    id,
  });
  return { sent: true, id };
}

/**
 * Envía un resumen de batch ("X ofertas encontradas") como header antes
 * de los mensajes individuales. Útil cuando el cron encuentra varias a
 * la vez.
 * @param {number} chatId @param {number} count
 */
async function notifyBatchHeader(chatId, count) {
  const bot = getBot();
  if (!bot || count <= 0) return;
  await bot.sendMessage(chatId,
    `🔔 <b>${count} ofertas nuevas</b> detectadas en tus alertas.\n` +
    `Mirá cada una abajo 👇`,
    { parse_mode: 'HTML' },
  ).catch(() => {});
}

module.exports = { notifyOffer, notifyBatchHeader };
