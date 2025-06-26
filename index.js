require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const { insertPrice } = require('./database');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PRICE_THRESHOLD = parseInt(process.env.PRICE_THRESHOLD, 10) || 300;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Configuración de rutas y endpoints reales de LEVEL
const routes = [
  {
    name: 'EZE-MAD',
    url: 'https://www.flylevel.com/nwe/flights/api/calendar/?triptype=RT&origin=EZE&destination=MAD&outboundDate=2025-07-30&month=07&year=2025&currencyCode=USD',
    routeLabel: 'Buenos Aires → Madrid'
  },
  {
    name: 'EZE-BCN',
    url: 'https://www.flylevel.com/nwe/flights/api/calendar/?triptype=RT&origin=EZE&destination=BCN&outboundDate=2025-09-16&month=11&year=2025&currencyCode=USD',
    routeLabel: 'Buenos Aires → Barcelona'
  }
];

// Función para consultar la API de LEVEL y obtener los precios por día
async function fetchLevelDayPrices(route) {
  try {
    const response = await axios.get(route.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0)'
      }
    });
    if (
      response.data &&
      response.data.data &&
      Array.isArray(response.data.data.dayPrices)
    ) {
      return response.data.data.dayPrices.map(day => ({
        date: day.date,
        price: day.price
      }));
    } else {
      console.error(`Respuesta inesperada de la API para ${route.name}`);
      return [];
    }
  } catch (error) {
    console.error(`Error consultando la API de LEVEL para ${route.name}:`, error.message);
    return [];
  }
}

// Función para enviar alerta por Telegram
async function sendTelegramAlert(routeLabel, date, price, threshold) {
  const message = `🚨 *ALERTA DE PRECIO BAJO*\nRuta: ${routeLabel}\nFecha: ${date}\nPrecio: $${price} USD\nUmbral: $${threshold} USD\n¡Es un buen momento para reservar tu vuelo!`;
  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log(`Alerta enviada: ${routeLabel} - $${price} (${date})`);
  } catch (error) {
    console.error('Error al enviar mensaje de Telegram:', error.message);
  }
}

// Función principal de chequeo de precios
async function checkPrices() {
  for (const route of routes) {
    const dayPrices = await fetchLevelDayPrices(route);
    for (const day of dayPrices) {
      try {
        await insertPrice(route.name, day.date, day.price);
        if (day.price < PRICE_THRESHOLD) {
          await sendTelegramAlert(route.routeLabel, day.date, day.price, PRICE_THRESHOLD);
        } else {
          console.log(`Precio para ${route.routeLabel} el ${day.date}: $${day.price} (sin alerta)`);
        }
      } catch (err) {
        console.error('Error guardando o notificando:', err.message);
      }
    }
  }
}

// Programar el cronjob cada 2 minutos
cron.schedule('*/2 * * * *', () => {
  console.log('Ejecutando chequeo de precios:', new Date().toLocaleString());
  checkPrices();
});

// Ejecutar una vez al iniciar
checkPrices(); 