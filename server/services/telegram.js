/**
 * Servicio de Notificaciones por Telegram v5.1
 *
 * Envía alertas de ofertas para TODAS las rutas (solo vuelos)
 * + informe diario PDF
 */

const TelegramBot = require('node-telegram-bot-api');

let bot = null;
let isInitialized = false;

/**
 * Inicializa el bot de Telegram
 */
function initTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    console.warn('❌❌❌ TELEGRAM_BOT_TOKEN NO CONFIGURADO — Las notificaciones NO funcionarán');
    console.warn('❌❌❌ Configurar en Render Dashboard → Environment → Add Variable');
    return false;
  }

  if (!chatId) {
    console.warn('❌❌❌ TELEGRAM_CHAT_ID NO CONFIGURADO — Las notificaciones NO funcionarán');
    console.warn('❌❌❌ Configurar en Render Dashboard → Environment → Add Variable');
    return false;
  }

  try {
    bot = new TelegramBot(token, { polling: false });
    isInitialized = true;
    console.log('✅ Bot de Telegram inicializado');
    return true;
  } catch (error) {
    console.error('❌ Error inicializando Telegram:', error.message);
    return false;
  }
}

/**
 * Envía reporte de ofertas — TODAS las rutas (vuelos + transit)
 */
async function sendDealsReport(flightDeals, transitDeals) {
  const totalDeals = (flightDeals?.length || 0) + (transitDeals?.length || 0);
  if (totalDeals === 0) {
    return false;
  }

  let message = `🔥 <b>¡OFERTAS ENCONTRADAS!</b> 🔥\n`;
  message += `📅 ${new Date().toLocaleString('es-ES')}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━\n`;

  // ══════ VUELOS ══════
  if (flightDeals && flightDeals.length > 0) {
    // Agrupar vuelos por ruta
    const flightsByRoute = {};
    for (const deal of flightDeals) {
      const key = deal.routeName || `${deal.origin}→${deal.destination}`;
      if (!flightsByRoute[key]) flightsByRoute[key] = [];
      flightsByRoute[key].push(deal);
    }

    for (const [routeName, deals] of Object.entries(flightsByRoute)) {
      const threshold = deals[0].threshold || '?';
      message += `\n✈️ <b>${routeName}</b> (≤ €${threshold})\n`;
      for (const deal of deals.slice(0, 5)) {
        const emoji = deal.price <= deal.threshold * 0.6 ? '🔥🔥🔥' : (deal.price <= deal.threshold * 0.8 ? '🔥🔥' : '🔥');
        message += `${emoji} <b>€${deal.price}</b>`;
        if (deal.airline) message += ` • ${deal.airline}`;
        if (deal.departureDate && deal.departureDate !== 'Flexible') {
          message += ` • ${formatDateShort(deal.departureDate)}`;
        }
        message += `\n`;
      }
    }
  }

  // ══════ BUS/TREN ══════
  if (transitDeals && transitDeals.length > 0) {
    const transitByRoute = {};
    for (const deal of transitDeals) {
      const key = deal.routeName || `${deal.origin}→${deal.destination}`;
      if (!transitByRoute[key]) transitByRoute[key] = [];
      transitByRoute[key].push(deal);
    }

    for (const [routeName, deals] of Object.entries(transitByRoute)) {
      message += `\n🚌 <b>${routeName}</b>\n`;
      for (const deal of deals.slice(0, 5)) {
        message += `🔥 <b>€${deal.price}</b>`;
        if (deal.provider) message += ` • ${deal.provider}`;
        if (deal.transportType) message += ` (${deal.transportType})`;
        if (deal.departureDate && deal.departureDate !== 'Flexible') {
          message += ` • ${formatDateShort(deal.departureDate)}`;
        }
        if (deal.departureTime) message += ` ${deal.departureTime}`;
        message += `\n`;
      }
    }
  }

  message += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `📊 Total: <b>${totalDeals}</b> ofertas\n`;
  message += `🔗 Reservar en Google Flights`;

  return sendMessage(message);
}

/**
 * Formatea fecha corta
 */
