/**
 * 🛫 FLIGHT DEAL BOT v4.0
 *
 * Uses Google Flights API directly (no browser needed).
 * Faster, lighter, more reliable than Puppeteer scraping.
 *
 * Routes:
 *   1. MDQ → COR (19-24 abr) solo ida — ALERTA ≤ $50
 *   2. MAD/BCN → ORD (20-30 jun) solo ida — ALERTA ≤ $300/$280
 *   3. EZE/COR → MAD/BCN/FCO/MXP (15 jun - 31 jul) solo ida
 *
 * Uso: node bot.js
 */

require('dotenv').config();
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const crypto = require('crypto');
const { searchFlightsApi } = require('./server/scrapers/googleFlightsApi');

// ============================================
// HTTP HEALTH SERVER
// ============================================

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      bot: 'Flight Deal Bot v4.0 (API)',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`🌐 Health server en puerto ${PORT}`);
});

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatIds: (process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '')
    .split(',').map(id => id.trim()).filter(id => id),
  schedule: process.env.SCHEDULE || '0 */2 * * *', // Every 2 hours
};

// ============================================
// ROUTES
// ============================================

function dateRange(start, end) {
  const dates = [];
  let current = new Date(start);
  const endDate = new Date(end);
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

const ROUTES = [
  // Mar del Plata → Córdoba (19-24 abr)
  { origin: 'MDQ', dest: 'COR', name: 'Mar del Plata → Córdoba',
    dates: dateRange('2026-04-19', '2026-04-24'), threshold: 270, flag: '🇦🇷' },

  // España → Chicago (20-30 jun)
  { origin: 'MAD', dest: 'ORD', name: 'Madrid → Chicago',
    dates: dateRange('2026-06-20', '2026-06-30'), threshold: 520, flag: '🇪🇸→🇺🇸' },
  { origin: 'BCN', dest: 'ORD', name: 'Barcelona → Chicago',
    dates: dateRange('2026-06-20', '2026-06-30'), threshold: 500, flag: '🇪🇸→🇺🇸' },

  // Buenos Aires → España/Italia (15 jun - 31 jul)
  { origin: 'EZE', dest: 'MAD', name: 'Buenos Aires → Madrid',
    dates: dateRange('2026-06-15', '2026-07-31'), threshold: 1100, flag: '🇦🇷→🇪🇸' },
  { origin: 'EZE', dest: 'BCN', name: 'Buenos Aires → Barcelona',
    dates: dateRange('2026-06-15', '2026-07-31'), threshold: 1100, flag: '🇦🇷→🇪🇸' },
  { origin: 'EZE', dest: 'FCO', name: 'Buenos Aires → Roma',
    dates: dateRange('2026-06-15', '2026-07-31'), threshold: 1200, flag: '🇦🇷→🇮🇹' },
  { origin: 'EZE', dest: 'MXP', name: 'Buenos Aires → Milán',
    dates: dateRange('2026-06-15', '2026-07-31'), threshold: 1200, flag: '🇦🇷→🇮🇹' },

  // Córdoba → España/Italia (15 jun - 31 jul)
  { origin: 'COR', dest: 'MAD', name: 'Córdoba → Madrid',
    dates: dateRange('2026-06-15', '2026-07-31'), threshold: 1300, flag: '🇦🇷→🇪🇸' },
  { origin: 'COR', dest: 'BCN', name: 'Córdoba → Barcelona',
    dates: dateRange('2026-06-15', '2026-07-31'), threshold: 1300, flag: '🇦🇷→🇪🇸' },
  { origin: 'COR', dest: 'FCO', name: 'Córdoba → Roma',
    dates: dateRange('2026-06-15', '2026-07-31'), threshold: 1350, flag: '🇦🇷→🇮🇹' },
  { origin: 'COR', dest: 'MXP', name: 'Córdoba → Milán',
    dates: dateRange('2026-06-15', '2026-07-31'), threshold: 1350, flag: '🇦🇷→🇮🇹' },
];

// ============================================
// TELEGRAM
// ============================================

let bot = null;

function initTelegram() {
  if (!CONFIG.telegramToken || CONFIG.telegramChatIds.length === 0) {
    console.log('❌ ERROR: Configura TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_IDS en .env');
    process.exit(1);
  }
  bot = new TelegramBot(CONFIG.telegramToken, { polling: false });
  console.log(`✅ Telegram configurado (${CONFIG.telegramChatIds.length} usuarios)`);
}

async function sendTelegram(message) {
  if (!bot) return;
  for (const chatId of CONFIG.telegramChatIds) {
    try {
      await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error(`Error Telegram (${chatId}):`, error.message);
    }
  }
}

// ============================================
// DUPLICATE DETECTION
// ============================================

let lastReportHash = null;

function isNewReport(deals) {
  const data = deals.map(d => `${d.origin}-${d.dest}|${d.price}|${d.date}`).sort().join(';');
  const hash = crypto.createHash('md5').update(data).digest('hex');
  if (hash === lastReportHash) return false;
  lastReportHash = hash;
  return true;
}

// ============================================
// DATE ROTATION (search subset each run)
// ============================================

let rotationOffset = 0;

function pickDates(allDates, count = 3) {
  if (allDates.length <= count) return [...allDates];
  const picked = [];
  for (let i = 0; i < count; i++) {
    const idx = (rotationOffset + i) % allDates.length;
    picked.push(allDates[idx]);
  }
  return picked;
}

// ============================================
// MAIN SEARCH
// ============================================

async function runSearch() {
  const startTime = new Date();
  console.log('\n' + '='.repeat(60));
  console.log(`🔍 BÚSQUEDA v4.0 (API Directa) — ${startTime.toLocaleString('es-ES')}`);
  console.log('='.repeat(60));

  rotationOffset = (rotationOffset + 1) % 20;
  const deals = [];
  let searchCount = 0;
  let successCount = 0;

  for (const route of ROUTES) {
    const datesToSearch = pickDates(route.dates, 3);
    console.log(`\n✈️ ${route.name} (${datesToSearch.length} fechas, umbral ≤$${route.threshold})`);

    for (const date of datesToSearch) {
      searchCount++;
      try {
        const result = await searchFlightsApi(route.origin, route.dest, date, null);

        if (result.success && result.flights.length > 0) {
          successCount++;
          const best = result.flights[0];
          const price = Math.round(best.price);

          if (price <= route.threshold && price >= 10) {
            console.log(`  🔥 $${price} (${best.airline}) — ${date}`);
            deals.push({
              origin: route.origin,
              dest: route.dest,
              name: route.name,
              flag: route.flag,
              price,
              airline: best.airline,
              stops: best.stops,
              duration: best.totalDuration,
              date,
              url: result.searchUrl,
              threshold: route.threshold,
            });
          } else {
            console.log(`  ✈️ $${price} (${best.airline}) — ${date}`);
          }
        } else {
          console.log(`  ⚠️ Sin resultados — ${date}`);
        }
      } catch (error) {
        console.error(`  ❌ ${date}: ${error.message}`);
      }

      // Short delay between API calls
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Sort by price
  deals.sort((a, b) => a.price - b.price);

  const duration = Math.round((new Date() - startTime) / 1000);
  console.log('\n' + '='.repeat(60));
  console.log(`✅ ${successCount}/${searchCount} búsquedas OK | ${deals.length} ofertas | ${duration}s`);
  console.log('='.repeat(60));

  // Send Telegram report
  if (deals.length > 0 && isNewReport(deals)) {
    await sendReport(deals);
  } else if (deals.length === 0) {
    console.log('📭 Sin ofertas');
  } else {
    console.log('🔁 Resultados idénticos, no se envía');
  }
}

// ============================================
// TELEGRAM REPORT
// ============================================

function formatDate(str) {
  return new Date(str).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

async function sendReport(deals) {
  // Group by flag/region
  const groups = {};
  for (const d of deals) {
    const key = d.flag;
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  }

  let msg = `✈️ <b>OFERTAS DE VUELOS</b>\n`;
  msg += `📅 ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const [flag, groupDeals] of Object.entries(groups)) {
    msg += `${flag}\n`;
    for (const d of groupDeals.slice(0, 5)) {
      const stopsLabel = d.stops === 0 ? 'directo' : d.stops === 1 ? '1 escala' : `${d.stops} escalas`;
      const durationLabel = d.duration ? `${Math.floor(d.duration / 60)}h${d.duration % 60 > 0 ? d.duration % 60 + 'm' : ''}` : '';
      msg += `  • <b>$${d.price}</b> ${d.name}\n`;
      msg += `    ${formatDate(d.date)} · ${d.airline}`;
      if (stopsLabel) msg += ` · ${stopsLabel}`;
      if (durationLabel) msg += ` · ${durationLabel}`;
      msg += `\n`;
      msg += `    <a href="${d.url}">Ver en Google Flights</a>\n`;
    }
    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🔄 Próxima búsqueda: 2h`;

  await sendTelegram(msg);
  console.log('📱 Reporte enviado');
}

// ============================================
// START
// ============================================

async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          🛫 FLIGHT DEAL BOT v4.0 (API Directa)           ║');
  console.log('║        Sin browser — Más rápido y confiable              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  initTelegram();

  console.log(`📋 Rutas: ${ROUTES.length}`);
  console.log('📊 Modo: Solo ida (todas las rutas)');
  console.log(`⏰ Frecuencia: ${CONFIG.schedule}\n`);

  const routeSummary = ROUTES.map(r => `• ${r.name} (≤$${r.threshold})`).join('\n');

  await sendTelegram(
    `🛫 <b>Flight Deal Bot v4.0</b> (API Directa)\n\n` +
    `Monitoreando:\n${routeSummary}\n\n` +
    `⏰ Cada 2 horas\n` +
    `<i>Iniciando primera búsqueda...</i>`
  );

  await runSearch();

  cron.schedule(CONFIG.schedule, async () => {
    await runSearch();
  });

  console.log('\n🔄 Bot activo. Ctrl+C para detener.\n');
}

main().catch(console.error);
