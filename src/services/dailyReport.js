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
const sanity = require('./sanityCheck');
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

/** Fecha corta "17/09" para las líneas de la tabla de precios. */
function shortDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Arma la sección "Mejores precios de hoy": las rutas activas con el precio
 * más bajo visto en la última consulta del alertEngine, con la distancia al
 * umbral configurado.
 *
 * Es independiente de las notificaciones enviadas a propósito: si el mercado
 * nunca baja del umbral no llega ninguna alerta, y sin esta sección Emilio
 * no tendría forma de saber si el bot está mirando o si el precio simplemente
 * no bajó.
 *
 * @param {number} userId
 * @returns {Promise<string|null>} HTML listo para Telegram, o null si no hay datos
 */
async function buildBestPricesSection(userId) {
  const routes = await routesRepo.listCheapestChecked(userId, 10);
  if (!routes.length) return null;

  const lines = routes.map((r) => {
    const sep = r.returnDate ? '↔' : '→';
    // En una ruta VENTANA, outboundDate es el arranque del rango (14/09) y casi
    // nunca es el día del precio: el barrido dejó las fechas buenas en
    // bestOutboundDate. Mostrar el arranque decía "€868 el 14/09-01/11" cuando
    // esos €868 son del 14/09→07/11, o sea la fecha de vuelta equivocada.
    const ida = r.bestOutboundDate || r.outboundDate;
    const vuelta = r.bestReturnDate || r.returnDate;
    const dates = r.returnDate
      ? `${shortDate(ida)}-${shortDate(vuelta)}`
      : shortDate(ida);
    const price = fmt.price(r.lastPriceEur, 'EUR');
    const gap = r.priceThreshold ? r.lastPriceEur - r.priceThreshold : null;
    const gapTxt = gap === null
      ? ''
      : gap <= 0
        ? ' ✅'
        : ` <i>(+${fmt.price(Math.round(gap), 'EUR')} sobre tu umbral)</i>`;
    return `· <b>${r.origin}${sep}${r.destination}</b> ${dates} — ${price}${gapTxt}`;
  });

  const checkedAt = routes
    .map((r) => (r.lastCheckedAt ? new Date(r.lastCheckedAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);

  return `📉 <b>Mejores precios encontrados</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${lines.join('\n')}\n\n` +
    `<i>Precio más bajo visto en la última revisión de cada ruta` +
    (checkedAt ? `, la más reciente ${fmt.date(new Date(checkedAt).toISOString())}` : '') +
    `. No son alertas: son el estado del mercado.</i>`;
}

/**
 * Arma la tabla ida x vuelta del par de aeropuertos más barato.
 *
 * La lista de "mejores precios" contesta *cuánto* sale; la tabla contesta
 * *qué combinación de fechas* conviene, que es la decisión real. Los datos
 * salen del barrido por grilla (services/gridSweep), que ya dejó el precio
 * de cada combinación en su ruta.
 *
 * @param {number} userId
 * @returns {Promise<string|null>}
 */
async function buildGridSection(userId) {
  const routes = await routesRepo.listCheapestChecked(userId, 400);
  const roundtrips = routes.filter(r => r.tripType === 'roundtrip' && r.returnDate);
  if (roundtrips.length < 2) return null;

  // Con rutas VENTANA hay una sola ruta por par de aeropuertos, con el mínimo
  // de todo el rango y las fechas que lo producen. La pregunta útil pasa a ser
  // "desde qué aeropuerto conviene salir", no "qué combinación dentro de uno".
  const windows = roundtrips.filter(r => r.outboundDateEnd && r.bestOutboundDate);
  if (windows.length >= 2) return buildPairRanking(windows);

  // Config vieja (una ruta por combinación): tabla ida x vuelta del par más barato.
  const cheapest = roundtrips[0];
  const pair = `${cheapest.origin}-${cheapest.destination}`;
  const cells = roundtrips
    .filter(r => `${r.origin}-${r.destination}` === pair)
    .map(r => ({
      departureDate: isoDay(r.outboundDate),
      returnDate: isoDay(r.returnDate),
      price: Math.round(r.lastPriceEur),
    }))
    .filter(c => c.departureDate && c.returnDate);

  if (cells.length < 4) return null;

  return fmt.priceGrid(cells, {
    title: `📊 ${cheapest.origin} ↔ ${cheapest.destination} — el par más barato`,
    threshold: cheapest.priceThreshold || null,
  });
}

/**
 * Ranking de pares de aeropuertos por su mejor precio, con las fechas concretas
 * que lo consiguen. Es la decisión real cuando el origen es flexible.
 *
 * @param {any[]} windows - rutas ventana con bestOutboundDate ya calculado
 * @returns {string}
 */
function buildPairRanking(windows) {
  const orden = [...windows].sort((a, b) => a.lastPriceEur - b.lastPriceEur);
  const mejor = orden[0];
  const threshold = mejor.priceThreshold || null;

  const lines = orden.map((r, i) => {
    const marca = i === 0 ? '🥇' : '  ';
    const ruta = `${r.origin}↔${r.destination}`.padEnd(9);
    const precio = fmt.price(r.lastPriceEur, 'EUR').padStart(8);
    const fechas = `${shortDate(r.bestOutboundDate)}→${shortDate(r.bestReturnDate)}`;
    const cumple = threshold && r.lastPriceEur <= threshold ? ' ✅' : '';
    return `${marca} <b>${ruta}</b> ${precio}  ${fechas}${cumple}`;
  });

  const gap = threshold ? mejor.lastPriceEur - threshold : null;
  const footer = gap === null
    ? ''
    : gap <= 0
      ? `\n\n🎯 <b>Cumple tu umbral de ${fmt.price(threshold, 'EUR')}</b> ✅`
      : `\n\n🎯 Tu umbral: ${fmt.price(threshold, 'EUR')} · faltan <b>${fmt.price(Math.round(gap), 'EUR')}</b>`;

  return `📊 <b>Ida y vuelta por aeropuerto</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${lines.join('\n')}${footer}\n\n` +
    `<i>Mejor combinación de fechas dentro de tu ventana, por aeropuerto de salida.</i>`;
}

/** Date → "YYYY-MM-DD" en UTC. */
function isoDay(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

/**
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} userId
 * @param {number} chatId
 */
async function sendSummaryForUser(bot, userId, chatId) {
  const [routes, stats, latestRaw, budget] = await Promise.all([
    routesRepo.listByUser(userId),
    notificationsRepo.statsLast24h(userId),
    notificationsRepo.listLatestForUser(userId, 10),
    hybrid.checkAmadeusBudget(),
  ]);

  // ─── SANITY FILTER (anti-fosil) ────────────────────────────────
  // El historico de Mongo puede contener notifs envenenadas de versiones
  // previas del parser (caso US$155 EZE→MAD del bug seg[11]→price).
  // Filtramos antes de pintar para no resucitar precios falsos en el
  // informe diario. skipHistorical=true: no auto-validamos contra el
  // mismo conjunto que estamos limpiando (evita self-poisoning del p25).
  const filtered = [];
  let droppedByFilter = 0;
  for (const n of latestRaw) {
    // Si la notif fue marcada como verificationRequired, ya no se debe mostrar.
    if (n.verificationRequired) { droppedByFilter++; continue; }
    const verdict = await sanity.check({
      origin: n.origin,
      destination: n.destination,
      price: n.price,
      currency: n.currency,
      tripType: n.returnDate ? 'roundtrip' : 'oneway',
    }, { skipHistorical: true }).catch(() => ({ ok: true }));
    if (verdict.ok) {
      filtered.push(n);
    } else {
      droppedByFilter++;
      logger.warn('DailyReport: drop fosil', {
        route: `${n.origin}-${n.destination}`,
        price: n.price, currency: n.currency,
        reason: verdict.reason,
      });
    }
  }
  const latest = filtered.slice(0, 5);
  if (droppedByFilter > 0) {
    logger.info('DailyReport: filtered out poisoned notifs', { droppedByFilter });
  }

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

  // Mejores precios REALES vistos en las últimas búsquedas, crucen o no el
  // umbral. Lee de las rutas (lastPriceEur), no de las notificaciones
  // enviadas: si ninguna oferta llegó al umbral, esto igual muestra dónde
  // está el mercado y cuánto falta.
  const bestPrices = await buildBestPricesSection(userId).catch((err) => {
    logger.warn('Sección mejores precios falló (continuando)', { err: err.message });
    return null;
  });
  if (bestPrices) {
    await bot.sendMessage(chatId, bestPrices, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  // Tabla ida x vuelta del par más barato: dice qué combinación de fechas
  // conviene, no sólo cuánto sale.
  const grid = await buildGridSection(userId).catch((err) => {
    logger.warn('Tabla de precios falló (continuando)', { err: err.message });
    return null;
  });
  if (grid) {
    await bot.sendMessage(chatId, grid, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  if (latest.length === 0) {
    await bot.sendMessage(chatId,
      'ℹ️ Hoy ninguna búsqueda bajó de tu umbral. Arriba tenés los precios ' +
      'reales que sí encontró el bot.\n' +
      'Si querés que avise antes, bajá el nivel desde ' +
      '<b>⚙️ Configuración → 🚨 Nivel de alertas</b>.',
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
    // Schema Mongo usa camelCase. Convertir Date → ISO YYYY-MM-DD.
    const toIso = (v) => {
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(v);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    };
    const depDate = toIso(n.departureDate);
    const retDate = toIso(n.returnDate);
    const fakeFlight = /** @type {import('../providers/base').Flight} */ ({
      source: n.provider || 'unknown',
      origin: n.origin, destination: n.destination,
      price: n.price, currency: n.currency,
      tripType: retDate ? 'roundtrip' : 'oneway',
      departureDate: depDate, returnDate: retDate,
      airline: n.airline || 'Unknown',
      carrierCodes: [], stops: n.stops ?? 0,
      bookingUrl: n.bookingUrl || undefined,
    });
    const badge = ({ steal: '🚨', great: '🔥', good: '✅' }[n.dealLevel]) || '✈️';
    const card = fmt.flightCard(fakeFlight, { level: n.dealLevel, badge });
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

// Las dos secciones se exportan porque además del informe diario tienen
// botón propio en el menú (bot/handlers/precios): son las respuestas a
// "¿cuánto sale?" y "¿desde dónde conviene salir?", y esperar a las 21:00
// para verlas no tenía sentido.
module.exports = { runDaily, buildBestPricesSection, buildGridSection };
