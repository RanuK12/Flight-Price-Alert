/**
 * 🛫 FLIGHT DEAL BOT v3.0
 * 
 * - Scraping directo de Google Flights
 * - Búsquedas de IDA y de IDA+VUELTA separadas
 * - Precios reales
 * - Listado organizado por Telegram
 * 
 * Uso: node bot.js
 */

require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');

puppeteer.use(StealthPlugin());

// ============================================
// CONFIGURACIÓN
// ============================================

const CONFIG = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  schedule: process.env.SCHEDULE || '*/30 * * * *',
  headless: 'new'
};

// ============================================
// RUTAS A MONITOREAR (precios máximos para considerar oferta)
// ============================================

const ROUTES = [
  // EUROPA → ARGENTINA (Buenos Aires)
  { origin: 'Madrid', dest: 'Buenos Aires', goodOneWay: 500, goodRoundTrip: 700 },
  { origin: 'Barcelona', dest: 'Buenos Aires', goodOneWay: 520, goodRoundTrip: 750 },
  { origin: 'Roma', dest: 'Buenos Aires', goodOneWay: 550, goodRoundTrip: 800 },
  { origin: 'Paris', dest: 'Buenos Aires', goodOneWay: 520, goodRoundTrip: 750 },
  { origin: 'Lisboa', dest: 'Buenos Aires', goodOneWay: 500, goodRoundTrip: 700 },
  
  // EUROPA → ARGENTINA (Córdoba)
  { origin: 'Madrid', dest: 'Cordoba Argentina', goodOneWay: 550, goodRoundTrip: 800 },
  { origin: 'Barcelona', dest: 'Cordoba Argentina', goodOneWay: 580, goodRoundTrip: 850 },
  
  // EUROPA → USA
  { origin: 'Madrid', dest: 'Nueva York', goodOneWay: 300, goodRoundTrip: 450 },
  { origin: 'Madrid', dest: 'Miami', goodOneWay: 320, goodRoundTrip: 480 },
  { origin: 'Barcelona', dest: 'Nueva York', goodOneWay: 320, goodRoundTrip: 480 },
  { origin: 'Londres', dest: 'Nueva York', goodOneWay: 280, goodRoundTrip: 400 },
];

// ============================================
// TELEGRAM
// ============================================

let bot = null;

function initTelegram() {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) {
    console.log('❌ ERROR: Configura TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en .env');
    process.exit(1);
  }
  bot = new TelegramBot(CONFIG.telegramToken, { polling: false });
  console.log('✅ Telegram configurado');
}

async function sendTelegram(message) {
  if (!bot) return;
  try {
    await bot.sendMessage(CONFIG.telegramChatId, message, { 
      parse_mode: 'HTML',
      disable_web_page_preview: true 
    });
  } catch (error) {
    console.error('Error Telegram:', error.message);
  }
}

// ============================================
// SCRAPING GOOGLE FLIGHTS - MÉTODO MEJORADO
// ============================================

async function scrapeFlightPrice(page, origin, dest, date, roundTrip = false) {
  try {
    // Construir URL correcta de Google Flights
    const returnDate = roundTrip ? `&return=${getReturnDate(date)}` : '';
    const tripType = roundTrip ? 1 : 2; // 1=round trip, 2=one way
    
    // URL más directa usando parámetros de Google Flights
    const searchQuery = `${origin} to ${dest}`.replace(/ /g, '+');
    const url = `https://www.google.com/travel/flights/search?tfs=CBwQAhoeEgoyMDI2LTAyLTE4agwIAhIIL20vMDZtMnY${roundTrip ? '' : '&tfu=EgYIBRABGAA'}&curr=EUR&hl=es`;
    
    // URL alternativa más simple
    const simpleUrl = roundTrip 
      ? `https://www.google.com/travel/flights?q=vuelos+${origin.replace(/ /g,'+')}+a+${dest.replace(/ /g,'+')}+${date}&curr=EUR&hl=es`
      : `https://www.google.com/travel/flights?q=vuelos+${origin.replace(/ /g,'+')}+a+${dest.replace(/ /g,'+')}+${date}+solo+ida&curr=EUR&hl=es`;
    
    await page.goto(simpleUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
    
    // Esperar a que cargue
    await new Promise(r => setTimeout(r, 4000));
    
    // Intentar aceptar cookies
    try {
      const acceptBtns = await page.$$('button');
      for (const btn of acceptBtns) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && (text.includes('Aceptar') || text.includes('Accept'))) {
          await btn.click();
          break;
        }
      }
    } catch(e) {}
    
    await new Promise(r => setTimeout(r, 2000));
    
    // EXTRAER PRECIO - Método mejorado
    const result = await page.evaluate((isLongHaul) => {
      const text = document.body.innerText;
      const prices = [];
      
      // Precio mínimo según destino (evitar capturar números falsos)
      const minPrice = isLongHaul ? 300 : 180;
      const maxPrice = isLongHaul ? 2500 : 1200;
      
      // Método 1: Buscar precios con formato "XXX €" o "€ XXX"
      const patterns = [
        /(\d{3,4})\s*€/g,
        /€\s*(\d{3,4})/g,
        /EUR\s*(\d{3,4})/gi
      ];
      
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const price = parseInt(match[1]);
          if (price >= minPrice && price <= maxPrice) {
            prices.push(price);
          }
        }
      }
      
      // Método 2: Buscar en atributos de elementos
      document.querySelectorAll('[data-price], [aria-label*="€"]').forEach(el => {
        const attr = el.getAttribute('data-price') || el.getAttribute('aria-label') || '';
        const match = attr.match(/(\d{3,4})/);
        if (match) {
          const price = parseInt(match[1]);
          if (price >= minPrice && price <= maxPrice) {
            prices.push(price);
          }
        }
      });
      
      // Detectar aerolínea
      let airline = '';
      const knownAirlines = [
        'Iberia', 'Air Europa', 'LATAM', 'Aerolineas Argentinas', 
        'American Airlines', 'Delta', 'United', 'British Airways', 
        'Air France', 'Lufthansa', 'TAP', 'KLM', 'Level', 'Emirates'
      ];
      for (const a of knownAirlines) {
        if (text.includes(a)) {
          airline = a;
          break;
        }
      }
      
      // Filtrar y obtener el más bajo real
      const uniquePrices = [...new Set(prices)].sort((a, b) => a - b);
      
      return {
        price: uniquePrices.length > 0 ? uniquePrices[0] : null,
        allPrices: uniquePrices.slice(0, 5),
        airline: airline || 'Varias aerolíneas'
      };
    }, dest.includes('Buenos Aires') || dest.includes('Cordoba'));
    
    if (result.price) {
      return {
        price: result.price,
        airline: result.airline,
        url: simpleUrl.replace(/ /g, '+')
      };
    }
    
    return null;
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return null;
  }
}