function formatDateShort(dateStr) {
  if (!dateStr || dateStr === 'Flexible') return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${date.getDate()} ${months[date.getMonth()]}`;
  } catch {
    return dateStr;
  }
}

/**
 * Envía un mensaje genérico a TODOS los chat IDs configurados
 */
async function sendMessage(message) {
  if (!isInitialized || !bot) {
    console.log('📱 [Telegram disabled]', message.substring(0, 100) + '...');
    return false;
  }

  const chatIdEnv = process.env.TELEGRAM_CHAT_ID || '';
  const chatIds = chatIdEnv.split(',').map(id => id.trim()).filter(Boolean);

  if (chatIds.length === 0) {
    console.log('⚠️ No hay TELEGRAM_CHAT_ID configurados');
    return false;
  }

  let allOk = true;
  for (const chatId of chatIds) {
    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
      console.error(`❌ Error enviando mensaje Telegram a ${chatId}:`, error.message);
      allOk = false;
    }
  }
  return allOk;
}

/**
 * Formatea y envía alerta de oferta de vuelo
 */
async function sendDealAlert(deal) {
  const {
    origin,
    destination,
    originInfo,
    destinationInfo,
    lowestPrice,
    dealLevel,
    outboundDate,
    returnDate,
    tripType,
    priceInsights,
    bookingUrl,
  } = deal;

  // Emojis según nivel de oferta
  const levelEmoji = {
    'steal': '🔥🔥🔥 ¡GANGA INCREÍBLE!',
    'great': '🔥🔥 ¡MUY BUENA OFERTA!',
    'good': '🔥 Buena oferta',
  };

  const originCity = originInfo?.city || origin;
  const destCity = destinationInfo?.city || destination;
  const tripTypeText = tripType === 'roundtrip' ? 'Ida y vuelta' : 'Solo ida';

  // Calcular ahorro si tenemos datos de referencia
  let savingsText = '';
  if (priceInsights?.typicalPriceRange?.length >= 2) {
    const typical = priceInsights.typicalPriceRange[1];
    const savings = typical - lowestPrice;
    if (savings > 0) {
      savingsText = `\n💰 Ahorras ~€${Math.round(savings)} vs precio típico`;
    }
  }

  const message = `
${levelEmoji[dealLevel] || '✈️ Vuelo encontrado'}

<b>🛫 ${originCity} → ${destCity}</b>
<b>💵 Precio: €${lowestPrice}</b>
${savingsText}

📅 Fecha: ${outboundDate}${returnDate ? ` - ${returnDate}` : ''}
🎫 Tipo: ${tripTypeText}
📊 Nivel precio: ${priceInsights?.priceLevel || 'N/A'}

🔗 <a href="${bookingUrl || generateGoogleFlightsUrl(origin, destination, outboundDate)}">Ver en Google Flights</a>

⏰ Encontrado: ${new Date().toLocaleString('es-ES')}
`.trim();

  return sendMessage(message);
}

/**
 * Envía resumen de búsqueda
 */
async function sendSearchSummary(summary) {
  const {
    totalSearches,
    successfulSearches,
    dealsFound,
    deals,
    searchedAt,
  } = summary;

  let message = `
📊 <b>Resumen de Búsqueda</b>

🔍 Búsquedas realizadas: ${totalSearches}
✅ Exitosas: ${successfulSearches}
🔥 Ofertas encontradas: ${dealsFound}

⏰ ${new Date(searchedAt).toLocaleString('es-ES')}
`.trim();

  if (dealsFound > 0) {
    message += '\n\n<b>🎯 Mejores ofertas:</b>\n';
    
    const topDeals = deals.slice(0, 5);
    for (const deal of topDeals) {
      const emoji = deal.dealLevel === 'steal' ? '🔥🔥🔥' : (deal.dealLevel === 'great' ? '🔥🔥' : '🔥');
      message += `\n${emoji} ${deal.origin}→${deal.destination}: €${deal.lowestPrice} (${deal.outboundDate})`;
    }
  } else {
    message += '\n\nSin ofertas destacadas en esta búsqueda. Seguimos monitoreando...';
  }

  return sendMessage(message);
}

/**
 * Envía alerta de error
 */
async function sendErrorAlert(error, context = '') {
  const message = `
⚠️ <b>Error en Flight Deal Finder</b>

${context ? `📍 Contexto: ${context}\n` : ''}
❌ Error: ${error.message || error}

⏰ ${new Date().toLocaleString('es-ES')}
`.trim();

  return sendMessage(message);
}

/**
 * Envía mensaje cuando no hay ofertas
 */
async function sendNoDealsMessage(totalSearches) {
  const message = `
🔍 <b>Búsqueda Completada</b>

✅ Rutas analizadas: ${totalSearches}
❌ Sin ofertas por debajo de los umbrales

Seguimos monitoreando... 👀
⏰ ${new Date().toLocaleString('es-ES')}
`.trim();

  return sendMessage(message);
}

/**
 * Envía mensaje de inicio de monitoreo
 */
async function sendMonitoringStarted() {
  const message = `
🚀 <b>Monitor de Vuelos v8.0</b>

📋 <b>Rutas monitoreadas (TODAS con alerta):</b>
✈️ MDQ → COR: 19-24 abr <b>(≤ €140)</b>
✈️ MAD → ORD: 20-30 jun <b>(≤ €485)</b>
✈️ BCN → ORD: 20-30 jun <b>(≤ €450)</b>
✈️ EZE → MAD/BCN: 15 jun - 31 jul <b>(≤ €1100)</b>
✈️ EZE → FCO/MXP: 15 jun - 31 jul <b>(≤ €1150)</b>
✈️ COR → MAD/BCN: 15 jun - 31 jul <b>(≤ €1250)</b>
✈️ COR → FCO/MXP: 15 jun - 31 jul <b>(≤ €1300)</b>

📢 Alertas Telegram: TODAS las rutas
📄 Informe diario PDF: 21:00 ART

⏰ ${new Date().toLocaleString('es-ES')}
`.trim();

  return sendMessage(message);
}

/**
 * Genera URL de Google Flights
 */
function generateGoogleFlightsUrl(origin, destination, date) {
  return `https://www.google.com/travel/flights?q=Flights%20from%20${origin}%20to%20${destination}%20on%20${date}&curr=EUR&hl=es`;
}

