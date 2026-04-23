/**
 * /buscar — wizard conversacional de búsqueda en tiempo real.
 *
 * Pasos:
 *   1. Origen (quick-pick o texto)
 *   2. Destino
 *   3. Tipo de viaje (ida / ida+vuelta)
 *   4. Fecha ida (calendario inline)
 *   5. Fecha vuelta (calendario inline, si aplica)
 *   6. Búsqueda híbrida (respetando prefs.search_mode)
 *   7. Resultados con deep-links
 *
 * @module bot/handlers/buscar
 */

'use strict';

const kb = require('../keyboards');
const fmt = require('../formatters');
const sessions = require('../sessions');
const userPrefsRepo = require('../../database/repositories/userPrefsRepo');
const hybrid = require('../../services/hybridSearch');
const { classifyPrice } = require('../../config/priceThresholds');
const { buildLinksForFlight } = require('../deepLinks');
const wz = require('./wizardUtils');
const calendar = require('../calendar');
const logger = require('../../utils/logger').child('bot:buscar');

const STATE = {
  ORIGIN: 'buscar:origin',
  DESTINATION: 'buscar:destination',
  TRIP_TYPE: 'buscar:trip_type',
  DEPART: 'buscar:depart',
  RETURN: 'buscar:return',
};

/** @param {import('node-telegram-bot-api')} bot */
function register(bot) {
  bot.onText(/^\/buscar(?:@\w+)?$/, async (msg) => {
    await startBuscarFlow(bot, msg.chat.id, msg.from?.id || msg.chat.id);
  });
}

/**
 * Arranca el wizard.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number} userId
 */
async function startBuscarFlow(bot, chatId, userId) {
  await sessions.setSession(chatId, { userId, state: STATE.ORIGIN, data: {} });
  await bot.sendMessage(
    chatId,
    '🔎 <b>Buscar vuelo</b>\n\n<b>Paso 1/4 — Origen</b>\n¿Desde qué aeropuerto salís?',
    {
      parse_mode: 'HTML',
      reply_markup: kb.iataQuickPicks('wizard:origin', [...wz.COMMON_AR, ...wz.COMMON_EU]),
    },
  );
  return true;
}

/**
 * Maneja callbacks del wizard (`wizard:origin:*`, `wizard:dest:*`,
 * `wizard:trip:*`, `wizard:cancel`).
 *
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').CallbackQuery} cq
 * @returns {Promise<boolean>}
 */
async function handleWizardCallback(bot, cq) {
  const data = cq.data || '';
  const chatId = cq.message?.chat.id;
  if (!chatId) return true;

  if (data === 'wizard:cancel') {
    await sessions.clearSession(chatId);
    await bot.answerCallbackQuery(cq.id, { text: 'Cancelado' });
    await bot.sendMessage(chatId, '🚫 Cancelado.', { reply_markup: kb.mainMenu() });
    return true;
  }

  const session = await sessions.getSession(chatId);
  if (!session) {
    await bot.answerCallbackQuery(cq.id, { text: 'Sesión expirada. /start' });
    return true;
  }

  // ── Wizard callbacks ──
  if (data.startsWith('wizard:')) {
    const [, kind, value] = data.split(':');

    if (kind === 'origin' && session.state === STATE.ORIGIN) {
      if (value === '_custom') {
        await bot.answerCallbackQuery(cq.id);
        await bot.sendMessage(chatId, '✍️ Escribí el código IATA (3 letras, ej. <code>EZE</code>).', {
          parse_mode: 'HTML', reply_markup: kb.cancelOnly(),
        });
        return true;
      }
      await acceptOrigin(bot, cq, session, value);
      return true;
    }

    if (kind === 'dest' && session.state === STATE.DESTINATION) {
      if (value === '_custom') {
        await bot.answerCallbackQuery(cq.id);
        await bot.sendMessage(chatId, '✍️ Escribí el código IATA del destino.', {
          parse_mode: 'HTML', reply_markup: kb.cancelOnly(),
        });
        return true;
      }
      await acceptDestination(bot, cq, session, value);
      return true;
    }

    if (kind === 'trip' && session.state === STATE.TRIP_TYPE) {
      await acceptTripType(bot, cq, session, /** @type {'oneway'|'roundtrip'} */ (value));
      return true;
    }
  }

  // ── Calendar callbacks ──
  const calData = calendar.parseCalendarCallback(data);
  if (calData) {
    if (calData.type === 'noop') {
      await bot.answerCallbackQuery(cq.id).catch(() => {});
      return true;
    }

    if (calData.type === 'nav') {
      const [y, m] = calData.yearMonth.split('-').map(Number);
      const field = calData.field;
      const minDate = field === 'r' ? session.data.departureDate : undefined;
      const calKeyboard = calendar.buildCalendar(y, m, field, { minDate });
      await bot.answerCallbackQuery(cq.id);
      await bot.editMessageReplyMarkup(calKeyboard, {
        chat_id: chatId,
        message_id: cq.message?.message_id,
      }).catch(() => {});
      return true;
    }

    if (calData.type === 'manual') {
      await bot.answerCallbackQuery(cq.id, { text: 'Escribí la fecha' });
      await bot.sendMessage(chatId,
        `✍️ Escribí la fecha en formato <code>2026-06-15</code> o <code>15/06/2026</code>.`,
        { parse_mode: 'HTML', reply_markup: kb.cancelOnly() },
      );
      return true;
    }

    if (calData.type === 'select') {
      const iso = calData.date;
      if (!iso || !wz.isFutureDate(iso)) {
        await bot.answerCallbackQuery(cq.id, { text: '❌ Fecha inválida' });
        return true;
      }

      if (calData.field === 'd' && session.state === STATE.DEPART) {
        await bot.answerCallbackQuery(cq.id, { text: `Ida: ${iso}` });
        await acceptDepart(bot, chatId, session, iso);
        return true;
      }

      if (calData.field === 'r' && session.state === STATE.RETURN) {
        if (iso <= session.data.departureDate) {
          await bot.answerCallbackQuery(cq.id, { text: '❌ Debe ser después de ida' });
          return true;
        }
        await bot.answerCallbackQuery(cq.id, { text: `Vuelta: ${iso}` });
        await sessions.setSession(chatId, {
          userId: session.userId, state: 'buscar:searching',
          data: { ...session.data, returnDate: iso },
        });
        await runSearch(bot, chatId, session.userId, { ...session.data, returnDate: iso });
        return true;
      }
    }

    return true;
  }

  return false;
}

