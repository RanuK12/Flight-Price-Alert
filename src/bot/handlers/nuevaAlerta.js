/**
 * /nueva_alerta — wizard para crear una ruta monitoreada.
 *
 * Pasos: origin → destination → tripType → depart → return? → threshold → name?
 *
 * @module bot/handlers/nuevaAlerta
 */

'use strict';

const kb = require('../keyboards');
const fmt = require('../formatters');
const sessions = require('../sessions');
const routesRepo = require('../../database/repositories/routesRepo');
const userPrefsRepo = require('../../database/repositories/userPrefsRepo');
const wz = require('./wizardUtils');
const logger = require('../../utils/logger').child('bot:nuevaAlerta');

const STATE = {
  ORIGIN: 'nueva:origin',
  DESTINATION: 'nueva:destination',
  TRIP: 'nueva:trip',
  DEPART: 'nueva:depart',
  RETURN: 'nueva:return',
  THRESHOLD: 'nueva:threshold',
  NAME: 'nueva:name',
};

/** @param {import('node-telegram-bot-api')} bot */
function register(bot) {
  bot.onText(/^\/nueva_alerta(?:@\w+)?$/, async (msg) => {
    await startNuevaAlertaFlow(bot, msg.chat.id, msg.from?.id || msg.chat.id);
  });
}

/** @param {import('node-telegram-bot-api')} bot @param {number} chatId @param {number} userId */
async function startNuevaAlertaFlow(bot, chatId, userId) {
  await sessions.setSession(chatId, { userId, state: STATE.ORIGIN, data: {} });
  await bot.sendMessage(chatId,
    '➕ <b>Nueva alerta</b>\n\n<b>Paso 1/6 — Origen</b>',
    {
      parse_mode: 'HTML',
      reply_markup: kb.iataQuickPicks('nueva:origin', [...wz.COMMON_AR, ...wz.COMMON_EU]),
    },
  );
  return true;
}

/**
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').CallbackQuery} cq
 * @returns {Promise<boolean>}
 */
async function handleCallback(bot, cq) {
  const data = cq.data || '';
  if (!data.startsWith('nueva:')) return false;
  const chatId = cq.message?.chat.id;
  if (!chatId) return true;

  const session = await sessions.getSession(chatId);
  if (!session) {
    await bot.answerCallbackQuery(cq.id, { text: 'Sesión expirada. /start' });
    return true;
  }

  const [, kind, value] = data.split(':');

  if (kind === 'origin' && session.state === STATE.ORIGIN) {
    if (value === '_custom') {
      await bot.answerCallbackQuery(cq.id);
      await bot.sendMessage(chatId, '✍️ Escribí el IATA de origen.', { reply_markup: kb.cancelOnly() });
      return true;
    }
    await acceptOrigin(bot, cq, session, value);
    return true;
  }

  if (kind === 'dest' && session.state === STATE.DESTINATION) {
    if (value === '_custom') {
      await bot.answerCallbackQuery(cq.id);
      await bot.sendMessage(chatId, '✍️ Escribí el IATA de destino.', { reply_markup: kb.cancelOnly() });
      return true;
    }
    await acceptDestination(bot, cq, session, value);
    return true;
  }

  if (kind === 'trip' && session.state === STATE.TRIP) {
    await acceptTripType(bot, cq, session, /** @type {'oneway'|'roundtrip'} */ (value));
    return true;
  }

  if (kind === 'skip') {
    if (session.state === STATE.THRESHOLD) {
      await bot.answerCallbackQuery(cq.id, { text: 'Sin umbral' });
      await sessions.setSession(chatId, {
        userId: session.userId, state: STATE.NAME,
        data: { ...session.data, priceThreshold: null },
      });
      await askName(bot, chatId);
      return true;
    }
    if (session.state === STATE.NAME) {
      await bot.answerCallbackQuery(cq.id);
      await finalize(bot, chatId, session.userId, { ...session.data, name: null });
      return true;
    }
  }

  return true;
}

