require('dotenv').config();
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const { initDb, insertPrice, getLastPrice } = require('./database');
const { scrapeSkyscanner } = require('./skyscanner_scraper');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PRICE_THRESHOLD = parseInt(process.env.PRICE_THRESHOLD, 10) || 500;
const TELEGRAM_ENABLED = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);

const bot = TELEGRAM_ENABLED
  ? new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })
  : null;

// Rutas de vuelos a monitorear
const routes = [
  // Destinos a Córdoba
  { origin: 'MAD', destination: 'COR', name: '✈️ Madrid → Córdoba' },
  { origin: 'BCN', destination: 'COR', name: '✈️ Barcelona → Córdoba' },
  { origin: 'FCO', destination: 'COR', name: '✈️ Roma → Córdoba' },
  // Vuelos desde Córdoba a otros destinos
  { origin: 'COR', destination: 'MAD', name: '✈️ Córdoba → Madrid' },
  { origin: 'COR', destination: 'BCN', name: '✈️ Córdoba → Barcelona' },
  { origin: 'COR', destination: 'FCO', name: '✈️ Córdoba → Roma' },
];

function buildAlertMessage(route, price, flights = []) {
  const savings = PRICE_THRESHOLD - price;
  const savingsPercent = ((savings / PRICE_THRESHOLD) * 100).toFixed(1);
  
  let message = `🎉 *¡VUELOS BARATOS ENCONTRADOS!*\n\n` +
    `${route.name}\n` +
    `━━━━━━━━━━━━━━━━━\n\n` +
    `💰 *Precio mínimo:* €${price} EUR\n` +
    `🎯 *Umbral:* €${PRICE_THRESHOLD} EUR\n` +
    `💸 *Ahorras:* €${savings} (${savingsPercent}%)\n\n`;
  
  // Agregar detalles de vuelos si existen
  if (flights && flights.length > 0) {
    message += `📋 *Vuelos disponibles:*\n`;
    
    flights.slice(0, 4).forEach((flight, index) => {
      const flightSavings = PRICE_THRESHOLD - flight.price;
      const flightPercent = ((flightSavings / PRICE_THRESHOLD) * 100).toFixed(0);
      const linkUrl = flight.link && flight.link.startsWith('http') ? flight.link : `https://www.skyscanner.es/transporte/vuelos/${route.origin.toLowerCase()}/${route.destination.toLowerCase()}/`;
      message += `\n${index + 1}. ${flight.airline || 'Vuelo disponible'}\n` +
        `   💵 €${flight.price} EUR (-${flightPercent}%)\n` +
        `   [🔗 Reservar en Skyscanner](${linkUrl})\n`;
    });
  }
  
  message += `\n━━━━━━━━━━━━━━━━━\n` +
    `⚠️ _Verifica condiciones, equipaje y horarios antes de reservar._`;
  
  return message;
}

async function sendAlert(route, price, flights = []) {
  if (!TELEGRAM_ENABLED) {
    console.log(`Alerta (Telegram deshabilitado): ${route.name} - €${price}`);
    return;
  }

  try {
    const message = buildAlertMessage(route, price, flights);
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    });
    console.log(`✅ Alerta enviada: ${route.name} - €${price}`);
  } catch (error) {
    console.error(`Error enviando alerta: ${error.message}`);
  }
}

async function checkPrices() {
  console.log(`\n📍 Verificando precios a las ${new Date().toLocaleTimeString('es-ES')}...\n`);
  
  if (!await initDb()) {
    console.error('Error inicializando base de datos');
    return;
  }

  for (const route of routes) {
    try {
      const { url, minPrice, flights } = await scrapeSkyscanner(route.origin, route.destination);
      
      if (minPrice === null) {
        console.log(`❌ ${route.name}: Sin precios encontrados`);
        continue;
      }

      // Guardar en base de datos
      const date = new Date().toISOString().split('T')[0];
      await insertPrice(`${route.origin}-${route.destination}`, date, minPrice);

      // Obtener último precio para comparar
      const lastPrice = await getLastPrice(`${route.origin}-${route.destination}`, date);

      // Enviar alerta si el precio está bajo del umbral
      if (minPrice < PRICE_THRESHOLD) {
        await sendAlert(route, minPrice, flights);
      } else {
        console.log(`${route.name}: €${minPrice} (Umbral: €${PRICE_THRESHOLD})`);
      }
    } catch (error) {
      console.error(`Error procesando ${route.name}: ${error.message}`);
    }
  }

  console.log('\n✅ Verificación completada\n');
}

// Verificación inicial
console.log('🛫 Flight Price Bot iniciado');
console.log(`⏱️ Chequeos cada 15 minutos`);
console.log(`💰 Umbral: €${PRICE_THRESHOLD} EUR\n`);

checkPrices();

// Programar chequeos automáticos
cron.schedule('*/15 * * * *', () => {
  checkPrices();
});

module.exports = { checkPrices };