/**
 * Verifica si el bot está activo
 */
function isActive() {
  return isInitialized && bot !== null;
}

/**
 * Envía mensaje de prueba
 */
async function sendTestMessage() {
  const message = `
✅ <b>Test de Conexión Exitoso</b>

El bot de Flight Deal Finder v8.0 está funcionando.

📋 <b>Alertas activas (TODAS las rutas):</b>
✈️ MDQ → COR ≤ €140 (19-24 abr)
✈️ MAD → ORD ≤ €485 (20-30 jun)
✈️ BCN → ORD ≤ €450 (20-30 jun)
✈️ EZE → MAD/BCN ≤ €1100 (15 jun - 31 jul)
✈️ EZE → FCO/MXP ≤ €1150 (15 jun - 31 jul)
✈️ COR → MAD/BCN ≤ €1250 (15 jun - 31 jul)
✈️ COR → FCO/MXP ≤ €1300 (15 jun - 31 jul)
📄 Informe diario PDF: 21:00 ART

⏰ ${new Date().toLocaleString('es-ES')}
`.trim();

  return sendMessage(message);
}

/**
 * Envía alerta de NUEVO MÍNIMO HISTÓRICO
 * Solo se envía cuando encontramos un precio menor a todos los anteriores.
 * Usa normalized_hash + historical min check para idempotencia.
 */
