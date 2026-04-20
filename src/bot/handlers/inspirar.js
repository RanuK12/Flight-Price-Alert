/**
 * /inspirar — destinos baratos desde un origen (Amadeus Inspiration).
 *
 * Pasos:
 *   1. Origen (quick-pick o IATA libre)
 *   2. Presupuesto máximo (opcional)
 *   3. Resultados (ordenados por precio)
 *
 * @module bot/handlers/inspirar
 */

'use strict';

const kb = require('../keyboards');
const fmt = require('../formatters');
const sessions = require('../sessions');
const userPrefsRepo = require('../../database/repositories/userPrefsRepo');
const hybrid = require('../../services/hybridSearch');
const wz = require('./wizardUtils');
const logger = require('../../utils/logger').child('bot:inspirar');

const STATE = {
  ORIGIN: 'inspirar:origin',
  BUDGET: 'inspirar:budget',
};

/** @param {import('node-telegram-bot-api')} bot */
function register(bot) {
  bot.onText(/^\/inspirar(?:@\w+)?$/, async (msg) => {
    await startInspirarFlow(bot, msg.chat.id, msg.from?.id || msg.chat.id);
  });
}

/** @param {import('node-telegram-bot-api')} bot @param {number} chatId @param {number} userId */
async function startInspirarFlow(bot, chatId, userId) {
  await sessions.setSession(chatId, { userId, state: STATE.ORIGIN, data: {} });
  await bot.sendMessage(chatId,
    '💡 <b>Inspirarme</b>\n\nElegí tu aeropuerto de origen y te muestro destinos baratos.',
    {
      parse_mode: 'HTML',
      reply_markup: kb.iataQuickPicks('inspirar:origin', wz.COMMON_AR),
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
  if (!data.startsWith('inspirar:')) return false;
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
      await bot.sendMessage(chatId, '✍️ IATA de origen.', { reply_markup: kb.cancelOnly() });
      return true;
    }
    await acceptOrigin(bot, cq, session, value);
    return true;
  }

  if (kind === 'budget' && session.state === STATE.BUDGET) {
    const budget = value === '_skip' ? null : Number(value);
    await bot.answerCallbackQuery(cq.id);
    await runInspire(bot, chatId, session.userId, session.data.origin, budget);
    return true;
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
  if (!session || !session.state.startsWith('inspirar:')) return false;

  const raw = (msg.text || '').trim();

  if (session.state === STATE.ORIGIN) {
    const upper = raw.toUpperCase();
    if (!wz.isValidIata(upper)) {
      await bot.sendMessage(chatId, '❌ IATA inválido.', { reply_markup: kb.cancelOnly() });
      return true;
    }
    await acceptOrigin(bot, { id: undefined, from: msg.from, message: msg }, session, upper);
    return true;
  }

  if (session.state === STATE.BUDGET) {
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      await bot.sendMessage(chatId, '❌ Presupuesto inválido.', { reply_markup: budgetKb() });
      return true;
    }
    await runInspire(bot, chatId, session.userId, session.data.origin, n);
    return true;
  }

  return false;
}

async function acceptOrigin(bot, cq, session, origin) {
  const chatId = session.chatId;
  await sessions.setSession(chatId, {
    userId: session.userId, state: STATE.BUDGET, data: { origin },
  });
  if (cq.id) await bot.answerCallbackQuery(cq.id, { text: `Origen: ${origin}` });
  await bot.sendMessage(chatId,
    `✅ Origen: <b>${origin}</b>\n\n<b>Presupuesto máximo</b> (opcional)`,
    { parse_mode: 'HTML', reply_markup: budgetKb() },
  );
}

function budgetKb() {
  return {
    inline_keyboard: [
      [
        { text: '≤ 300', callback_data: 'inspirar:budget:300' },
        { text: '≤ 500', callback_data: 'inspirar:budget:500' },
        { text: '≤ 800', callback_data: 'inspirar:budget:800' },
      ],
      [{ text: '♾️ Sin límite', callback_data: 'inspirar:budget:_skip' }],
      [{ text: '✖️ Cancelar', callback_data: 'wizard:cancel' }],
    ],
  };
}

async function runInspire(bot, chatId, userId, origin, budget) {
  const prefs = await userPrefsRepo.getOrCreate(userId, chatId);
  await bot.sendMessage(chatId,
    `💡 Buscando destinos baratos desde <b>${origin}</b>${budget ? ` (≤ ${budget} ${prefs.currency})` : ''}…`,
    { parse_mode: 'HTML' },
  );

  try {
    const results = await hybrid.inspire({
      origin,
      maxPrice: budget || undefined,
    });

    if (!results || results.length === 0) {
      await bot.sendMessage(chatId, '🤷 Sin destinos para esos parámetros.', { reply_markup: kb.mainMenu() });
      await sessions.clearSession(chatId);
      return;
    }

    const sorted = [...results].sort((a, b) => a.price - b.price).slice(0, 10);
    await bot.sendMessage(chatId,
      `✅ <b>${sorted.length} destinos</b> (top baratos)`, { parse_mode: 'HTML' });

    for (const d of sorted) {
      const text =
        `✈️ <b>${fmt.price(d.price, d.currency)}</b>\n` +
        `${fmt.esc(d.origin)} → <b>${fmt.esc(d.destination)}</b>\n` +
        `📅 ${fmt.date(d.departureDate)}${d.returnDate ? ` → ${fmt.date(d.returnDate)}` : ''}`;
      const ikb = d.bookingUrl
        ? { inline_keyboard: [[{ text: '🔗 Ver en Amadeus', url: d.bookingUrl }]] }
        : undefined;
      await bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: ikb,
        disable_web_page_preview: true,
      });
    }

    await bot.sendMessage(chatId, '¿Qué querés hacer ahora?', { reply_markup: kb.mainMenu() });
  } catch (err) {
    logger.error('Inspire failed', /** @type {Error} */ (err));
    await bot.sendMessage(chatId,
      `❌ Error: <code>${fmt.esc(/** @type {Error} */ (err).message)}</code>`,
      { parse_mode: 'HTML', reply_markup: kb.mainMenu() });
  } finally {
    await sessions.clearSession(chatId);
  }
}

module.exports = {
  register,
  startInspirarFlow,
  handleCallback,
  handleText,
};
