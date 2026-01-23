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
          message += ` • ${deal.departureDate}`;
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
          message += ` • ${deal.departureDate}`;
        }
        message += `\n`;
      }
      if (usaDeals.length > 8) {
        message += `   <i>+${usaDeals.length - 8} ofertas más...</i>\n`;
      }
    }
  }

  // SECCIÓN: IDA Y VUELTA
  if (roundTripDeals.length > 0) {
    message += `\n\n🔄 <b>IDA Y VUELTA</b> (${roundTripDeals.length} ofertas)\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `<i>Máximo €650 para ser oferta</i>\n\n`;
    
    for (const deal of roundTripDeals.slice(0, 10)) {
      const emoji = deal.price <= 450 ? '🔥🔥🔥' : (deal.price <= 550 ? '🔥🔥' : '🔥');
      message += `${emoji} <b>€${deal.price}</b> ${deal.routeName}`;
      if (deal.airline) message += ` • ${deal.airline}`;
      if (deal.departureDate && deal.departureDate !== 'Flexible') {
        message += ` • ${deal.departureDate}`;
      }
      message += `\n`;
    }
    if (roundTripDeals.length > 10) {
      message += `   <i>+${roundTripDeals.length - 10} ofertas más...</i>\n`;
    }
  }

  // Footer
  message += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `📊 Total: <b>${totalDeals}</b> ofertas encontradas\n`;
  message += `🔗 Reserva en Google Flights o Skyscanner`;

  return sendMessage(message);
}

/**
 * Envía un mensaje genérico
 */
async function sendMessage(message) {
  if (!isInitialized || !bot) {
    console.log('📱 [Telegram disabled]', message.substring(0, 100) + '...');
    return false;
  }

  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    return true;
  } catch (error) {
    console.error('❌ Error enviando mensaje Telegram:', error.message);
    return false;
  }
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
 * Envía mensaje de inicio de monitoreo
 */
async function sendMonitoringStarted() {
  const message = `
🚀 <b>Monitor de Vuelos Iniciado v2.0</b>

📋 <b>Umbrales de ofertas:</b>
✈️ Solo ida Europa→Argentina: máx €350
✈️ Solo ida USA→Argentina: máx €200
🔄 Ida y vuelta: máx €650

📍 <b>Rutas monitoreadas:</b>
🇪🇺 Madrid, Barcelona, Roma, París, Frankfurt, Amsterdam, Lisboa, Londres
🇺🇸 Miami, Nueva York, Orlando

Recibirás alertas separadas para:
• Ofertas de SOLO IDA
• Ofertas de IDA Y VUELTA

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
• Solo ida USA→Argentina: €200  
• Ida y vuelta: €650

⏰ ${new Date().toLocaleString('es-ES')}
`.trim();

  return sendMessage(message);
}

module.exports = {
  initTelegram,
  sendMessage,
  sendDealAlert,
  sendSearchSummary,
  sendDealsReport,
  sendErrorAlert,
  sendMonitoringStarted,
  sendTestMessage,
  isActive,
};