function getReturnDate(departDate) {
  const date = new Date(departDate);
  date.setDate(date.getDate() + 14);
  return date.toISOString().split('T')[0];
}

function getSearchDates() {
  const dates = [];
  const today = new Date();
  // Buscar para 3, 5 y 7 semanas adelante
  [21, 35, 49].forEach(days => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    dates.push(d.toISOString().split('T')[0]);
  });
  return dates;
}

// ============================================
// BÚSQUEDA PRINCIPAL
// ============================================

async function runSearch() {
  const startTime = new Date();
  console.log('\n' + '═'.repeat(60));
  console.log(`🔍 BÚSQUEDA - ${startTime.toLocaleString('es-ES')}`);
  console.log('═'.repeat(60));
  
  let browser;
  try {
    console.log('🌐 Abriendo navegador...');
    
    // Configuración para Railway/Docker o local
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage', 
        '--disable-gpu',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials'
      ]
    };
    
    // Si estamos en Docker/Railway, usar el Chrome instalado
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    
    browser = await puppeteer.launch(launchOptions);
  } catch (error) {
    console.error('❌ Error:', error.message);
    return;
  }
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
  
  const dates = getSearchDates();
  const oneWayDeals = [];
  const roundTripDeals = [];
  
  let count = 0;
  const total = ROUTES.length * dates.length * 2;
  
  for (const route of ROUTES) {
    console.log(`\n✈️  ${route.origin} → ${route.dest}`);
    
    for (const date of dates) {
      // ========== SOLO IDA ==========
      count++;
      process.stdout.write(`   [${count}/${total}] IDA ${date}... `);
      
      const oneWay = await scrapeFlightPrice(page, route.origin, route.dest, date, false);
      
      if (oneWay && oneWay.price) {
        const isGood = oneWay.price <= route.goodOneWay;
        console.log(`€${oneWay.price}${isGood ? ' ✓' : ''}`);
        
        if (isGood) {
          oneWayDeals.push({
            route: `${route.origin} → ${route.dest}`,
            price: oneWay.price,
            date,
            airline: oneWay.airline,
            url: oneWay.url
          });
        }
      } else {
        console.log('--');
      }
      
      await new Promise(r => setTimeout(r, 2000));
      
      // ========== IDA Y VUELTA ==========
      count++;
      process.stdout.write(`   [${count}/${total}] I+V ${date}... `);
      
      const roundTrip = await scrapeFlightPrice(page, route.origin, route.dest, date, true);
      
      if (roundTrip && roundTrip.price) {
        const isGood = roundTrip.price <= route.goodRoundTrip;
        console.log(`€${roundTrip.price}${isGood ? ' ✓' : ''}`);
        
        if (isGood) {
          roundTripDeals.push({
            route: `${route.origin} → ${route.dest}`,
            price: roundTrip.price,
            date,
            returnDate: getReturnDate(date),
            airline: roundTrip.airline,
            url: roundTrip.url
          });
        }
      } else {
        console.log('--');
      }
      
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  await browser.close();
  
  // Enviar reporte a Telegram
  await sendReport(oneWayDeals, roundTripDeals);
  
  const duration = Math.round((new Date() - startTime) / 1000 / 60);
  console.log('\n' + '═'.repeat(60));
  console.log(`✅ Terminado en ${duration} min | IDA: ${oneWayDeals.length} ofertas | I+V: ${roundTripDeals.length} ofertas`);
  console.log('═'.repeat(60));
}

// ============================================
// ENVIAR REPORTE
// ============================================

async function sendReport(oneWayDeals, roundTripDeals) {
  if (oneWayDeals.length === 0 && roundTripDeals.length === 0) {
    console.log('📭 Sin ofertas destacadas');
    return;
  }
  
  oneWayDeals.sort((a, b) => a.price - b.price);
  roundTripDeals.sort((a, b) => a.price - b.price);
  
  const argOW = oneWayDeals.filter(d => d.route.includes('Buenos') || d.route.includes('Cordoba'));
  const usaOW = oneWayDeals.filter(d => d.route.includes('Nueva York') || d.route.includes('Miami'));
  const argRT = roundTripDeals.filter(d => d.route.includes('Buenos') || d.route.includes('Cordoba'));
  const usaRT = roundTripDeals.filter(d => d.route.includes('Nueva York') || d.route.includes('Miami'));
  
  let msg = `✈️ <b>OFERTAS DE VUELOS</b>\n`;
  msg += `📅 ${new Date().toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'})}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  // SOLO IDA
  if (argOW.length > 0 || usaOW.length > 0) {
    msg += `🎫 <b>SOLO IDA</b>\n\n`;
    
    if (argOW.length > 0) {
      msg += `🇦🇷 Argentina:\n`;
      argOW.slice(0, 5).forEach(d => {
        msg += `  • <b>€${d.price}</b> ${d.route}\n`;
        msg += `    ${formatDate(d.date)} · ${d.airline}\n`;
        msg += `    <a href="${d.url}">Ver →</a>\n`;
      });
      msg += `\n`;
    }
    
    if (usaOW.length > 0) {
      msg += `🇺🇸 Estados Unidos:\n`;
      usaOW.slice(0, 4).forEach(d => {
        msg += `  • <b>€${d.price}</b> ${d.route}\n`;
        msg += `    ${formatDate(d.date)} · ${d.airline}\n`;
        msg += `    <a href="${d.url}">Ver →</a>\n`;
      });
      msg += `\n`;
    }
  }
  
  // IDA Y VUELTA
  if (argRT.length > 0 || usaRT.length > 0) {
    msg += `🔄 <b>IDA Y VUELTA</b>\n\n`;
    
    if (argRT.length > 0) {
      msg += `🇦🇷 Argentina:\n`;
      argRT.slice(0, 5).forEach(d => {
        msg += `  • <b>€${d.price}</b> ${d.route}\n`;
        msg += `    ${formatDate(d.date)} ↔ ${formatDate(d.returnDate)}\n`;
        msg += `    <a href="${d.url}">Ver →</a>\n`;
      });
      msg += `\n`;
    }
    
    if (usaRT.length > 0) {
      msg += `🇺🇸 Estados Unidos:\n`;
      usaRT.slice(0, 4).forEach(d => {
        msg += `  • <b>€${d.price}</b> ${d.route}\n`;
        msg += `    ${formatDate(d.date)} ↔ ${formatDate(d.returnDate)}\n`;
        msg += `    <a href="${d.url}">Ver →</a>\n`;
      });
    }
  }
  
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🔄 Próxima búsqueda: 30 min`;
  
  await sendTelegram(msg);
  console.log('📱 Reporte enviado');
}

function formatDate(str) {
  return new Date(str).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

// ============================================
// INICIO
// ============================================

async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              🛫 FLIGHT DEAL BOT v3.0                       ║');
  console.log('║         IDA + IDA Y VUELTA por separado                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  initTelegram();
  
  console.log(`📋 Rutas: ${ROUTES.length}`);
  console.log(`📊 Búsquedas: Solo ida + Ida y vuelta`);
  console.log(`⏰ Frecuencia: cada 30 minutos\n`);
  
  await sendTelegram(
    `🛫 <b>Flight Deal Bot v3.0</b>\n\n` +
    `Monitoreando:\n` +
    `• Europa → Argentina 🇦🇷\n` +
    `• Europa → USA 🇺🇸\n\n` +
    `📊 Dos listados:\n` +
    `• Solo ida\n` +
    `• Ida y vuelta\n\n` +
    `⏰ Cada 30 min\n` +
    `<i>Iniciando...</i>`
  );
  
  await runSearch();
  
  cron.schedule(CONFIG.schedule, async () => {
    await runSearch();
  });
  
  console.log('\n🔄 Bot activo. Ctrl+C para detener.\n');
}

main().catch(console.error);