async function sendHistoricalLowAlert(deal) {
  const {
    origin,
    destination,
    price,
    currency = 'EUR',
    previousMin,
    pctChange,
    improvement,
    improvementPercent,
    airline,
    departureDate,
    returnDate,
    tripType,
    link,
  } = deal;

  const tripTypeText = tripType === 'roundtrip' ? 'Ida y Vuelta' : 'Solo Ida';
  const dateStr = returnDate ? `${departureDate} — ${returnDate}` : (departureDate || 'Flexible');
  const prevMinStr = previousMin ? `${previousMin} ${currency}` : 'N/A (primera vez)';
  const pctStr = pctChange || improvementPercent ? `${pctChange || improvementPercent}%` : 'N/A';

  const message = `
🔥 <b>NUEVO MÍNIMO HISTÓRICO detected!</b>

✈️ Ruta: <b>${origin} → ${destination}</b>
📅 Fechas: ${dateStr}
💵 Precio actual: <b>${Math.round(price)} ${currency}</b>
📉 Mínimo previo: ${prevMinStr} (${pctStr})
${airline ? `✈️ Aerolínea: ${airline}\n` : ''}🎫 Tipo: ${tripTypeText}
⏱️ Detectado: ${new Date().toLocaleString('es-ES')}
🔗 <a href="${link || generateGoogleFlightsUrl(origin, destination, departureDate || '2026-03-28')}">Reservar en Google Flights</a>

📌 <i>Datos extraídos por Puppeteer (uso personal). Si aparece CAPTCHA o bloqueo, no se reintentará automáticamente.</i>
`.trim();

  return sendMessage(message);
}

/**
 * Envía resumen diario (solo si hay ofertas interesantes)
 */
async function sendDailySummary(stats) {
  const {
    routesSearched,
    totalFlights,
    bestDeals,
    newLows,
  } = stats;

  if (bestDeals.length === 0 && newLows === 0) {
    // No enviar nada si no hay nada interesante
    return false;
  }

  let message = `
📊 <b>Resumen del Día</b>

🔍 Rutas analizadas: ${routesSearched}
✈️ Vuelos encontrados: ${totalFlights}
🏆 Nuevos mínimos: ${newLows}
`.trim();

  if (bestDeals.length > 0) {
    message += `\n\n<b>🔥 Mejores precios hoy:</b>`;
    for (const deal of bestDeals.slice(0, 5)) {
      message += `\n• ${deal.origin}→${deal.destination}: $${deal.price}`;
    }
  }

  message += `\n\n⏰ ${new Date().toLocaleString('es-ES')}`;

  return sendMessage(message);
}

/**
 * Envía resumen de ejecución de búsqueda (Search Run Report)
 * Se envía después de cada búsqueda programada.
 */
async function sendSearchRunReport(data) {
  const {
    runId = 'N/A',
    searchTs,
    routesChecked = 0,
    resultsCount = 0,
    blockedCount = 0,
    durationMs = 0,
    topDeals = [],
  } = data;

  let message = `🚀 <b>Monitor de Vuelos — Search Report</b>\n`;
  message += `🗓️ Fecha: ${searchTs || new Date().toLocaleString('es-ES')}\n`;
  message += `🔎 Rutas chequeadas: ${routesChecked}\n`;
  message += `✅ Resultados encontrados: ${resultsCount}\n`;
  message += `⚠️ Bloqueos/Captchas: ${blockedCount}\n`;
  message += `⏱️ Duración total: ${durationMs} ms\n`;
  message += `ID Run: <code>${runId}</code>`;

  if (topDeals.length > 0) {
    message += `\n\n<b>🔥 Mejores precios:</b>`;
    for (const deal of topDeals.slice(0, 5)) {
      message += `\n• ${deal.origin}→${deal.destination}: $${deal.price}`;
      if (deal.airline) message += ` (${deal.airline})`;
    }
  }

  return sendMessage(message);
}

/**
 * Envía alerta de bloqueo/CAPTCHA.
 * Se para la búsqueda para esa ruta y se notifica al operador.
 */
async function sendBlockedAlert(data) {
  const {
    origin = '???',
    destination = '???',
    searchTs,
    diagnostics = 'Desconocido',
    pauseHours = 24,
  } = data;

  const message = `⛔️ <b>SEARCH BLOCKED / CAPTCHA</b>\n\n` +
    `✈️ Ruta: ${origin} → ${destination}\n` +
    `🕐 Hora: ${searchTs || new Date().toLocaleString('es-ES')}\n` +
    `🔍 Diagnóstico: ${diagnostics}\n\n` +
    `⚠️ <b>Acción:</b> Pausando búsquedas para esta ruta por ${pauseHours} horas. Revisa manualmente.`;

  return sendMessage(message);
}