/**
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').Message} msg
 * @returns {Promise<boolean>}
 */
async function handleText(bot, msg) {
  const chatId = msg.chat.id;
  const session = await sessions.getSession(chatId);
  if (!session || !session.state.startsWith('nueva:')) return false;

  const raw = (msg.text || '').trim();
  const upper = raw.toUpperCase();

  if (session.state === STATE.ORIGIN) {
    if (!wz.isValidIata(upper)) {
      await bot.sendMessage(chatId, '❌ IATA inválido.', { reply_markup: kb.cancelOnly() });
      return true;
    }
    await acceptOrigin(bot, { id: undefined, from: msg.from, message: msg }, session, upper);
    return true;
  }

  if (session.state === STATE.DESTINATION) {
    if (!wz.isValidIata(upper)) {
      await bot.sendMessage(chatId, '❌ IATA inválido.', { reply_markup: kb.cancelOnly() });
      return true;
    }
    await acceptDestination(bot, { id: undefined, from: msg.from, message: msg }, session, upper);
    return true;
  }

  if (session.state === STATE.DEPART) {
    const iso = wz.parseDate(raw);
    if (!iso || !wz.isFutureDate(iso)) {
      await bot.sendMessage(chatId, '❌ Fecha inválida.', { reply_markup: kb.cancelOnly() });
      return true;
    }
    await acceptDepart(bot, chatId, session, iso);
    return true;
  }

  if (session.state === STATE.RETURN) {
    const iso = wz.parseDate(raw);
    if (!iso || !wz.isFutureDate(iso) || iso <= session.data.outboundDate) {
      await bot.sendMessage(chatId, '❌ Fecha de vuelta inválida.', { reply_markup: kb.cancelOnly() });
      return true;
    }
    await sessions.setSession(chatId, {
      userId: session.userId, state: STATE.THRESHOLD,
      data: { ...session.data, returnDate: iso },
    });
    await askThreshold(bot, chatId);
    return true;
  }

  if (session.state === STATE.THRESHOLD) {
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      await bot.sendMessage(chatId, '❌ Ingresá un número (ej. <code>500</code>) o tocá Saltar.', {
        parse_mode: 'HTML', reply_markup: skipKb(),
      });
      return true;
    }
    await sessions.setSession(chatId, {
      userId: session.userId, state: STATE.NAME,
      data: { ...session.data, priceThreshold: n },
    });
    await askName(bot, chatId);
    return true;
  }

  if (session.state === STATE.NAME) {
    await finalize(bot, chatId, session.userId, { ...session.data, name: raw.slice(0, 40) });
    return true;
  }

  return false;
}

/* ───────── Transitions ───────── */

async function acceptOrigin(bot, cq, session, origin) {
  const chatId = session.chatId;
  await sessions.setSession(chatId, {
    userId: session.userId, state: STATE.DESTINATION,
    data: { ...session.data, origin },
  });
  if (cq.id) await bot.answerCallbackQuery(cq.id, { text: `Origen: ${origin}` });
  await bot.sendMessage(chatId,
    `✅ Origen: <b>${origin}</b>\n\n<b>Paso 2/6 — Destino</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: kb.iataQuickPicks('nueva:dest', [...wz.COMMON_EU, ...wz.COMMON_US, ...wz.COMMON_AR]),
    },
  );
}

async function acceptDestination(bot, cq, session, destination) {
  const chatId = session.chatId;
  if (destination === session.data.origin) {
    if (cq.id) await bot.answerCallbackQuery(cq.id, { text: 'Igual al origen' });
    return;
  }
  await sessions.setSession(chatId, {
    userId: session.userId, state: STATE.TRIP,
    data: { ...session.data, destination },
  });
  if (cq.id) await bot.answerCallbackQuery(cq.id, { text: `Destino: ${destination}` });
  await bot.sendMessage(chatId,
    `✅ ${session.data.origin} → <b>${destination}</b>\n\n<b>Paso 3/6 — Tipo de viaje</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '➡️ Solo ida', callback_data: 'nueva:trip:oneway' },
            { text: '🔄 Ida y vuelta', callback_data: 'nueva:trip:roundtrip' },
          ],
          [{ text: '✖️ Cancelar', callback_data: 'wizard:cancel' }],
        ],
      },
    },
  );
}