/**
 * Captura texto libre durante un step que espera input (IATA).
 * Devuelve true si consumió el mensaje.
 *
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').Message} msg
 * @returns {Promise<boolean>}
 */
async function handleText(bot, msg) {
  const chatId = msg.chat.id;
  const session = await sessions.getSession(chatId);
  if (!session || !session.state.startsWith('buscar:')) return false;

  const text = (msg.text || '').trim().toUpperCase();

  if (session.state === STATE.ORIGIN) {
    if (!wz.isValidIata(text)) {
      await bot.sendMessage(chatId, '❌ IATA inválido. Usá 3 letras (ej. <code>EZE</code>).', {
        parse_mode: 'HTML', reply_markup: kb.cancelOnly(),
      });
      return true;
    }
    await acceptOrigin(bot, { id: undefined, from: msg.from, message: msg }, session, text);
    return true;
  }

  if (session.state === STATE.DESTINATION) {
    if (!wz.isValidIata(text)) {
      await bot.sendMessage(chatId, '❌ IATA inválido.', { reply_markup: kb.cancelOnly() });
      return true;
    }
    await acceptDestination(bot, { id: undefined, from: msg.from, message: msg }, session, text);
    return true;
  }

  // DEPART/RETURN ahora solo por calendario

  return false;
}

/* ───────── Transitions ───────── */