/**
 * Construye el mensaje "Casi Oferta" para combinados IDA+VUELTA (separado para testeo).
 * @param {Array} nearCombinedDeals - Pares con suma $850-$1100
 * @param {Object} searchSummary - Resumen de todas las búsquedas realizadas
 */
function buildNearDealMessage(nearCombinedDeals, searchSummary = null, nearRoundTripDeals = []) {
  const total = (nearCombinedDeals?.length || 0) + (nearRoundTripDeals?.length || 0);
  if (total === 0) return null;

  let message = `🟡 <b>CASI OFERTA</b>\n`;
  message += `📅 ${new Date().toLocaleString('es-ES')}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━\n`;

  // Near-deals roundtrip
  if (nearRoundTripDeals && nearRoundTripDeals.length > 0) {
    message += `\n🎫 <b>Casi oferta (ida y vuelta):</b>\n`;
    for (const deal of nearRoundTripDeals.slice(0, 5)) {
      message += `🟡 <b>$${deal.price}</b> ${deal.routeName}`;
      if (deal.airline) message += ` • ${deal.airline}`;
      if (deal.departureDate) message += ` • ${formatDateShort(deal.departureDate)}`;
      message += `\n`;
    }
  }

  // Near-deals one-way
  if (nearCombinedDeals && nearCombinedDeals.length > 0) {
    message += `\n✈️ <b>Casi oferta (solo ida):</b>\n`;
    for (const deal of nearCombinedDeals.slice(0, 7)) {
      message += `🟡 <b>$${deal.price}</b> ${deal.routeName}`;
      if (deal.airline) message += ` • ${deal.airline}`;
      if (deal.departureDate) message += ` • ${formatDateShort(deal.departureDate)}`;
      message += `\n`;
    }
  }

  message += `━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💡 <i>Precios cercanos al umbral de oferta</i>\n`;
  message += `🔗 Revisar en Google Flights`;

  // Resumen de búsquedas realizadas
  if (searchSummary) {
    message += `\n\n📋 <b>Búsquedas realizadas:</b>\n`;
    if (searchSummary.ezeSearched) {
      const ok = searchSummary.ezeSuccess || 0;
      const fail = searchSummary.ezeTotal - ok;
      message += `✈️ Ethiopian EZE→FCO RT: ${ok}/${searchSummary.ezeTotal} OK`;
      if (fail > 0) message += ` (${fail} sin resultado)`;
      message += `\n`;
    }
    if (searchSummary.eurSearched) {
      const ok = searchSummary.eurSuccess || 0;
      const fail = searchSummary.eurTotal - ok;
      message += `✈️ Europa interna: ${ok}/${searchSummary.eurTotal} OK`;
      if (fail > 0) message += ` (${fail} sin resultado)`;
      message += `\n`;
    }
    if (searchSummary.sclSearched) {
      const ok = searchSummary.sclSuccess || 0;
      const fail = searchSummary.sclTotal - ok;
      message += `✈️ SCL → Sídney: ${ok}/${searchSummary.sclTotal} OK`;
      if (fail > 0) message += ` (${fail} sin resultado)`;
      message += `\n`;
    }
  }

  return message;
}

/**
 * Envía alerta "Casi Oferta" para ida+vuelta Argentina→Europa entre $800-$1050.
 * Es un mensaje aparte, separado del reporte principal de ofertas.
 * @param {Array} nearDeals
 * @param {Object} searchSummary - Resumen de todas las búsquedas
 */
async function sendNearDealAlert(nearCombinedDeals, searchSummary = null, nearRoundTripDeals = []) {
  const message = buildNearDealMessage(nearCombinedDeals, searchSummary, nearRoundTripDeals);
  if (!message) return false;
  return sendMessage(message);
}

module.exports = {
  initTelegram,
  sendMessage,
  sendDealAlert,
  sendSearchSummary,
  sendDealsReport,
  sendNearDealAlert,
  sendNoDealsMessage,
  sendErrorAlert,
  sendMonitoringStarted,
  sendTestMessage,
  sendHistoricalLowAlert,
  sendDailySummary,
  sendSearchRunReport,
  sendBlockedAlert,
  isActive,
};
