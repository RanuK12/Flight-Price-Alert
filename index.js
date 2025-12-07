require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const { insertPrice } = require('./database');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GLOBAL_THRESHOLD = parseInt(process.env.PRICE_THRESHOLD, 10) || 300;
const TELEGRAM_ENABLED = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);

const bot = TELEGRAM_ENABLED
  ? new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })
  : null;

function parseRoutes() {
  if (process.env.LEVEL_ROUTES_JSON) {
    try {
      const parsed = JSON.parse(process.env.LEVEL_ROUTES_JSON);
      if (Array.isArray(parsed)) {
        return parsed.map(route => ({
          origin: route.origin,
          destination: route.destination,
          outboundDate: route.outboundDate,
          label: route.label || `${route.origin} → ${route.destination}`,
          threshold: route.threshold || GLOBAL_THRESHOLD
        }));
      }
      console.warn('LEVEL_ROUTES_JSON must be an array of routes. Using defaults.');
    } catch (err) {
      console.warn('Invalid LEVEL_ROUTES_JSON. Using defaults.', err.message);
    }
  }

  return [
    {
      origin: 'EZE',
      destination: 'MAD',
      outboundDate: '2025-07-30',
      label: 'Buenos Aires → Madrid',
      threshold: GLOBAL_THRESHOLD
    },
    {
      origin: 'EZE',
      destination: 'BCN',
      outboundDate: '2025-09-16',
      label: 'Buenos Aires → Barcelona',
      threshold: GLOBAL_THRESHOLD
    }
  ];
}

const routes = parseRoutes();
const BASE_URL = 'https://www.flylevel.com/nwe/flights/api/calendar/';

function buildLevelUrl(route) {
  const outboundDate = route.outboundDate;
  const parsedDate = new Date(outboundDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`Fecha de salida inválida para ${route.label || route.origin}`);
  }
  const month = `${parsedDate.getUTCMonth() + 1}`.padStart(2, '0');
  const year = parsedDate.getUTCFullYear();

  const params = new URLSearchParams({
    triptype: route.triptype || 'RT',
    origin: route.origin,
    destination: route.destination,
    outboundDate,
    month,
    year,
    currencyCode: route.currencyCode || 'USD'
  });

  return `${BASE_URL}?${params.toString()}`;
}

async function fetchLevelDayPrices(route) {
  const url = buildLevelUrl(route);
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FlightAlertsBot/1.0)'
      }
    });

    const dayPrices = response?.data?.data?.dayPrices;
    if (!Array.isArray(dayPrices)) {
      console.error(`Respuesta inesperada de la API para ${route.label}`);
      return [];
    }

    return dayPrices
      .filter(day => day?.date && typeof day.price === 'number')
      .map(day => ({
        date: day.date,
        price: day.price
      }));
  } catch (error) {
    console.error(`Error consultando la API de LEVEL para ${route.label}:`, error.message);
    return [];
  }
}

async function sendTelegramAlert(routeLabel, bestDay, threshold) {
  if (!TELEGRAM_ENABLED) {
    console.log('Telegram deshabilitado. Alerta omitida.');
    return;
  }

  const message = `🚨 *ALERTA DE PRECIO BAJO*\nRuta: ${routeLabel}\nFecha más barata: ${bestDay.date}\nPrecio: $${bestDay.price} USD\nUmbral: $${threshold} USD\n¡Es un buen momento para reservar tu vuelo!`;
  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log(`Alerta enviada: ${routeLabel} - $${bestDay.price} (${bestDay.date})`);
  } catch (error) {
    console.error('Error al enviar mensaje de Telegram:', error.message);
  }
}

async function persistPrices(routeName, dayPrices) {
  for (const day of dayPrices) {
    try {
      await insertPrice(routeName, day.date, day.price);
    } catch (err) {
      console.error(`Error guardando precio para ${routeName} ${day.date}:`, err.message);
    }
  }
}

function getCheapestDay(dayPrices) {
  return dayPrices.reduce((best, day) => {
    if (!best || day.price < best.price) return day;
    return best;
  }, null);
}

async function checkRoute(route) {
  const dayPrices = await fetchLevelDayPrices(route);
  if (!dayPrices.length) {
    console.warn(`Sin precios disponibles para ${route.label}.`);
    return;
  }

  await persistPrices(`${route.origin}-${route.destination}`, dayPrices);
  const cheapest = getCheapestDay(dayPrices);

  if (cheapest && cheapest.price < route.threshold) {
    await sendTelegramAlert(route.label, cheapest, route.threshold);
  } else if (cheapest) {
    console.log(
      `Precio más bajo para ${route.label} el ${cheapest.date}: $${cheapest.price} (umbral $${route.threshold})`
    );
  }
}

async function checkPrices() {
  for (const route of routes) {
    try {
      await checkRoute(route);
    } catch (err) {
      console.error('Error en chequeo de ruta:', err.message);
    }
  }
}

cron.schedule('*/5 * * * *', () => {
  console.log('Ejecutando chequeo de precios:', new Date().toLocaleString());
  checkPrices();
});

checkPrices();