async function acceptOrigin(bot, cq, session, origin) {
  const chatId = session.chatId;
  await sessions.setSession(chatId, {
    userId: session.userId, state: STATE.DESTINATION, data: { ...session.data, origin },
  });
  if (cq.id) await bot.answerCallbackQuery(cq.id, { text: `Origen: ${origin}` });
  await bot.sendMessage(chatId,
    `✅ Origen: <b>${origin}</b>\n\n<b>Paso 2/4 — Destino</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: kb.iataQuickPicks('wizard:dest', [...wz.COMMON_EU, ...wz.COMMON_US, ...wz.COMMON_AR]),
    },
  );
}

async function acceptDestination(bot, cq, session, destination) {
  const chatId = session.chatId;
  if (destination === session.data.origin) {
    if (cq.id) await bot.answerCallbackQuery(cq.id, { text: 'No puede ser igual al origen' });
    return;
  }
  await sessions.setSession(chatId, {
    userId: session.userId, state: STATE.TRIP_TYPE,
    data: { ...session.data, destination },
  });
  if (cq.id) await bot.answerCallbackQuery(cq.id, { text: `Destino: ${destination}` });
  await bot.sendMessage(chatId,
    `✅ ${session.data.origin} → <b>${destination}</b>\n\n<b>Paso 3/4 — Tipo de viaje</b>`,
    { parse_mode: 'HTML', reply_markup: kb.tripTypeMenu() },
  );
}

async function acceptTripType(bot, cq, session, tripType) {
  const chatId = session.chatId;
  await sessions.setSession(chatId, {
    userId: session.userId, state: STATE.DEPART,
    data: { ...session.data, tripType },
  });
  await bot.answerCallbackQuery(cq.id, { text: tripType === 'oneway' ? 'Solo ida' : 'Ida y vuelta' });

  const { year, month } = calendar.initialCalendarMonth();
  const calKeyboard = calendar.buildCalendar(year, month, 'd');
  await bot.sendMessage(chatId,
    '<b>Paso 4/4 — Fecha de ida</b>\n\nElegí un día del calendario o escribí la fecha.',
    { parse_mode: 'HTML', reply_markup: calKeyboard },
  );
}

async function acceptDepart(bot, chatId, session, iso) {
  if (session.data.tripType === 'oneway') {
    await sessions.setSession(chatId, {
      userId: session.userId, state: 'buscar:searching',
      data: { ...session.data, departureDate: iso },
    });
    await runSearch(bot, chatId, session.userId, { ...session.data, departureDate: iso });
    return;
  }
  await sessions.setSession(chatId, {
    userId: session.userId, state: STATE.RETURN,
    data: { ...session.data, departureDate: iso },
  });
  const { year, month } = calendar.initialCalendarMonth(iso);
  const calKeyboard = calendar.buildCalendar(year, month, 'r', { minDate: iso });
  await bot.sendMessage(chatId,
    `✅ Ida: <b>${fmt.date(iso)}</b>\n\n<b>Fecha de vuelta</b>\n\nElegí un día o escribí la fecha.`,
    { parse_mode: 'HTML', reply_markup: calKeyboard },
  );
}

/* ───────── Ejecución de la búsqueda ───────── */

/**
 * Dispara la búsqueda según prefs.search_mode y muestra resultados.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number} userId
 * @param {{origin:string, destination:string, tripType:'oneway'|'roundtrip', departureDate:string, returnDate?:string}} params
 */
async function runSearch(bot, chatId, userId, params) {
  const prefs = await userPrefsRepo.getOrCreate(userId, chatId);
  await bot.sendMessage(chatId,
    `🔎 Buscando ${params.origin} → ${params.destination} ` +
    `(${fmt.date(params.departureDate)}${params.returnDate ? ' → ' + fmt.date(params.returnDate) : ''}) ` +
    `en modo <b>${prefs.search_mode}</b>…`,
    { parse_mode: 'HTML' },
  );

  try {
    /** @type {import('../../providers/base').FlightSearchParams} */
    const searchParams = {
      origin: params.origin,
      destination: params.destination,
      departureDate: params.departureDate,
      returnDate: params.returnDate || undefined,
      currency: prefs.currency,
      max: 8,
    };

    const result = await hybrid.search(searchParams, {
      mode: /** @type {any} */ (prefs.search_mode === 'scraper' ? 'background' : 'interactive'),
      forceProvider: prefs.search_mode === 'amadeus' ? 'amadeus'
        : prefs.search_mode === 'scraper' ? 'google_flights' : undefined,
    });

    if (result.flights.length === 0) {
      await bot.sendMessage(chatId, '🤷 Sin resultados para esas fechas.', {
        reply_markup: kb.mainMenu(),
      });
      await sessions.clearSession(chatId);
      return;
    }

    const sorted = [...result.flights].sort((a, b) => a.price - b.price).slice(0, 5);
    const header =
      `✅ <b>${result.flights.length} vuelos</b> (mostrando top 5)\n` +
      `Provider: <i>${result.providerUsed}</i>${result.cached ? ' · cache' : ''}\n` +
      (result.warnings?.length ? `⚠️ ${fmt.esc(result.warnings.join(' / '))}\n` : '');

    await bot.sendMessage(chatId, header, { parse_mode: 'HTML' });

    for (const f of sorted) {
      const { level } = classifyPrice(f.origin, f.destination, f.price, f.tripType);
      const badge = { steal: '🚨', great: '🔥', good: '✅' }[level] || '✈️';
      const links = buildLinksForFlight(f);
      const card = fmt.flightCard(f, { level, badge });

      const ikb = [[{ text: `🛒 ${links.primary.label}`, url: links.primary.url }]];
      for (const alt of links.alternatives.slice(0, 2)) {
        ikb.push([{ text: `🔗 ${alt.label}`, url: alt.url }]);
      }

      await bot.sendMessage(chatId, card, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: ikb },
        disable_web_page_preview: true,
      });
    }

    await bot.sendMessage(chatId, '¿Qué querés hacer ahora?', {
      reply_markup: kb.mainMenu(),
    });
  } catch (err) {
    logger.error('Search failed', /** @type {Error} */ (err));
    await bot.sendMessage(chatId,
      `❌ Error buscando: <code>${fmt.esc(/** @type {Error} */ (err).message)}</code>`,
      { parse_mode: 'HTML', reply_markup: kb.mainMenu() });
  } finally {
    await sessions.clearSession(chatId);
  }
}

module.exports = {
  register,
  startBuscarFlow,
  handleWizardCallback,
  handleText,
};
