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
  { origin: 'MAD', destination: 'COR', name: 'Madrid → Córdoba' },
  { origin: 'BCN', destination: 'COR', name: 'Barcelona → Córdoba' },
  { origin: 'FCO', destination: 'COR', name: 'Roma → Córdoba' },
];

function buildAlertMessage(route, price) {
  const savings = PRICE_THRESHOLD - price;
  const savingsPercent = ((savings / PRICE_THRESHOLD) * 100).toFixed(1);
  
  return `✈️ *ALERTA DE VUELO BARATO*\n\n` +
    `*Ruta:* ${route.name}\n` +
    `*Precio:* €${price} EUR\n` +
    `*Umbral:* €${PRICE_THRESHOLD} EUR\n` +
    `*Ahorro:* €${savings} (${savingsPercent}%)\n\n` +
    `🔗 Ver en Skyscanner\n\n` +
    `⚠️ Verifica condiciones y equipaje antes de comprar.`;
}

async function sendAlert(route, price) {
  if (!TELEGRAM_ENABLED) {
    console.log(`Alerta (Telegram deshabilitado): ${route.name} - €${price}`);
    return;
  }

  try {
    const message = buildAlertMessage(route, price);
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
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
        await sendAlert(route, minPrice);
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
