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

/**
 * Valida si el precio de Amadeus es coerente con Google.
 * Si difiere >50%, asume que Amadeus tiene pricing errado.
 */
/**
 * Valida si el precio de Amadeus es coerente con Google.
 * Si difiere >50%, asume que Amadeus tiene pricing errado.
 *
 * NOTE: helper legacy. La validacion principal se hace ahora en el
 * sanity-check middleware (src/services/sanityCheck.js) + cross-check
 * Amadeus dentro de notifyOffer. Mantenido por compatibilidad.
 */
function validatePrice(source, amadeusPrice, googlePrice) {
  if (source !== 'amadeus') return { valid: true, price: amadeusPrice };
  if (!googlePrice || googlePrice <= 0) return { valid: true, price: amadeusPrice };
  
  const diff = Math.abs(googlePrice - amadeusPrice) / googlePrice;
  
  // Si difiere >50%, el precio de Amadeus es probablemente erróneo
  if (diff > 0.5) {
    return { valid: false, price: googlePrice, reason: 'Amadeus price differs >50% from Google' };
  }
  
  // Si difiere entre 20-50%, usamos el de Google (más conservador)
  if (diff > 0.2) {
    return { valid: true, price: googlePrice, reason: 'Using Google price (conservative)' };
  }
  
  // Difiere <20%, usamos Amadeus
  return { valid: true, price: amadeusPrice };
}

const fmt = require('./formatters');
const { buildLinksForFlight } = require('./deepLinks');
const notificationsRepo = require('../database/repositories/notificationsRepo');
const sanity = require('../services/sanityCheck');
const logger = require('../utils/logger').child('notifier');
const { getBot } = require('./index');

/**
 * @typedef {Object} OfferContext
 * @property {number} telegramUserId
 * @property {number} telegramChatId
 * @property {string|null} [routeId]
 * @property {string} dealLevel
 * @property {number|null} [threshold]
 * @property {string} [routeName]
 * @property {boolean} [silent]
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

  // ─── SANITY CHECK MIDDLEWARE ──────────────────────────────────
  // Bloquea precios fisicamente imposibles (bug parser, error fares
  // basura) antes de enviar/persistir. Tres capas: hard-floor, threshold
  // floor (60% steal), historico p25. Capa 'block' descarta sin trace en DB,
  // capa 'quarantine' permite cross-check Amadeus o persiste con
  // verificationRequired=true. Ver src/services/sanityCheck.js.
  const verdict = await sanity.check(flight).catch((err) => {
    logger.warn('sanityCheck error (failing-open)', { err: err.message });
    return { ok: true, severity: 'pass' };
  });
  if (!verdict.ok) {
    logger.warn('Sanity check failed, skip notify', {
      route: `${flight.origin}-${flight.destination}`,
      price: flight.price, currency: flight.currency,
      severity: verdict.severity, reason: verdict.reason,
    });

    if (verdict.severity === 'block') {
      return { sent: false, reason: `sanity-block: ${verdict.reason}` };
    }
    // 'quarantine': intentar cross-check con Amadeus 1:1.
    // Si no esta disponible o falla, descartamos por seguridad.
    if (verdict.severity === 'quarantine') {
      const amaPrice = await tryAmadeusCrossCheck(flight).catch(() => null);
      if (!amaPrice) {
        return { sent: false, reason: `sanity-quarantine-no-validator: ${verdict.reason}` };
      }
      const diff = Math.abs(amaPrice - flight.price) / amaPrice;
      if (diff > 0.4) {
        logger.warn('Quarantine confirmed: Amadeus price differs >40%', {
          route: `${flight.origin}-${flight.destination}`,
          scraperPrice: flight.price, amadeusPrice: amaPrice, diff: diff.toFixed(2),
        });
        return { sent: false, reason: `sanity-quarantine-amadeus-mismatch (scraper=${flight.price} vs amadeus=${amaPrice})` };
      }
      // Precios coherentes: Amadeus confirma. Pero usamos el de Amadeus
      // (mas confiable) en el envio.
      logger.info('Quarantine cleared by Amadeus cross-check', {
        route: `${flight.origin}-${flight.destination}`,
        scraperPrice: flight.price, amadeusPrice: amaPrice,
      });
      flight = { ...flight, price: amaPrice };
    }
  }

  const emoji = ({
    steal: '🚨🔥 OFERTÓN',
    great: '🔥 Muy buena',
    good: '✅ Buen precio',
  }[ctx.dealLevel]) || '✈️ Precio';

  const routeTitle = ctx.routeName ? ` — <i>${fmt.esc(ctx.routeName)}</i>` : '';
  // Threshold currency: usar la pasada por contexto (route.currency) si existe,
  // si no, fallback al currency del vuelo. Evita mostrar "US$155 vs €420".
  const thresholdCurrency = ctx.thresholdCurrency || flight.currency || 'EUR';
  const thresholdLine = ctx.threshold
    ? `🎯 Umbral: <b>${fmt.price(ctx.threshold, thresholdCurrency)}</b>\n`
    : '';

  const card = fmt.flightCard(flight, { level: ctx.dealLevel, badge: emoji.split(' ')[0] });

// NOTA: El precio en Google puede diferir (cambia en tiempo real)

  const text =
    `${emoji}${routeTitle}\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `${card}\n` +
    thresholdLine +
    `<i>Detectado ${fmt.date(new Date().toISOString())} ${flight.source === 'amadeus' ? '⚠️ <i>Amadeus: precio puede diferir en Google</i>' : ''}</i>`;

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
      disable_notification: ctx.silent ?? false,
      reply_markup: { inline_keyboard: inlineRows },
    });
  } catch (err) {
    logger.error('sendMessage falló', /** @type {Error} */ (err));
    return { sent: false, reason: 'send-failed' };
  }

  const id = await notificationsRepo.insertNotification({
    user_id: ctx.routeId ? null : null, // se resolverá en el repo si es necesario
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
    silent: ctx.silent ?? false,
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

/**
 * Cross-check Amadeus para una oferta sospechosa. No-bloqueante:
 * cualquier error/timeout/budget-exceeded retorna null y el llamador
 * decide. Best-effort.
 *
 * @param {import('../providers/base').Flight} flight
 * @returns {Promise<number|null>} precio Amadeus en la misma moneda del flight, o null
 */
async function tryAmadeusCrossCheck(flight) {
  // Si la oferta YA es de Amadeus, no tiene sentido cross-checkear con el mismo provider.
  if (flight.source === 'amadeus') return flight.price;
  try {
    // eslint-disable-next-line global-require
    const amadeus = require('../providers/amadeus');
    const result = await Promise.race([
      amadeus.offers.searchFlights({
        origin: flight.origin,
        destination: flight.destination,
        departureDate: flight.departureDate,
        returnDate: flight.returnDate || undefined,
        currency: flight.currency || 'EUR',
        max: 1,
      }),
      // Timeout duro: cross-check no puede bloquear un envio mas de 8s.
      new Promise((_, rej) => setTimeout(() => rej(new Error('cross-check-timeout')), 8000)),
    ]);
    const p = result?.flights?.[0]?.price;
    return typeof p === 'number' && p > 0 ? p : null;
  } catch (err) {
    logger.debug('tryAmadeusCrossCheck fallo', { err: /** @type {Error} */(err).message });
    return null;
  }
}

module.exports = { notifyOffer, notifyBatchHeader, validatePrice };
