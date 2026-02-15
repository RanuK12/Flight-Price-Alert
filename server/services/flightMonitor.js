/**
 * Servicio de Monitoreo de Vuelos v4.0
 *
 * Busca ofertas de vuelos usando web scraping (Puppeteer Google Flights)
 * - Argentina (EZE/COR) → Europa: IDA Y VUELTA
 *   Ida: entre 20 marzo y 7 abril 2026
 *   Vuelta fija: 7 abril 2026
 *
 * (Vuelo de ida Europa→Argentina ya comprado)
 */

const cron = require('node-cron');
const { scrapeAllSources } = require('../scrapers');
const { sendDealsReport, sendErrorAlert, sendNearDealAlert, isActive } = require('./telegram');
const { run, get, all, getProviderUsage, wasRecentlyAlerted, isNewHistoricalLow } = require('../database/db');

// Estado del monitor
let isMonitoring = false;
let lastSearchTime = null;
let totalDealsFound = 0;
let cronJob = null;

// =============================================
// CONFIG: TIMEZONE + PRESUPUESTO SERPAPI
// =============================================

// Timezone objetivo (Italia)
const MONITOR_TIMEZONE = process.env.MONITOR_TIMEZONE || 'Europe/Rome';

// Presupuesto SerpApi (plan 250/mes ≈ 8/día)
const SERPAPI_PROVIDER = 'serpapi_google_flights';
const SERPAPI_DAILY_BUDGET = parseInt(process.env.SERPAPI_DAILY_BUDGET || '8', 10);

// Presupuesto por corrida (default: 3 + 3 + 2 = 8/día)
const RUN_BUDGET_MORNING = parseInt(process.env.MONITOR_RUN_BUDGET_MORNING || '3', 10);    // 08:15
const RUN_BUDGET_AFTERNOON = parseInt(process.env.MONITOR_RUN_BUDGET_AFTERNOON || '3', 10); // 15:15
const RUN_BUDGET_NIGHT = parseInt(process.env.MONITOR_RUN_BUDGET_NIGHT || '2', 10);        // 22:15

function getDateInTimeZone(tz = MONITOR_TIMEZONE, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function getHourInTimeZone(tz = MONITOR_TIMEZONE, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = parts.find(p => p.type === 'hour')?.value;
  return parseInt(h, 10);
}

function getRunBudgetForNow() {
  const hour = getHourInTimeZone(MONITOR_TIMEZONE);
  if (hour >= 6 && hour < 12) return RUN_BUDGET_MORNING;
  if (hour >= 12 && hour < 19) return RUN_BUDGET_AFTERNOON;
  return RUN_BUDGET_NIGHT;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// =============================================
// CONFIGURACIÓN DE FECHAS
// =============================================

// Rango de fechas de IDA (vuelta fija: 7 abril)
const SEARCH_DATE_START = '2026-03-20';
const SEARCH_DATE_END = '2026-04-07';
const FIXED_RETURN_DATE = '2026-04-07';

// Cuántas fechas buscar por ruta en cada corrida
const DATES_PER_ROUTE = 2;

// Generar fechas de búsqueda (cada 2 días — más granularidad)
function generateSearchDates() {
  const dates = [];
  const start = new Date(SEARCH_DATE_START);
  const end = new Date(SEARCH_DATE_END);
  
  let current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 2); // cada 2 días
  }
  return dates;
}

const SEARCH_DATES = generateSearchDates();

// =============================================
// =============================================
// Procesar TODAS las rutas configuradas en cada búsqueda
// =============================================

const rotationState = {
  argEuRoundTrip: 0,
};

function rotatePick(list, stateKey, count) {
  if (!Array.isArray(list) || list.length === 0 || count <= 0) return [];
  const picked = [];
  for (let i = 0; i < count; i++) {
    const idx = rotationState[stateKey] % list.length;
    picked.push(list[idx]);
    rotationState[stateKey] = (rotationState[stateKey] + 1) % list.length;
  }
  return picked;
}

function pickRotatedDateForRoute(route) {
  const todayIdx = Math.abs(new Date().getDate()) % SEARCH_DATES.length;
  const routeIdx = Math.abs((route.origin.charCodeAt(0) + route.destination.charCodeAt(0)) % SEARCH_DATES.length);
  const dateIdx = (todayIdx + routeIdx) % SEARCH_DATES.length;
  return SEARCH_DATES[dateIdx];
}

/**
 * Devuelve múltiples fechas para una ruta, distribuidas en el rango.
 * Cada día se devuelven fechas diferentes gracias a todayNum.
 */
