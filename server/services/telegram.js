/**
 * Servicio de Notificaciones por Telegram v2.0
 * 
 * Envía alertas de ofertas separadas por SOLO IDA e IDA Y VUELTA
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
    console.warn('⚠️ TELEGRAM_BOT_TOKEN no configurado. Notificaciones desactivadas.');
    return false;
  }

  if (!chatId) {
    console.warn('⚠️ TELEGRAM_CHAT_ID no configurado. Notificaciones desactivadas.');
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
 * Envía reporte de ofertas con secciones separadas IDA e IDA+VUELTA
 */
async function sendDealsReport(oneWayDeals, roundTripDeals) {
  const totalDeals = oneWayDeals.length + roundTripDeals.length;
  
  if (totalDeals === 0) {
    return false;
  }

  let message = `🔥 <b>¡OFERTAS ENCONTRADAS!</b> 🔥\n`;
  message += `📅 ${new Date().toLocaleString('es-ES')}\n`;
  message += `📆 Fechas: 25 mar - 15 abr 2026\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // SECCIÓN: SOLO IDA
  if (oneWayDeals.length > 0) {
    message += `✈️ <b>SOLO IDA</b> (${oneWayDeals.length} ofertas)\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n`;
    
    // Separar por región
    const europeDeals = oneWayDeals.filter(d => d.region === 'europe');
    const usaDeals = oneWayDeals.filter(d => d.region === 'usa');
    
    // Europa → Argentina (máx €350)
    if (europeDeals.length > 0) {
      message += `\n🇪🇺 <b>Europa → Argentina</b> (máx €350)\n`;
      for (const deal of europeDeals.slice(0, 8)) {
        const emoji = deal.price <= 250 ? '🔥🔥🔥' : (deal.price <= 300 ? '🔥🔥' : '🔥');
        message += `${emoji} <b>€${deal.price}</b> ${deal.routeName}`;
        if (deal.airline) message += ` • ${deal.airline}`;
        if (deal.departureDate && deal.departureDate !== 'Flexible') {
          message += ` • ${formatDateShort(deal.departureDate)}`;
        }
        message += `\n`;
      }
      if (europeDeals.length > 8) {
        message += `   <i>+${europeDeals.length - 8} ofertas más...</i>\n`;
      }
    }
    
    // USA → Argentina (máx €200)
    if (usaDeals.length > 0) {
      message += `\n🇺🇸 <b>USA → Argentina</b> (máx €200)\n`;
      for (const deal of usaDeals.slice(0, 8)) {
        const emoji = deal.price <= 150 ? '🔥🔥🔥' : (deal.price <= 180 ? '🔥🔥' : '🔥');
        message += `${emoji} <b>€${deal.price}</b> ${deal.routeName}`;
        if (deal.airline) message += ` • ${deal.airline}`;
        if (deal.departureDate && deal.departureDate !== 'Flexible') {
          message += ` • ${formatDateShort(deal.departureDate)}`;
        }
        message += `\n`;
      }
      if (usaDeals.length > 8) {
        message += `   <i>+${usaDeals.length - 8} ofertas más...</i>\n`;
      }
    }
  }

  // SECCIÓN: IDA Y VUELTA (Argentina → Europa)
  if (roundTripDeals.length > 0) {
    message += `\n\n🔄 <b>IDA Y VUELTA</b> (${roundTripDeals.length} ofertas)\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🇦🇷 <b>Argentina → Europa</b> (≤ €600 oferta | €650-€800 aviso)\n\n`;
    
    // Separar por origen (Ezeiza vs Córdoba)
    const ezeDeals = roundTripDeals.filter(d => d.origin === 'EZE');
    const corDeals = roundTripDeals.filter(d => d.origin === 'COR');
    
    if (ezeDeals.length > 0) {
      message += `<b>Desde Buenos Aires (EZE):</b>\n`;
      for (const deal of ezeDeals.slice(0, 5)) {
        const emoji = deal.price <= 450 ? '🔥🔥🔥' : (deal.price <= 550 ? '🔥🔥' : '🔥');
        message += `${emoji} <b>€${deal.price}</b> ${deal.routeName}`;
        if (deal.airline) message += ` • ${deal.airline}`;
        if (deal.departureDate) message += ` • ${formatDateShort(deal.departureDate)}`;
        message += `\n`;
      }
    }
    
    if (corDeals.length > 0) {
      message += `\n<b>Desde Córdoba (COR):</b>\n`;
      for (const deal of corDeals.slice(0, 5)) {
        const emoji = deal.price <= 500 ? '🔥🔥🔥' : (deal.price <= 600 ? '🔥🔥' : '🔥');
        message += `${emoji} <b>€${deal.price}</b> ${deal.routeName}`;
        if (deal.airline) message += ` • ${deal.airline}`;
        if (deal.departureDate) message += ` • ${formatDateShort(deal.departureDate)}`;
        message += `\n`;
      }
    }
  }

  // Footer
  message += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `📊 Total: <b>${totalDeals}</b> ofertas encontradas\n`;
  message += `🔗 Reserva en Google Flights o Kayak`;

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
❌ Sin ofertas que cumplan los umbrales:

• Solo ida Europa→Argentina: ≤ €350
• Solo ida USA→Argentina: ≤ €200
• Ida y vuelta: ≤ €600 (aviso €650-€800)

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
🚀 <b>Monitor de Vuelos v3.0</b>

📆 <b>Fechas de búsqueda:</b>
25 marzo - 15 abril 2026

📋 <b>Umbrales de ofertas:</b>
✈️ Solo ida Europa→Argentina: máx €350
✈️ Solo ida USA→Argentina: máx €200
🔄 Ida y vuelta Argentina→Europa: ≤ €600
🟡 Casi oferta I+V: €650-€800 (aviso aparte)

📍 <b>Rutas SOLO IDA:</b>
🇪🇺 Madrid, Barcelona, Roma, París, Frankfurt, Amsterdam, Lisboa, Londres
🇺🇸 Miami, Nueva York, Orlando

📍 <b>Rutas IDA Y VUELTA:</b>
🇦🇷 Buenos Aires (EZE) → Madrid, Barcelona, Roma, París, Lisboa
🇦🇷 Córdoba (COR) → Madrid, Barcelona, Roma

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

El bot de Flight Deal Finder está funcionando correctamente.

📋 <b>Umbrales configurados:</b>
• Solo ida Europa→Argentina: €350
• Solo ida USA→Argentina: €200 / €250  
• Ida y vuelta Argentina→Europa: ≤ €600 (aviso €650-€800)

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
💶 Precio actual: <b>${Math.round(price)} ${currency}</b>
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
      message += `\n• ${deal.origin}→${deal.destination}: €${deal.price}`;
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
      message += `\n• ${deal.origin}→${deal.destination}: €${deal.price}`;
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
 * Envía alerta "Casi Oferta" para ida+vuelta Argentina→Europa entre €650-€800.
 * Es un mensaje aparte, separado del reporte principal de ofertas.
 */
async function sendNearDealAlert(nearDeals) {
  if (!nearDeals || nearDeals.length === 0) return false;

  let message = `🟡 <b>CASI OFERTA — Ida y Vuelta</b>\n`;
  message += `📅 ${new Date().toLocaleString('es-ES')}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `🇦🇷 <b>Argentina → Europa (€650-€800)</b>\n`;
  message += `<i>No llega al umbral de oferta (≤€600) pero está cerca:</i>\n\n`;

  const ezeDeals = nearDeals.filter(d => d.origin === 'EZE');
  const corDeals = nearDeals.filter(d => d.origin === 'COR');

  if (ezeDeals.length > 0) {
    message += `<b>Desde Buenos Aires (EZE):</b>\n`;
    for (const deal of ezeDeals.slice(0, 5)) {
      message += `🟡 <b>€${deal.price}</b> → ${deal.destination}`;
      if (deal.airline) message += ` • ${deal.airline}`;
      if (deal.departureDate) message += ` • ${formatDateShort(deal.departureDate)}`;
      if (deal.returnDate) message += ` ↔ ${formatDateShort(deal.returnDate)}`;
      message += `\n`;
    }
  }

  if (corDeals.length > 0) {
    if (ezeDeals.length > 0) message += `\n`;
    message += `<b>Desde Córdoba (COR):</b>\n`;
    for (const deal of corDeals.slice(0, 5)) {
      message += `🟡 <b>€${deal.price}</b> → ${deal.destination}`;
      if (deal.airline) message += ` • ${deal.airline}`;
      if (deal.departureDate) message += ` • ${formatDateShort(deal.departureDate)}`;
      if (deal.returnDate) message += ` ↔ ${formatDateShort(deal.returnDate)}`;
      message += `\n`;
    }
  }

  message += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💡 <i>Si baja a ≤€600 se convertirá en oferta confirmada</i>\n`;
  message += `🔗 Verificar en Google Flights`;

  return sendMessage(message);
}

module.exports = {
  initTelegram,
  sendMessage,
  sendDealAlert,
  sendSearchSummary,
  sendDealsReport,
  sendNoDealsMessage,
  sendErrorAlert,
  sendMonitoringStarted,
  sendTestMessage,
  sendHistoricalLowAlert,
  sendDailySummary,
  sendSearchRunReport,
  sendBlockedAlert,
  sendNearDealAlert,
  isActive,
};
