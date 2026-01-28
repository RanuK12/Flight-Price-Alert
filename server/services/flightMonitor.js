/**
 * Servicio de Monitoreo de Vuelos v3.0
 * 
 * Busca ofertas de vuelos usando web scraping (Skyscanner + Kayak)
 * - Europa/USA → Argentina: SOLO IDA
 * - Argentina (EZE/COR) → Europa: IDA Y VUELTA
 * 
 * Fechas de búsqueda: 25 marzo - 8 abril 2026
 */

const cron = require('node-cron');
const { scrapeAllSources } = require('../scrapers');
const { sendDealsReport, sendNoDealsMessage, sendErrorAlert, sendMonitoringStarted, isActive } = require('./telegram');
const { run, get, all, getProviderUsage } = require('../database/db');

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

// Rango de fechas para buscar ofertas
const SEARCH_DATE_START = '2026-03-25';
const SEARCH_DATE_END = '2026-04-08';

// Generar fechas de búsqueda (cada 3 días)
function generateSearchDates() {
  const dates = [];
  const start = new Date(SEARCH_DATE_START);
  const end = new Date(SEARCH_DATE_END);
  
  let current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 3); // cada 3 días
  }
  return dates;
}

const SEARCH_DATES = generateSearchDates();

// =============================================
// ROTACIÓN: rutas + fechas dentro del rango 25-mar → 8-abr
// =============================================