function pickDatesForRoute(route, count = DATES_PER_ROUTE) {
  const todayNum = new Date().getDate();
  const routeHash = route.origin.charCodeAt(0) + route.destination.charCodeAt(0) + route.origin.charCodeAt(1);
  const startIdx = (todayNum + routeHash) % SEARCH_DATES.length;
  const step = Math.max(1, Math.floor(SEARCH_DATES.length / count));

  const dates = [];
  for (let i = 0; i < count && i < SEARCH_DATES.length; i++) {
    const idx = (startIdx + i * step) % SEARCH_DATES.length;
    if (!dates.includes(SEARCH_DATES[idx])) {
      dates.push(SEARCH_DATES[idx]);
    }
  }
  return dates;
}

// =============================================
// CONFIGURACIÓN DE UMBRALES DE OFERTAS
// =============================================

// Umbrales — solo ida y vuelta Argentina → Europa
const ROUND_TRIP_THRESHOLD = 600; // Argentina → Europa: máx €600 (ida y vuelta)
const NEAR_DEAL_RT_MIN = 650;     // Alerta "casi oferta" desde €650
const NEAR_DEAL_RT_MAX = 800;     // Alerta "casi oferta" hasta €800

// Aeropuertos por región
const EUROPE_AIRPORTS = ['MAD', 'BCN', 'FCO', 'CDG', 'FRA', 'AMS', 'LIS', 'LHR', 'MUC', 'ZRH', 'BRU', 'VIE'];
const ARGENTINA_AIRPORTS = ['EZE', 'COR'];

// =============================================
// RUTAS A MONITOREAR
// =============================================

const MONITORED_ROUTES = [
  // ========== IDA Y VUELTA: Buenos Aires (EZE) → Europa ==========
  { origin: 'EZE', destination: 'MAD', name: 'Buenos Aires → Madrid', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'EZE', destination: 'BCN', name: 'Buenos Aires → Barcelona', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'EZE', destination: 'FCO', name: 'Buenos Aires → Roma', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'EZE', destination: 'CDG', name: 'Buenos Aires → París', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'EZE', destination: 'LIS', name: 'Buenos Aires → Lisboa', region: 'argentina', tripType: 'roundtrip' },

  // ========== IDA Y VUELTA: Córdoba (COR) → Europa ==========
  { origin: 'COR', destination: 'MAD', name: 'Córdoba → Madrid', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'COR', destination: 'BCN', name: 'Córdoba → Barcelona', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'COR', destination: 'FCO', name: 'Córdoba → Roma', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'COR', destination: 'CDG', name: 'Córdoba → París', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'COR', destination: 'LIS', name: 'Córdoba → Lisboa', region: 'argentina', tripType: 'roundtrip' },
];

/**
 * Determina si un precio es una oferta (solo ida y vuelta Argentina → Europa)
 */
function isGoodDeal(price, origin, destination, tripType = 'roundtrip') {
  return price <= ROUND_TRIP_THRESHOLD;
}

/**
 * Obtiene el umbral máximo para una ruta
 */
function getThreshold(origin, tripType = 'roundtrip') {
  return ROUND_TRIP_THRESHOLD;
}

/**
 * Formatea fecha para mostrar
 */
