/**
 * Auto-seed de rutas por defecto al bootear.
 *
 * Solo corre si el usuario primario (first TELEGRAM_CHAT_ID) tiene 0 rutas.
 * Es idempotente gracias al ON CONFLICT de routesRepo.createRoute, pero
 * el "0 rutas" evita el costo de intentar N inserts en cada boot.
 *
 * Buckets:
 *   (A) COR↔MDQ roundtrip 7 días, próximas 2 semanas (steal only).
 *   (B) EZE/COR → MAD/BCN/FCO/MXP one-way jun-jul 2026 (steal only).
 *
 * @module bootstrap/seedDefaultRoutes
 */

'use strict';

const { config } = require('../config');
const routesRepo = require('../database/repositories/routesRepo');
const userPrefsRepo = require('../database/repositories/userPrefsRepo');
const { getThreshold } = require('../config/priceThresholds');
const logger = require('../utils/logger').child('seed');

/** @param {Date} d */
function fmt(d) { return d.toISOString().split('T')[0]; }

/**
 * Pares ida→vuelta con separación fija de N días, todos los días del rango.
 * @param {Date} start @param {Date} end @param {number} tripDays
 */
function roundtripPairs(start, end, tripDays) {
  const pairs = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const ret = new Date(cursor);
    ret.setDate(ret.getDate() + tripDays);
    pairs.push({ outbound: fmt(cursor), ret: fmt(ret) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return pairs;
}

/**
 * Muestra N fechas de un rango priorizando martes/miércoles (más baratos).
 * @param {Date} start @param {Date} end @param {number} maxDates
 */
function sampleDates(start, end, maxDates) {
  const preferredDow = new Set([2, 3]);
  const preferred = []; const others = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    (preferredDow.has(cursor.getDay()) ? preferred : others).push(fmt(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return [
    ...preferred.slice(0, Math.ceil(maxDates * 0.6)),
    ...others.slice(0, maxDates),
  ].slice(0, maxDates).sort();
}

/**
 * Corre el seed si corresponde.
 * @returns {Promise<{ran: boolean, created?: number, reason?: string}>}
 */
async function seedIfEmpty() {
  const first = config.telegram.chatIds[0];
  if (!first) {
    logger.warn('No TELEGRAM_CHAT_ID configurado, seed omitido');
    return { ran: false, reason: 'no-chat-id' };
  }
  const userId = Number(first);
  if (!Number.isFinite(userId)) {
    logger.warn('TELEGRAM_CHAT_ID inválido, seed omitido', { first });
    return { ran: false, reason: 'bad-chat-id' };
  }

  // Asegurar user_prefs para el usuario (FK indirecta + defaults).
  await userPrefsRepo.getOrCreate(userId, userId);

  const existing = await routesRepo.listByUser(userId);
  if (existing.length > 0) {
    logger.info('Usuario ya tiene rutas, skip seed', { userId, count: existing.length });
    return { ran: false, reason: 'already-seeded' };
  }

  logger.info('Seeding rutas por defecto', { userId });
  const all = buildRoutes(userId);

  let created = 0;
  let errors = 0;
  for (const r of all) {
    try { await routesRepo.createRoute(r); created += 1; }
    catch (err) {
      errors += 1;
      logger.warn('Seed insert failed', {
        origin: r.origin, destination: r.destination, date: r.outboundDate,
        err: /** @type {Error} */ (err).message,
      });
    }
  }
  logger.info('Seed completado', { created, errors, total: all.length });
  return { ran: true, created };
}

/**
 * Construye todas las rutas del seed (sin tocar DB).
 * @param {number} userId
 */
function buildRoutes(userId) {
  const chatId = userId;
  const routes = [];

  // ── (A) COR↔MDQ roundtrip 7d, próximas 2 semanas ──
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startA = new Date(today); startA.setDate(startA.getDate() + 1);
  const endA = new Date(today);   endA.setDate(endA.getDate() + 14);
  const pairs = roundtripPairs(startA, endA, 7);
  const rtTh = getThreshold('COR', 'MDQ', 'roundtrip');

  for (const { outbound, ret } of pairs) {
    for (const [origin, destination] of [['COR', 'MDQ'], ['MDQ', 'COR']]) {
      routes.push({
        telegramUserId: userId, telegramChatId: chatId,
        name: `${origin}→${destination} (RT ${outbound}/${ret})`,
        origin, destination,
        outboundDate: outbound, returnDate: ret,
        tripType: /** @type {'roundtrip'} */ ('roundtrip'),
        currency: 'EUR',
        priceThreshold: rtTh?.steal ?? null,
      });
    }
  }

  // ── (B) EZE/COR → MAD/BCN/FCO/MXP one-way jun-jul 2026 ──
  const euroStart = new Date('2026-06-01');
  const euroEnd   = new Date('2026-07-31');
  const euroDates = sampleDates(euroStart, euroEnd, 6);  // era 10 → reducido para evitar 429
  const origins = ['EZE', 'COR'];
  const destinations = ['MAD', 'BCN', 'FCO', 'MXP'];

  for (const origin of origins) {
    for (const destination of destinations) {
      const th = getThreshold(origin, destination, 'oneway');
      if (!th) continue;
      for (const date of euroDates) {
        routes.push({
          telegramUserId: userId, telegramChatId: chatId,
          name: `${origin}→${destination} (${date}) STEAL≤€${th.steal}`,
          origin, destination,
          outboundDate: date, returnDate: null,
          tripType: /** @type {'oneway'} */ ('oneway'),
          currency: 'EUR',
          priceThreshold: th.steal,
        });
      }
    }
  }

  return routes;
}

module.exports = { seedIfEmpty, buildRoutes };