async function acceptTripType(bot, cq, session, tripType) {
  const chatId = session.chatId;
  await sessions.setSession(chatId, {
    userId: session.userId, state: STATE.DEPART,
    data: { ...session.data, tripType },
  });
  await bot.answerCallbackQuery(cq.id, { text: tripType === 'oneway' ? 'Solo ida' : 'Ida y vuelta' });
  await bot.sendMessage(chatId,
    `<b>Paso 4/6 — Fecha de ida</b>\n\nFormato: <code>2026-06-15</code> o <code>15/06/2026</code>.\nPodés dejar sin fecha si querés monitoreo "rango abierto" — por ahora, indicá una fecha.`,
    { parse_mode: 'HTML', reply_markup: kb.cancelOnly() },
  );
}

async function acceptDepart(bot, chatId, session, iso) {
  if (session.data.tripType === 'oneway') {
    await sessions.setSession(chatId, {
      userId: session.userId, state: STATE.THRESHOLD,
      data: { ...session.data, outboundDate: iso },
    });
    await askThreshold(bot, chatId);
    return;
  }
  await sessions.setSession(chatId, {
    userId: session.userId, state: STATE.RETURN,
    data: { ...session.data, outboundDate: iso },
  });
  await bot.sendMessage(chatId,
    `✅ Ida: <b>${fmt.date(iso)}</b>\n\n<b>Fecha de vuelta</b>`,
    { parse_mode: 'HTML', reply_markup: kb.cancelOnly() },
  );
}

async function askThreshold(bot, chatId) {
  await bot.sendMessage(chatId,
    '<b>Paso 5/6 — Umbral de alerta (opcional)</b>\n\n' +
    'Precio máximo que te interesa (ej. <code>500</code>). Si no, saltá.',
    { parse_mode: 'HTML', reply_markup: skipKb() },
  );
}

async function askName(bot, chatId) {
  await bot.sendMessage(chatId,
    '<b>Paso 6/6 — Nombre (opcional)</b>\n\nEj. <code>Vacaciones Roma</code>. Si no, saltá.',
    { parse_mode: 'HTML', reply_markup: skipKb() },
  );
}

function skipKb() {
  return {
    inline_keyboard: [
      [{ text: '⏭️ Saltar', callback_data: 'nueva:skip' }],
      [{ text: '✖️ Cancelar', callback_data: 'wizard:cancel' }],
    ],
  };
}

async function finalize(bot, chatId, userId, data) {
  try {
    const prefs = await userPrefsRepo.getOrCreate(userId, chatId);
    const route = await routesRepo.createRoute({
      telegramUserId: userId,
      telegramChatId: chatId,
      origin: data.origin,
      destination: data.destination,
      outboundDate: data.outboundDate,
      returnDate: data.returnDate || null,
      tripType: data.tripType,
      currency: prefs.currency,
      priceThreshold: data.priceThreshold ?? undefined,
      name: data.name || undefined,
    });
    await bot.sendMessage(chatId,
      `✅ <b>Alerta creada</b>\n\n${fmt.routeLine(route)}`,
      { parse_mode: 'HTML', reply_markup: kb.mainMenu() },
    );
  } catch (err) {
    logger.error('Create route failed', /** @type {Error} */ (err));
    await bot.sendMessage(chatId,
      `❌ Error al crear la alerta: <code>${fmt.esc(/** @type {Error} */ (err).message)}</code>`,
      { parse_mode: 'HTML', reply_markup: kb.mainMenu() });
  } finally {
    await sessions.clearSession(chatId);
  }
}

module.exports = {
  register,
  startNuevaAlertaFlow,
  handleCallback,
  handleText,
};