function formatDate(dateStr) {
  if (!dateStr || dateStr === 'Flexible') return 'Flexible';
  const date = new Date(dateStr);
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

/**
 * Realiza una búsqueda completa de ofertas
 */
async function runFullSearch(options = {}) {
  const { notifyDeals = true, maxRequests } = options;

  // Presupuesto por corrida (adaptativo a la hora Italia)
  const runBudget = typeof maxRequests === 'number' ? maxRequests : getRunBudgetForNow();

  // Presupuesto restante del día (según DB, en timezone Italia)
  const usageDate = getDateInTimeZone(MONITOR_TIMEZONE);
  const usedToday = await getProviderUsage(SERPAPI_PROVIDER, usageDate);
  const remainingToday = Math.max(0, SERPAPI_DAILY_BUDGET - usedToday);
  const allowedThisRun = Math.max(0, Math.min(runBudget, remainingToday));

  console.log('\n' + '='.repeat(60));
  console.log('🔍 BÚSQUEDA DE OFERTAS DE VUELOS v4.0');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📊 Rutas: ${MONITORED_ROUTES.length} | Fechas: ${SEARCH_DATES.length} (cada 2 días)`);
  console.log(`📅 Ida: ${SEARCH_DATE_START} al ${SEARCH_DATE_END} | Vuelta fija: ${FIXED_RETURN_DATE}`);
  console.log(`🕒 Timezone: ${MONITOR_TIMEZONE}`);
  console.log(`📦 SerpApi: ${usedToday}/${SERPAPI_DAILY_BUDGET} hoy (Puppeteer sin límite)`);
  console.log('');
  console.log('📋 UMBRALES:');
  console.log(`   • Ida y vuelta Argentina→Europa: máx €${ROUND_TRIP_THRESHOLD}`);
  console.log(`   • Casi oferta I+V: €${NEAR_DEAL_RT_MIN}-€${NEAR_DEAL_RT_MAX} (alerta aparte)`);
  console.log('');

  const results = {
    roundTripDeals: [],
    allSearches: [],
    errors: [],
    startTime: new Date(),
  };

  // Todas las rutas son ida y vuelta Argentina → Europa
  const argEuRoutes = MONITORED_ROUTES.filter(r => r.region === 'argentina');

  // ═══════════════════════════════════════════════════════════════
  // PLAN DE BÚSQUEDA — Puppeteer es gratis, buscar más rutas
  // Solo ida+vuelta Argentina → Europa (vuelta fija: 7 abril)
  // ═══════════════════════════════════════════════════════════════
  const plan = [];
  plan.push(...rotatePick(argEuRoutes, 'argEuRoundTrip', 5));

  // Máximo 5 rutas por corrida (× 2 fechas c/u = ~10 búsquedas)
  plan.splice(5);

  const totalSearches = plan.length * DATES_PER_ROUTE;

  console.log('═══════════════════════════════════════');
  console.log(`✈️  BUSCANDO: ${plan.length} rutas × ${DATES_PER_ROUTE} fechas = ${totalSearches} búsquedas`);
  console.log('═══════════════════════════════════════');

  // Ejecutar plan: cada ruta × múltiples fechas
  for (const route of plan) {
    const isRoundTrip = route.tripType === 'roundtrip';
    const dates = pickDatesForRoute(route, DATES_PER_ROUTE);

    for (const departureDate of dates) {
    const returnDate = isRoundTrip ? FIXED_RETURN_DATE : null;

    console.log(`\n🛫 ${route.name} ${isRoundTrip ? '(ida y vuelta)' : '(solo ida)'}`);
    console.log(`   📅 ${departureDate}${returnDate ? ` ↔ ${returnDate}` : ''}`);

    try {
      const searchResult = await scrapeAllSources(
        route.origin,
        route.destination,
        isRoundTrip,
        departureDate,
        isRoundTrip ? returnDate : undefined
      );

      results.allSearches.push({
        route: route.name,
        origin: route.origin,
        destination: route.destination,
        tripType: isRoundTrip ? 'roundtrip' : 'oneway',
        date: departureDate,
        success: searchResult.minPrice !== null,
      });

      if (searchResult.allFlights && searchResult.allFlights.length > 0) {
        for (const flight of searchResult.allFlights) {
          const price = Math.round(flight.price);

          // ══════════════════════════════════════════════════════════════
          // DETECCIÓN DE PRECIOS IDA+VUELTA EN BÚSQUEDA SOLO IDA
          // Google Flights a veces muestra precios RT aunque busquemos OW.
          // Si detectamos esto, usar el umbral de roundtrip, no el de oneway.
          // ══════════════════════════════════════════════════════════════
          let effectiveTripType = isRoundTrip ? 'roundtrip' : 'oneway';
          if (!isRoundTrip && flight.isRoundTripPrice) {
            console.log(`  ℹ️ €${price} es precio ida+vuelta (Google lo muestra como RT)`);
            effectiveTripType = 'roundtrip';
          }

          const threshold = effectiveTripType === 'roundtrip'
            ? ROUND_TRIP_THRESHOLD
            : getThreshold(route.origin, 'oneway');

          // ══════════════════════════════════════════════════════════════
          // VALIDACIÓN DE PRECIOS REALISTAS (evitar falsos positivos)
          // ══════════════════════════════════════════════════════════════
          // Vuelos transatlánticos: mínimo realista €150 solo ida, €250 ida+vuelta
          const minRealistic = effectiveTripType === 'roundtrip' ? 250 : 150;
          if (price < minRealistic || price > 5000) {
            console.log(`  ⚠️ Precio irreal ignorado: €${price} (mín esperable: €${minRealistic})`);
            continue;
          }

          if (price <= threshold) {
            const depDate = flight.departureDate || departureDate;
            const rtDate = (isRoundTrip || flight.isRoundTripPrice) ? (flight.returnDate || returnDate) : null;

            // ══════════════════════════════════════════════════════════════
            // ANTI-SPAM: Verificar si ya alertamos precio similar (±5%)
            // ══════════════════════════════════════════════════════════════
            const recentlyAlerted = await wasRecentlyAlerted(route.origin, route.destination, price, 24);
            if (recentlyAlerted) {
              console.log(`  🔕 €${price} ya alertado recientemente (anti-spam)`);
              continue;
            }

            results.roundTripDeals.push({
              origin: route.origin,
              destination: route.destination,
              routeName: route.name,
              region: route.region,
              price,
              airline: flight.airline,
              source: flight.source,
              departureDate: depDate,
              returnDate: rtDate,
              bookingUrl: flight.link,
              tripType: 'roundtrip',
              threshold,
            });
            console.log(`  🔥 OFERTA REAL I+V: €${price} (${flight.airline}) - ${formatDate(depDate)} ↔ ${formatDate(rtDate)}`);
          } else if (effectiveTripType === 'roundtrip' && price >= NEAR_DEAL_RT_MIN && price <= NEAR_DEAL_RT_MAX) {
            // ══════════════════════════════════════════════════════════════
            // EXCEPCIÓN: Ida+vuelta Argentina→Europa entre €650-€800
            // Enviar alerta aparte "casi oferta"
            // ══════════════════════════════════════════════════════════════
            const depDate = flight.departureDate || departureDate;
            const rtDate = flight.returnDate || returnDate;

            const recentlyAlerted = await wasRecentlyAlerted(route.origin, route.destination, price, 24);
            if (recentlyAlerted) {
              console.log(`  🔕 €${price} (casi oferta) ya alertado (anti-spam)`);
              continue;
            }

            results.nearDeals = results.nearDeals || [];
            results.nearDeals.push({
              origin: route.origin,
              destination: route.destination,
              routeName: route.name,
              price,
              airline: flight.airline,
              source: flight.source,
              departureDate: depDate,
              returnDate: rtDate,
              bookingUrl: flight.link,
              tripType: 'roundtrip',
            });
            console.log(`  🟡 CASI OFERTA I+V: €${price} (${flight.airline}) - ${formatDate(depDate)} ↔ ${formatDate(rtDate)}`);
          } else {
            console.log(`  ✈️ €${price} (${flight.airline}) - no es oferta (máx €${threshold})`);
          }
        }
      } else {
        console.log(`  ⚠️ Sin precios reales encontrados`);
      }
    } catch (error) {
      results.errors.push({ route: route.name, error: error.message });
      console.error(`  ❌ Error: ${error.message}`);
    }

    await sleep(1500); // pausa entre búsquedas (anti-detección)
    } // fin loop de fechas
  } // fin loop de rutas

  results.endTime = new Date();
  lastSearchTime = results.endTime;

  // Eliminar duplicados y ordenar por precio
  results.roundTripDeals = removeDuplicatesAndSort(results.roundTripDeals);

  totalDealsFound += results.roundTripDeals.length;

  // Mostrar resumen
  const duration = (results.endTime - results.startTime) / 1000;
  const successfulSearches = results.allSearches.filter(s => s.success).length;
  const failedSearches = results.errors.length;
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN');
  console.log('='.repeat(60));
  console.log(`✅ Búsquedas exitosas: ${successfulSearches}/${results.allSearches.length} (${plan.length} rutas × ${DATES_PER_ROUTE} fechas)`);
  if (failedSearches > 0) {
    console.log(`❌ Errores: ${failedSearches}`);
  }
  console.log(`🔥 Ofertas IDA+VUELTA: ${results.roundTripDeals.length}`);
  console.log(`⏱️ Duración: ${duration.toFixed(1)}s`);
  console.log(`📅 Próxima búsqueda: según schedule configurado`);

  // Mostrar mejores ofertas
  if (results.roundTripDeals.length > 0) {
    console.log('\n🎯 TOP IDA+VUELTA:');
    results.roundTripDeals.slice(0, 5).forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.routeName}: €${d.price} (${d.airline})`);
    });
  }

  const nearDeals = results.nearDeals || [];
  if (nearDeals.length > 0) {
    console.log('\n🟡 CASI OFERTAS I+V (€650-€800):');
    nearDeals.slice(0, 5).forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.routeName}: €${d.price} (${d.airline})`);
    });
  }

  // Enviar reporte a Telegram SOLO SI HAY OFERTAS (anti-spam)
  if (notifyDeals && isActive()) {
    const hasDeals = results.roundTripDeals.length > 0;
    if (hasDeals) {
      await sendDealsReport([], results.roundTripDeals);
      console.log('📱 Notificación Telegram enviada con ofertas');
    } else {
      // NO enviar mensaje cuando no hay ofertas (evita spam)
      console.log('📴 Sin ofertas - no se envía notificación (anti-spam)');
    }

    // Enviar alerta aparte para "casi ofertas" ida+vuelta €650-€800
    if (nearDeals.length > 0) {
      await sendNearDealAlert(nearDeals);
      console.log('📱 Alerta "Casi Oferta" enviada a Telegram');
    }
  }

  // Guardar en base de datos
  await saveDealsToDatabase(results.roundTripDeals);
  await saveDealsToDatabase(nearDeals);

  return results;
}

/**
 * Elimina duplicados y ordena por precio
 */
function removeDuplicatesAndSort(deals) {
  const unique = [];
  const seen = new Set();
  
  for (const deal of deals) {
    const key = `${deal.origin}-${deal.destination}-${deal.price}-${deal.airline}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(deal);
    }
  }
  
  return unique.sort((a, b) => a.price - b.price);
}