const rotationState = {
  europeArg: 0,
  argEuRoundTrip: 0,
  usaArg: 0,
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

// =============================================
// CONFIGURACIÓN DE UMBRALES DE OFERTAS
// =============================================

// Umbrales personalizados por el usuario
const ONE_WAY_THRESHOLDS = {
  europeToArgentina: 300,   // Europa → Argentina: máx €300 (solo ida)
  usaToArgentina: 180,      // USA → Argentina: máx €180 (solo ida)
  usaToArgentinaToARG: 250, // USA → Argentina: máx €250 (solo ida, desde USA a ARG)
};

const ROUND_TRIP_THRESHOLD = 500; // Argentina → Europa: máx €500 (ida y vuelta)

// Aeropuertos por región
const EUROPE_AIRPORTS = ['MAD', 'BCN', 'FCO', 'CDG', 'FRA', 'AMS', 'LIS', 'LHR', 'MUC', 'ZRH', 'BRU', 'VIE'];
const USA_AIRPORTS = ['MIA', 'JFK', 'MCO', 'LAX', 'EWR', 'ORD', 'ATL', 'DFW'];
const ARGENTINA_AIRPORTS = ['EZE', 'COR'];

// =============================================
// RUTAS A MONITOREAR
// =============================================

const MONITORED_ROUTES = [
  // ========== SOLO IDA: Europa → Argentina ==========
  { origin: 'MAD', destination: 'EZE', name: 'Madrid → Buenos Aires', region: 'europe', tripType: 'oneway' },
  { origin: 'BCN', destination: 'EZE', name: 'Barcelona → Buenos Aires', region: 'europe', tripType: 'oneway' },
  { origin: 'FCO', destination: 'EZE', name: 'Roma → Buenos Aires', region: 'europe', tripType: 'oneway' },
  { origin: 'CDG', destination: 'EZE', name: 'París → Buenos Aires', region: 'europe', tripType: 'oneway' },
  { origin: 'FRA', destination: 'EZE', name: 'Frankfurt → Buenos Aires', region: 'europe', tripType: 'oneway' },
  { origin: 'AMS', destination: 'EZE', name: 'Amsterdam → Buenos Aires', region: 'europe', tripType: 'oneway' },
  { origin: 'LIS', destination: 'EZE', name: 'Lisboa → Buenos Aires', region: 'europe', tripType: 'oneway' },
  { origin: 'LHR', destination: 'EZE', name: 'Londres → Buenos Aires', region: 'europe', tripType: 'oneway' },
  
  // ========== SOLO IDA: USA → Argentina ==========
  { origin: 'MIA', destination: 'EZE', name: 'Miami → Buenos Aires', region: 'usa', tripType: 'oneway' },
  { origin: 'JFK', destination: 'EZE', name: 'Nueva York → Buenos Aires', region: 'usa', tripType: 'oneway' },
  { origin: 'MCO', destination: 'EZE', name: 'Orlando → Buenos Aires', region: 'usa', tripType: 'oneway' },

  // ========== IDA Y VUELTA: Argentina → Europa ==========
  // Ezeiza → Europa
  { origin: 'EZE', destination: 'MAD', name: 'Buenos Aires → Madrid', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'EZE', destination: 'BCN', name: 'Buenos Aires → Barcelona', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'EZE', destination: 'FCO', name: 'Buenos Aires → Roma', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'EZE', destination: 'CDG', name: 'Buenos Aires → París', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'EZE', destination: 'LIS', name: 'Buenos Aires → Lisboa', region: 'argentina', tripType: 'roundtrip' },
  
  // Córdoba → Europa
  { origin: 'COR', destination: 'MAD', name: 'Córdoba → Madrid', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'COR', destination: 'BCN', name: 'Córdoba → Barcelona', region: 'argentina', tripType: 'roundtrip' },
  { origin: 'COR', destination: 'FCO', name: 'Córdoba → Roma', region: 'argentina', tripType: 'roundtrip' },
];

/**
 * Determina si un precio es una oferta según el tipo de vuelo
 */
function isGoodDeal(price, origin, destination, tripType = 'oneway') {
  // Ida y vuelta Argentina → Europa
  if (tripType === 'roundtrip' && ARGENTINA_AIRPORTS.includes(origin)) {
    return price <= ROUND_TRIP_THRESHOLD;
  }

  // Solo ida Europa → USA
  if (EUROPE_AIRPORTS.includes(origin) && USA_AIRPORTS.includes(destination)) {
    return price <= ONE_WAY_THRESHOLDS.usaToArgentina;
  }

  // Solo ida USA → Argentina
  if (USA_AIRPORTS.includes(origin) && ARGENTINA_AIRPORTS.includes(destination)) {
    return price <= ONE_WAY_THRESHOLDS.usaToArgentinaToARG;
  }

  // Solo ida Europa → Argentina
  if (EUROPE_AIRPORTS.includes(origin) && ARGENTINA_AIRPORTS.includes(destination)) {
    return price <= ONE_WAY_THRESHOLDS.europeToArgentina;
  }

  // Por defecto, usar el umbral de Europa → Argentina
  return price <= ONE_WAY_THRESHOLDS.europeToArgentina;
}

/**
 * Obtiene el umbral máximo para una ruta
 */
function getThreshold(origin, tripType = 'oneway') {
  if (tripType === 'roundtrip') {
    return ROUND_TRIP_THRESHOLD;
  }
  
  if (EUROPE_AIRPORTS.includes(origin)) {
    return ONE_WAY_THRESHOLDS.europeToArgentina;
  } else if (USA_AIRPORTS.includes(origin)) {
    return ONE_WAY_THRESHOLDS.usaToArgentina;
  }
  
  return ONE_WAY_THRESHOLDS.europeToArgentina;
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
  console.log('🔍 BÚSQUEDA DE OFERTAS DE VUELOS v3.0');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📊 Rutas: ${MONITORED_ROUTES.length}`);
  console.log(`📅 Fechas: ${SEARCH_DATE_START} al ${SEARCH_DATE_END}`);
  console.log(`🕒 Timezone: ${MONITOR_TIMEZONE}`);
  console.log(`📦 Presupuesto SerpApi: ${usedToday}/${SERPAPI_DAILY_BUDGET} hoy | Run: ${allowedThisRun}/${runBudget}`);
  console.log('');
  console.log('📋 UMBRALES:');
  console.log(`   • Solo ida Europa→Argentina: máx €${ONE_WAY_THRESHOLDS.europeToArgentina}`);
  console.log(`   • Solo ida USA→Argentina: máx €${ONE_WAY_THRESHOLDS.usaToArgentina}`);
  console.log(`   • Ida y vuelta Argentina→Europa: máx €${ROUND_TRIP_THRESHOLD} (< €600)`);
  console.log('');

  const results = {
    oneWayDeals: [],
    roundTripDeals: [],
    allSearches: [],
    errors: [],
    startTime: new Date(),
  };

  // Separar rutas por tipo y prioridad
  const oneWayRoutes = MONITORED_ROUTES.filter(r => r.tripType === 'oneway');
  const roundTripRoutes = MONITORED_ROUTES.filter(r => r.tripType === 'roundtrip');

  const europeArgRoutes = oneWayRoutes.filter(r => r.region === 'europe');      // prioridad 1
  const argEuRoutes = roundTripRoutes.filter(r => r.region === 'argentina');   // prioridad 2
  const usaArgRoutes = oneWayRoutes.filter(r => r.region === 'usa');           // prioridad 3

  // Plan de búsquedas para esta corrida (weights: EU→ARG > ARG↔EU > USA→ARG)
  const plan = [];
  if (allowedThisRun > 0) {
    // base: EU + RT
    const euCount = allowedThisRun === 2 ? 1 : 2;
    const rtCount = 1;

    plan.push(...rotatePick(europeArgRoutes, 'europeArg', euCount));
    plan.push(...rotatePick(argEuRoutes, 'argEuRoundTrip', rtCount));

    // Extra: 1 USA→ARG en la ventana de tarde, día sí / día no, si queda hueco
    const hour = getHourInTimeZone(MONITOR_TIMEZONE);
    const isAfternoonWindow = hour >= 12 && hour < 19;
    const shouldIncludeUsa = isAfternoonWindow && (new Date().getDate() % 2 === 0);
    if (shouldIncludeUsa && plan.length < allowedThisRun) {
      plan.push(...rotatePick(usaArgRoutes, 'usaArg', 1));
    }

    plan.splice(allowedThisRun);
  }

  console.log('═══════════════════════════════════════');
  console.log('✈️  BUSCANDO (PRESUPUESTO OPTIMIZADO)');
  console.log('═══════════════════════════════════════');

  if (allowedThisRun <= 0) {
    console.log('⚠️ Sin presupuesto disponible para esta corrida. (Si hay cache, igual puede haber hits)');
  }

  // Ejecutar plan (mezcla one-way + roundtrip según prioridad)
  for (const route of plan) {
    const isRoundTrip = route.tripType === 'roundtrip';
    const departureDate = pickRotatedDateForRoute(route);
    const returnDate = isRoundTrip ? addDays(departureDate, 14) : null;

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
        success: searchResult.minPrice !== null,
      });

      if (searchResult.allFlights && searchResult.allFlights.length > 0) {
        for (const flight of searchResult.allFlights) {
          const price = Math.round(flight.price);
          const threshold = isRoundTrip ? ROUND_TRIP_THRESHOLD : getThreshold(route.origin, 'oneway');

          if (price <= threshold) {
            const depDate = flight.departureDate || departureDate;
            const rtDate = isRoundTrip ? (flight.returnDate || returnDate) : null;

            if (isRoundTrip) {
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
            } else {
              results.oneWayDeals.push({
                origin: route.origin,
                destination: route.destination,
                routeName: route.name,
                region: route.region,
                price,
                airline: flight.airline,
                source: flight.source,
                departureDate: depDate,
                bookingUrl: flight.link,
                tripType: 'oneway',
                threshold,
              });
              console.log(`  🔥 OFERTA REAL: €${price} (${flight.airline}) - ${formatDate(depDate)}`);
            }
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

    await sleep(350);
  }

  results.endTime = new Date();
  lastSearchTime = results.endTime;

  // Eliminar duplicados y ordenar por precio
  results.oneWayDeals = removeDuplicatesAndSort(results.oneWayDeals);
  results.roundTripDeals = removeDuplicatesAndSort(results.roundTripDeals);

  totalDealsFound += results.oneWayDeals.length + results.roundTripDeals.length;

  // Mostrar resumen
  const duration = (results.endTime - results.startTime) / 1000;
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN');
  console.log('='.repeat(60));
  console.log(`✅ Búsquedas: ${results.allSearches.filter(s => s.success).length}/${MONITORED_ROUTES.length}`);
  console.log(`🔥 Ofertas SOLO IDA: ${results.oneWayDeals.length}`);
  console.log(`🔥 Ofertas IDA+VUELTA: ${results.roundTripDeals.length}`);
  console.log(`⏱️ Duración: ${duration.toFixed(1)}s`);

  // Mostrar mejores ofertas
  if (results.oneWayDeals.length > 0) {
    console.log('\n🎯 TOP SOLO IDA:');
    results.oneWayDeals.slice(0, 5).forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.routeName}: €${d.price} (${d.airline})`);
    });
  }

  if (results.roundTripDeals.length > 0) {
    console.log('\n🎯 TOP IDA+VUELTA:');
    results.roundTripDeals.slice(0, 5).forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.routeName}: €${d.price} (${d.airline})`);
    });
  }

  // Enviar reporte a Telegram
  if (notifyDeals && isActive()) {
    const hasDeals = results.oneWayDeals.length > 0 || results.roundTripDeals.length > 0;
    if (hasDeals) {
      await sendDealsReport(results.oneWayDeals, results.roundTripDeals);
    } else {
      // Enviar mensaje de "sin ofertas" para confirmar que funciona
      await sendNoDealsMessage(results.allSearches.length);
    }
  }

  // Guardar en base de datos
  await saveDealsToDatabase(results.oneWayDeals);
  await saveDealsToDatabase(results.roundTripDeals);

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
  console.log(`   • Solo ida Europa→Argentina: €${ONE_WAY_THRESHOLDS.europeToArgentina}`);
  console.log(`   • Solo ida USA→Argentina: €${ONE_WAY_THRESHOLDS.usaToArgentina}`);
  console.log(`   • Ida y vuelta: €${ROUND_TRIP_THRESHOLD}`);
  console.log('');

  if (isActive()) {
    sendMonitoringStarted();
  }

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
      oneWayEurope: ONE_WAY_THRESHOLDS.europeToArgentina,
      oneWayUSA: ONE_WAY_THRESHOLDS.usaToArgentina,
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
  ONE_WAY_THRESHOLDS,
  ROUND_TRIP_THRESHOLD,
};