/**
 * Guarda ofertas en la base de datos
 */
async function saveDealsToDatabase(deals) {
  for (const deal of deals) {
    try {
      await run(
        `INSERT INTO flight_prices (route_id, origin, destination, airline, price, source, booking_url, departure_date, recorded_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          `${deal.origin}-${deal.destination}`,
          deal.origin,
          deal.destination,
          deal.airline,
          deal.price,
          deal.source,
          deal.bookingUrl,
          deal.departureDate,
        ]
      );
    } catch (err) {
      // Ignorar duplicados
    }
  }
}

/**
 * Búsqueda rápida para una ruta específica
 */
async function quickSearch(origin, destination) {
  try {
    const result = await scrapeAllSources(origin, destination);
    return result;
  } catch (error) {
    console.error(`Error en búsqueda rápida:`, error.message);
    throw error;
  }
}

/**
 * Inicia el monitoreo continuo
 */
function startMonitoring(cronSchedule = '15 8,15,22 * * *', timezone = 'Europe/Rome') {
  if (isMonitoring) {
    console.log('⚠️ El monitoreo ya está activo');
    return false;
  }

  console.log('\n🚀 INICIANDO MONITOREO DE VUELOS');
  console.log(`⏰ Programación: ${cronSchedule}`);
  console.log('📋 Umbrales:');
  console.log(`   • Ida y vuelta Argentina→Europa: €${ROUND_TRIP_THRESHOLD}`);
  console.log(`   • Casi oferta I+V: €${NEAR_DEAL_RT_MIN}-€${NEAR_DEAL_RT_MAX}`);
  console.log('');

  // No enviamos mensaje de inicio (anti-spam)
  // Solo se notifica cuando hay ofertas reales

  // Programar búsquedas
  cronJob = cron.schedule(cronSchedule, async () => {
    console.log(`\n⏰ Búsqueda programada: ${new Date().toLocaleString('es-ES')}`);
    try {
      await runFullSearch();
    } catch (error) {
      console.error('Error en búsqueda:', error);
      if (isActive()) sendErrorAlert(error, 'Búsqueda programada');
    }
  }, {
    scheduled: true,
    timezone,
  });

  isMonitoring = true;
  console.log('✅ Monitoreo iniciado\n');
  
  return true;
}

/**
 * Detiene el monitoreo
 */
function stopMonitoring() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
  isMonitoring = false;
  console.log('🛑 Monitoreo detenido');
  return true;
}

/**
 * Obtiene el estado del monitor
 */
function getMonitorStatus() {
  return {
    isMonitoring,
    lastSearchTime,
    totalDealsFound,
    telegramActive: isActive(),
    thresholds: {
      roundTrip: ROUND_TRIP_THRESHOLD,
    },
    routes: MONITORED_ROUTES.length,
  };
}

/**
 * Obtiene estadísticas
 */
async function getStats() {
  try {
    const totalFlights = await get('SELECT COUNT(*) as count FROM flight_prices');
    const recentDeals = await all(
      `SELECT * FROM flight_prices ORDER BY recorded_at DESC LIMIT 20`
    );
    
    return {
      totalFlights: totalFlights?.count || 0,
      recentDeals,
      monitorStatus: getMonitorStatus(),
    };
  } catch (error) {
    return { error: error.message, monitorStatus: getMonitorStatus() };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  runFullSearch,
  quickSearch,
  startMonitoring,
  stopMonitoring,
  getMonitorStatus,
  getStats,
  MONITORED_ROUTES,
  ROUND_TRIP_THRESHOLD,
  NEAR_DEAL_RT_MIN,
  NEAR_DEAL_RT_MAX,
};
