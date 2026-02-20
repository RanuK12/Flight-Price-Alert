/**
 * Servicio de Monitoreo de Vuelos v5.0
 *
 * Busca ofertas de vuelos usando web scraping (Puppeteer Google Flights)
 * - Tramo IDA:    Argentina (EZE/COR) → Europa  — SOLO IDA, fechas 21-27 mar 2026
 * - Tramo VUELTA: Europa → Argentina (EZE/COR)  — SOLO IDA, fecha fija 7 abr 2026
 *   → Los dos tramos se combinan para calcular el total real (IDA + VUELTA)
 * - Chile (SCL) → Sídney (SYD): SOLO IDA (todo junio 2026)
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

// Rango de fechas de IDA (tramo outbound): 21-27 marzo
const SEARCH_DATE_START = '2026-03-21';
const SEARCH_DATE_END = '2026-03-27';

// Cuántas fechas buscar por ruta en cada corrida
const DATES_PER_ROUTE = 2;

// Generar fechas de búsqueda (cada 2 días — más granularidad)
function generateSearchDatesRange(startStr, endStr) {
  const dates = [];
  const start = new Date(startStr);
  const end = new Date(endStr);
  
  let current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 2); // cada 2 días
  }
  return dates;
}

const SEARCH_DATES = generateSearchDatesRange(SEARCH_DATE_START, SEARCH_DATE_END);

// =============================================
// Construir plan de búsqueda con TODAS las rutas
// (sin rotación en memoria — se perdía en cada restart)
// =============================================

/**
 * Devuelve el plan de búsqueda completo: todas las rutas en cada corrida.
 * Exportado para testing.
 */
function buildSearchPlan() {
  const argEuRoutes = MONITORED_ROUTES.filter(r => r.region === 'argentina');
  const chileOceaniaRoutes = MONITORED_ROUTES.filter(r => r.region === 'chile_oceania');
  const europeInternalRoutes = MONITORED_ROUTES.filter(r => r.region === 'europe_internal');
  return [...argEuRoutes, ...chileOceaniaRoutes, ...europeInternalRoutes];
}

/**
 * Devuelve múltiples fechas para una ruta, distribuidas en el rango.
 * Cada día se devuelven fechas diferentes gracias a todayNum.
 */
function pickDatesForRoute(route, count = DATES_PER_ROUTE) {
  // Usar fechas específicas de la ruta si están definidas, sino las globales
  const searchDates = (route.dateStart && route.dateEnd)
    ? generateSearchDatesRange(route.dateStart, route.dateEnd)
    : SEARCH_DATES;

  const todayNum = new Date().getDate();
  const routeHash = route.origin.charCodeAt(0) + route.destination.charCodeAt(0) + route.origin.charCodeAt(1);
  const startIdx = (todayNum + routeHash) % searchDates.length;
  const step = Math.max(1, Math.floor(searchDates.length / count));

  const dates = [];
  for (let i = 0; i < count && i < searchDates.length; i++) {
    const idx = (startIdx + i * step) % searchDates.length;
    if (!dates.includes(searchDates[idx])) {
      dates.push(searchDates[idx]);
    }
  }
  return dates;
}

// =============================================
// CONFIGURACIÓN DE UMBRALES DE OFERTAS
// =============================================

// Tramos individuales (Argentina ↔ Europa, solo ida)
const ONE_WAY_OUTBOUND_THRESHOLD = 400;  // ARG → EUR solo ida: ≤€400 = oferta individual
const ONE_WAY_RETURN_THRESHOLD = 350;    // EUR → ARG solo ida: ≤€350 = oferta individual

// Combinado (suma tramo IDA + tramo VUELTA)
const COMBINED_DEAL_THRESHOLD = 700;     // Suma ≤€700 = gran oferta 🔥🔥🔥
const COMBINED_GOOD_THRESHOLD = 850;     // Suma ≤€850 = buena oferta 🔥🔥
const NEAR_DEAL_COMBINED_MIN = 850;      // "Casi oferta" combinado desde €850
const NEAR_DEAL_COMBINED_MAX = 1100;     // "Casi oferta" combinado hasta €1100

// Chile → Oceanía (solo ida, junio)
const ONE_WAY_THRESHOLDS = {
  chileToOceania: 800,           // Chile → Oceanía: máx €800 (era €700, muy restrictivo)
  chileToOceaniaNeardeal: 1050,  // Casi oferta SCL→SYD: €800-€1050
};

// Vuelos internos Europa (tramos cortos, aerolíneas low cost)
const EUROPE_INTERNAL_THRESHOLDS = {
  'VCE-AMS': { deal: 100, nearDeal: 150 },  // Venecia → Amsterdam: ≤€100 oferta
  'AMS-MAD': { deal: 80,  nearDeal: 130 },  // Amsterdam → Madrid: ≤€80 oferta
};

// Compat: mantener por si algún import externo lo referencia
const ROUND_TRIP_THRESHOLD = COMBINED_GOOD_THRESHOLD;
const NEAR_DEAL_RT_MIN = NEAR_DEAL_COMBINED_MIN;
const NEAR_DEAL_RT_MAX = NEAR_DEAL_COMBINED_MAX;

// Aeropuertos por región
const EUROPE_AIRPORTS = ['MAD', 'BCN', 'FCO', 'CDG', 'FRA', 'AMS', 'LIS', 'LHR', 'MUC', 'ZRH', 'BRU', 'VIE'];
const ARGENTINA_AIRPORTS = ['EZE', 'COR'];
const CHILE_AIRPORTS = ['SCL'];
const OCEANIA_AIRPORTS = ['SYD', 'MEL', 'AKL'];

// Aeropuertos activos en las rutas Argentina ↔ Europa (para pairing)
const EUROPE_AIRPORTS_ACTIVE = ['MAD', 'BCN', 'FCO', 'CDG', 'LIS'];
const ARGENTINA_AIRPORTS_ACTIVE = ['EZE', 'COR'];

// =============================================
// RUTAS A MONITOREAR
// =============================================

const MONITORED_ROUTES = [
  // ===== TRAMO IDA: Argentina → Europa (solo ida, 21-27 mar) =====
  { origin: 'EZE', destination: 'MAD', name: 'Buenos Aires → Madrid', region: 'argentina', tripType: 'oneway', tripDirection: 'outbound', dateStart: '2026-03-21', dateEnd: '2026-03-27' },
  { origin: 'EZE', destination: 'BCN', name: 'Buenos Aires → Barcelona', region: 'argentina', tripType: 'oneway', tripDirection: 'outbound', dateStart: '2026-03-21', dateEnd: '2026-03-27' },
  { origin: 'EZE', destination: 'FCO', name: 'Buenos Aires → Roma', region: 'argentina', tripType: 'oneway', tripDirection: 'outbound', dateStart: '2026-03-21', dateEnd: '2026-03-27' },
  { origin: 'EZE', destination: 'CDG', name: 'Buenos Aires → París', region: 'argentina', tripType: 'oneway', tripDirection: 'outbound', dateStart: '2026-03-21', dateEnd: '2026-03-27' },
  { origin: 'EZE', destination: 'LIS', name: 'Buenos Aires → Lisboa', region: 'argentina', tripType: 'oneway', tripDirection: 'outbound', dateStart: '2026-03-21', dateEnd: '2026-03-27' },
  { origin: 'COR', destination: 'MAD', name: 'Córdoba → Madrid', region: 'argentina', tripType: 'oneway', tripDirection: 'outbound', dateStart: '2026-03-21', dateEnd: '2026-03-27' },
  { origin: 'COR', destination: 'BCN', name: 'Córdoba → Barcelona', region: 'argentina', tripType: 'oneway', tripDirection: 'outbound', dateStart: '2026-03-21', dateEnd: '2026-03-27' },
  { origin: 'COR', destination: 'FCO', name: 'Córdoba → Roma', region: 'argentina', tripType: 'oneway', tripDirection: 'outbound', dateStart: '2026-03-21', dateEnd: '2026-03-27' },
  { origin: 'COR', destination: 'CDG', name: 'Córdoba → París', region: 'argentina', tripType: 'oneway', tripDirection: 'outbound', dateStart: '2026-03-21', dateEnd: '2026-03-27' },
  { origin: 'COR', destination: 'LIS', name: 'Córdoba → Lisboa', region: 'argentina', tripType: 'oneway', tripDirection: 'outbound', dateStart: '2026-03-21', dateEnd: '2026-03-27' },

  // ===== TRAMO VUELTA: Europa → Argentina (solo ida, fija 7 abr) =====
  { origin: 'MAD', destination: 'EZE', name: 'Madrid → Buenos Aires', region: 'argentina', tripType: 'oneway', tripDirection: 'return', dateStart: '2026-04-07', dateEnd: '2026-04-07' },
  { origin: 'BCN', destination: 'EZE', name: 'Barcelona → Buenos Aires', region: 'argentina', tripType: 'oneway', tripDirection: 'return', dateStart: '2026-04-07', dateEnd: '2026-04-07' },
  { origin: 'FCO', destination: 'EZE', name: 'Roma → Buenos Aires', region: 'argentina', tripType: 'oneway', tripDirection: 'return', dateStart: '2026-04-07', dateEnd: '2026-04-07' },
  { origin: 'CDG', destination: 'EZE', name: 'París → Buenos Aires', region: 'argentina', tripType: 'oneway', tripDirection: 'return', dateStart: '2026-04-07', dateEnd: '2026-04-07' },
  { origin: 'LIS', destination: 'EZE', name: 'Lisboa → Buenos Aires', region: 'argentina', tripType: 'oneway', tripDirection: 'return', dateStart: '2026-04-07', dateEnd: '2026-04-07' },
  { origin: 'MAD', destination: 'COR', name: 'Madrid → Córdoba', region: 'argentina', tripType: 'oneway', tripDirection: 'return', dateStart: '2026-04-07', dateEnd: '2026-04-07' },
  { origin: 'BCN', destination: 'COR', name: 'Barcelona → Córdoba', region: 'argentina', tripType: 'oneway', tripDirection: 'return', dateStart: '2026-04-07', dateEnd: '2026-04-07' },
  { origin: 'FCO', destination: 'COR', name: 'Roma → Córdoba', region: 'argentina', tripType: 'oneway', tripDirection: 'return', dateStart: '2026-04-07', dateEnd: '2026-04-07' },
  { origin: 'CDG', destination: 'COR', name: 'París → Córdoba', region: 'argentina', tripType: 'oneway', tripDirection: 'return', dateStart: '2026-04-07', dateEnd: '2026-04-07' },
  { origin: 'LIS', destination: 'COR', name: 'Lisboa → Córdoba', region: 'argentina', tripType: 'oneway', tripDirection: 'return', dateStart: '2026-04-07', dateEnd: '2026-04-07' },

  // ===== SOLO IDA: Chile → Oceanía (junio 2026) =====
  { origin: 'SCL', destination: 'SYD', name: 'Santiago → Sídney', region: 'chile_oceania', tripType: 'oneway', tripDirection: null, dateStart: '2026-06-01', dateEnd: '2026-06-30' },

  // ===== VUELOS INTERNOS EUROPA =====
  { origin: 'VCE', destination: 'AMS', name: 'Venecia → Ámsterdam', region: 'europe_internal', tripType: 'oneway', tripDirection: null, dateStart: '2026-03-25', dateEnd: '2026-03-26' },
  { origin: 'AMS', destination: 'MAD', name: 'Ámsterdam → Madrid', region: 'europe_internal', tripType: 'oneway', tripDirection: null, dateStart: '2026-04-05', dateEnd: '2026-04-06' },
];

/**
 * Determina si un precio individual de un tramo es una oferta
 */
function isGoodDeal(price, origin, destination, tripDirection = null) {
  if (CHILE_AIRPORTS.includes(origin) && OCEANIA_AIRPORTS.includes(destination)) {
    return price <= ONE_WAY_THRESHOLDS.chileToOceania;
  }
  if (tripDirection === 'return') {
    return price <= ONE_WAY_RETURN_THRESHOLD;
  }
  return price <= ONE_WAY_OUTBOUND_THRESHOLD;
}

/**
 * Obtiene el umbral individual del tramo para una ruta
 */
function getThreshold(origin, destination, tripDirection = null) {
  if (CHILE_AIRPORTS.includes(origin) && OCEANIA_AIRPORTS.includes(destination)) {
    return ONE_WAY_THRESHOLDS.chileToOceania;
  }
  const euroKey = `${origin}-${destination}`;
  if (EUROPE_INTERNAL_THRESHOLDS[euroKey]) {
    return EUROPE_INTERNAL_THRESHOLDS[euroKey].deal;
  }
  if (tripDirection === 'return') {
    return ONE_WAY_RETURN_THRESHOLD;
  }
  return ONE_WAY_OUTBOUND_THRESHOLD;
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
  console.log('🔍 BÚSQUEDA DE OFERTAS DE VUELOS v5.0');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📊 Rutas: ${MONITORED_ROUTES.length} (${MONITORED_ROUTES.filter(r=>r.tripDirection==='outbound').length} outbound + ${MONITORED_ROUTES.filter(r=>r.tripDirection==='return').length} return + 1 SCL→SYD)`);
  console.log(`📅 IDA: ${SEARCH_DATE_START} al ${SEARCH_DATE_END} | VUELTA: 7 abr 2026 (fija)`);
  console.log(`🕒 Timezone: ${MONITOR_TIMEZONE}`);
  console.log(`📦 SerpApi: ${usedToday}/${SERPAPI_DAILY_BUDGET} hoy (Puppeteer sin límite)`);
  console.log('');
  console.log('📋 UMBRALES:');
  console.log(`   • Tramo IDA Argentina→Europa: ≤€${ONE_WAY_OUTBOUND_THRESHOLD} (oferta individual)`);
  console.log(`   • Tramo VUELTA Europa→Argentina: ≤€${ONE_WAY_RETURN_THRESHOLD} (oferta individual)`);
  console.log(`   • Combinado IDA+VUELTA: ≤€${COMBINED_DEAL_THRESHOLD} (gran oferta) | ≤€${COMBINED_GOOD_THRESHOLD} (buena oferta)`);
  console.log(`   • Casi oferta combinado: €${NEAR_DEAL_COMBINED_MIN}-€${NEAR_DEAL_COMBINED_MAX}`);
  console.log(`   • Solo ida Chile→Oceanía: ≤€${ONE_WAY_THRESHOLDS.chileToOceania}`);
  console.log('');

  const results = {
    oneWayDeals: [],       // SCL→SYD solo ida (≤€800)
    outboundDeals: [],     // ARG→EUR individual ≤€400 (info complementaria)
    returnDeals: [],       // EUR→ARG individual ≤€350 (info complementaria)
    combinedDeals: [],     // Pares con suma ≤€850 (la métrica principal)
    nearCombinedDeals: [], // Pares con suma €850-€1100
    allSearches: [],
    errors: [],
    startTime: new Date(),
  };

  // Mapa para trackear el MEJOR precio por ruta (sin importar si es oferta)
  // Clave: `${origin}-${destination}` → mejor vuelo encontrado
  const routeBestPrices = {};

  // ═══════════════════════════════════════════════════════════════
  // PLAN DE BÚSQUEDA — todas las rutas en cada corrida
  // ═══════════════════════════════════════════════════════════════
  const plan = buildSearchPlan();
  const outboundRoutes = plan.filter(r => r.tripDirection === 'outbound');
  const returnRoutes = plan.filter(r => r.tripDirection === 'return');
  const sclRoutes = plan.filter(r => r.region === 'chile_oceania');

  console.log('═══════════════════════════════════════');
  console.log(`✈️  BUSCANDO: ${plan.length} rutas`);
  console.log(`   IDA (outbound): ${outboundRoutes.length} rutas × ~${DATES_PER_ROUTE} fechas`);
  console.log(`   VUELTA (return): ${returnRoutes.length} rutas × 1 fecha (7 abr)`);
  console.log(`   SCL→SYD: ${sclRoutes.length} ruta × ~${DATES_PER_ROUTE} fechas`);
  console.log('═══════════════════════════════════════');

  // Ejecutar plan: cada ruta × sus fechas
  for (const route of plan) {
    const dates = pickDatesForRoute(route, DATES_PER_ROUTE);

    for (const departureDate of dates) {
      const dirLabel = route.tripDirection === 'outbound' ? '(IDA)' : route.tripDirection === 'return' ? '(VUELTA)' : '(solo ida)';
      console.log(`\n🛫 ${route.name} ${dirLabel}`);
      console.log(`   📅 ${departureDate}`);

      try {
        const searchResult = await scrapeAllSources(
          route.origin,
          route.destination,
          false,          // siempre one-way
          departureDate,
          undefined       // sin returnDate
        );

        results.allSearches.push({
          route: route.name,
          origin: route.origin,
          destination: route.destination,
          tripDirection: route.tripDirection,
          date: departureDate,
          success: searchResult.minPrice !== null,
        });

        if (searchResult.allFlights && searchResult.allFlights.length > 0) {
          for (const flight of searchResult.allFlights) {
            const price = Math.round(flight.price);

            // ══════════════════════════════════════════════════════════════
            // VALIDACIÓN DE PRECIOS REALISTAS (evitar falsos positivos)
            // Mínimo realista para vuelo intercontinental solo ida: €150
            // ══════════════════════════════════════════════════════════════
            if (price < 150 || price > 5000) {
              console.log(`  ⚠️ Precio irreal ignorado: €${price}`);
              continue;
            }

            const depDate = flight.departureDate || departureDate;
            const routeKey = `${route.origin}-${route.destination}`;

            // ── Trackear mejor precio por ruta (para pairing posterior) ──
            if (!routeBestPrices[routeKey] || price < routeBestPrices[routeKey].price) {
              routeBestPrices[routeKey] = {
                price,
                airline: flight.airline,
                departureDate: depDate,
                bookingUrl: flight.link,
                origin: route.origin,
                destination: route.destination,
                routeName: route.name,
                region: route.region,
                tripDirection: route.tripDirection,
              };
            }

            // ── Alertar si el tramo individual es barato por sí solo ──
            const threshold = getThreshold(route.origin, route.destination, route.tripDirection);
            if (price <= threshold) {
              const recentlyAlerted = await wasRecentlyAlerted(route.origin, route.destination, price, 24);
              if (!recentlyAlerted) {
                const dealEntry = {
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
                  tripDirection: route.tripDirection,
                  threshold,
                };

                if (route.region === 'chile_oceania') {
                  results.oneWayDeals.push(dealEntry);
                  console.log(`  🔥 OFERTA SCL→SYD: €${price} (${flight.airline}) - ${formatDate(depDate)}`);
                } else if (route.region === 'europe_internal') {
                  results.europeDeals = results.europeDeals || [];
                  results.europeDeals.push(dealEntry);
                  console.log(`  🔥 OFERTA EUR INTERNA: €${price} (${flight.airline}) ${route.origin}→${route.destination} - ${formatDate(depDate)}`);
                } else if (route.tripDirection === 'outbound') {
                  results.outboundDeals.push(dealEntry);
                  console.log(`  🔥 TRAMO IDA oferta: €${price} (${flight.airline}) - ${formatDate(depDate)}`);
                } else if (route.tripDirection === 'return') {
                  results.returnDeals.push(dealEntry);
                  console.log(`  🔥 TRAMO VUELTA oferta: €${price} (${flight.airline}) - ${formatDate(depDate)}`);
                }
              } else {
                console.log(`  🔕 €${price} ya alertado recientemente (anti-spam)`);
              }
            } else {
              if (route.region === 'chile_oceania' && price <= ONE_WAY_THRESHOLDS.chileToOceaniaNeardeal) {
                console.log(`  🟡 CASI OFERTA SCL→SYD: €${price} (${flight.airline})`);
              } else if (route.region === 'europe_internal') {
                const nearDeal = EUROPE_INTERNAL_THRESHOLDS[`${route.origin}-${route.destination}`]?.nearDeal;
                if (nearDeal && price <= nearDeal) {
                  console.log(`  🟡 CASI OFERTA EUR INTERNA: €${price} (${flight.airline}) ${route.origin}→${route.destination}`);
                } else {
                  console.log(`  ✈️ €${price} (${flight.airline}) - máx oferta €${threshold}`);
                }
              } else {
                console.log(`  ✈️ €${price} (${flight.airline}) - umbral individual máx €${threshold}`);
              }
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

  // ═══════════════════════════════════════════════════════════════
  // PAIRING: Combinar tramo IDA + tramo VUELTA para calcular total
  // ═══════════════════════════════════════════════════════════════
  console.log('\n🔗 Combinando tramos IDA + VUELTA...');
  for (const argAirport of ARGENTINA_AIRPORTS_ACTIVE) {
    for (const eurAirport of EUROPE_AIRPORTS_ACTIVE) {
      const outbound = routeBestPrices[`${argAirport}-${eurAirport}`];
      const returnFlight = routeBestPrices[`${eurAirport}-${argAirport}`];

      if (!outbound || !returnFlight) {
        if (outbound) console.log(`  ⚠️ ${argAirport}↔${eurAirport}: IDA encontrada (€${outbound.price}) pero sin VUELTA`);
        if (returnFlight) console.log(`  ⚠️ ${argAirport}↔${eurAirport}: VUELTA encontrada (€${returnFlight.price}) pero sin IDA`);
        continue;
      }

      const combinedPrice = outbound.price + returnFlight.price;
      console.log(`  🔢 ${argAirport}↔${eurAirport}: IDA €${outbound.price} + VUELTA €${returnFlight.price} = TOTAL €${combinedPrice}`);

      if (combinedPrice <= COMBINED_GOOD_THRESHOLD) {
        // Anti-spam: usar el precio combinado
        const recentlyAlerted = await wasRecentlyAlerted(argAirport, eurAirport, combinedPrice, 24);
        if (!recentlyAlerted) {
          const emoji = combinedPrice <= COMBINED_DEAL_THRESHOLD ? '🔥🔥🔥 GRAN OFERTA' : '🔥🔥 BUENA OFERTA';
          console.log(`    ${emoji}: €${combinedPrice} total`);
          results.combinedDeals.push({
            origin: argAirport,
            destination: eurAirport,
            combinedPrice,
            outbound,
            returnFlight,
          });
        } else {
          console.log(`    🔕 €${combinedPrice} combinado ya alertado (anti-spam)`);
        }
      } else if (combinedPrice <= NEAR_DEAL_COMBINED_MAX) {
        const recentlyAlerted = await wasRecentlyAlerted(argAirport, eurAirport, combinedPrice, 24);
        if (!recentlyAlerted) {
          console.log(`    🟡 CASI OFERTA combinada: €${combinedPrice}`);
          results.nearCombinedDeals.push({
            origin: argAirport,
            destination: eurAirport,
            combinedPrice,
            outbound,
            returnFlight,
          });
        }
      }
    }
  }

  results.endTime = new Date();
  lastSearchTime = results.endTime;

  // Eliminar duplicados y ordenar
  results.oneWayDeals = removeDuplicatesAndSort(results.oneWayDeals);
  results.outboundDeals = removeDuplicatesAndSort(results.outboundDeals);
  results.returnDeals = removeDuplicatesAndSort(results.returnDeals);
  results.europeDeals = removeDuplicatesAndSort(results.europeDeals || []);
  results.combinedDeals = results.combinedDeals.sort((a, b) => a.combinedPrice - b.combinedPrice);
  results.nearCombinedDeals = results.nearCombinedDeals.sort((a, b) => a.combinedPrice - b.combinedPrice);

  totalDealsFound += results.oneWayDeals.length + results.combinedDeals.length + results.europeDeals.length;

  // Mostrar resumen
  const duration = (results.endTime - results.startTime) / 1000;
  const successfulSearches = results.allSearches.filter(s => s.success).length;
  const failedSearches = results.errors.length;

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN');
  console.log('='.repeat(60));
  console.log(`✅ Búsquedas exitosas: ${successfulSearches}/${results.allSearches.length}`);
  if (failedSearches > 0) console.log(`❌ Errores: ${failedSearches}`);
  if (results.oneWayDeals.length > 0)    console.log(`🔥 Ofertas SCL→SYD: ${results.oneWayDeals.length}`);
  if (results.europeDeals.length > 0)    console.log(`🔥 Ofertas Europa interna: ${results.europeDeals.length}`);
  if (results.outboundDeals.length > 0)  console.log(`🔥 Tramos IDA baratos: ${results.outboundDeals.length}`);
  if (results.returnDeals.length > 0)    console.log(`🔥 Tramos VUELTA baratos: ${results.returnDeals.length}`);
  console.log(`🔥 Combinados oferta: ${results.combinedDeals.length}`);
  console.log(`🟡 Combinados casi-oferta: ${results.nearCombinedDeals.length}`);
  console.log(`⏱️ Duración: ${duration.toFixed(1)}s`);

  if (results.combinedDeals.length > 0) {
    console.log('\n🎯 TOP COMBINADOS IDA+VUELTA:');
    results.combinedDeals.slice(0, 5).forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.origin}↔${d.destination}: €${d.combinedPrice} total (IDA €${d.outbound.price} + VUELTA €${d.returnFlight.price})`);
    });
  }

  if (results.oneWayDeals.length > 0) {
    console.log('\n🎯 TOP SCL→SYD:');
    results.oneWayDeals.slice(0, 5).forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.routeName}: €${d.price} (${d.airline})`);
    });
  }

  // Enviar reporte a Telegram SOLO SI HAY OFERTAS (anti-spam)
  if (notifyDeals && isActive()) {
    const hasDeals = results.oneWayDeals.length > 0 || results.combinedDeals.length > 0 || results.europeDeals.length > 0;
    if (hasDeals) {
      await sendDealsReport(results.oneWayDeals, results.combinedDeals, results.outboundDeals, results.returnDeals, results.europeDeals);
      console.log('📱 Notificación Telegram enviada con ofertas');
    } else {
      console.log('📴 Sin ofertas - no se envía notificación (anti-spam)');
    }

    // Construir resumen de búsquedas para mostrar en alerta
    const ezeSearches = results.allSearches.filter(s => s.origin === 'EZE');
    const corSearches = results.allSearches.filter(s => s.origin === 'COR');
    const sclSearches = results.allSearches.filter(s => s.origin === 'SCL');
    const eurSearches = results.allSearches.filter(s => EUROPE_AIRPORTS_ACTIVE.includes(s.origin));
    const searchSummary = {
      ezeSearched: ezeSearches.length > 0,
      ezeTotal: ezeSearches.length,
      ezeSuccess: ezeSearches.filter(s => s.success).length,
      corSearched: corSearches.length > 0,
      corTotal: corSearches.length,
      corSuccess: corSearches.filter(s => s.success).length,
      sclSearched: sclSearches.length > 0,
      sclTotal: sclSearches.length,
      sclSuccess: sclSearches.filter(s => s.success).length,
      eurSearched: eurSearches.length > 0,
      eurTotal: eurSearches.length,
      eurSuccess: eurSearches.filter(s => s.success).length,
    };

    // Enviar alerta aparte para "casi ofertas" combinadas
    if (results.nearCombinedDeals.length > 0) {
      await sendNearDealAlert(results.nearCombinedDeals, searchSummary);
      console.log('📱 Alerta "Casi Oferta" enviada a Telegram');
    }
  }

  // Guardar en base de datos
  await saveDealsToDatabase(results.oneWayDeals);
  await saveDealsToDatabase(results.europeDeals);
  await saveDealsToDatabase(results.outboundDeals);
  await saveDealsToDatabase(results.returnDeals);
  await saveCombinedDealsToDatabase(results.combinedDeals);
  await saveCombinedDealsToDatabase(results.nearCombinedDeals);

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
 * Guarda deals combinados (IDA + VUELTA) en la base de datos
 */
async function saveCombinedDealsToDatabase(combinedDeals) {
  for (const deal of combinedDeals) {
    try {
      // Guardar tramo IDA
      await run(
        `INSERT INTO flight_prices (route_id, origin, destination, airline, price, source, booking_url, departure_date, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          `${deal.origin}-${deal.destination}-combined`,
          deal.origin,
          deal.destination,
          deal.outbound.airline,
          deal.combinedPrice,
          deal.outbound.source || 'combined',
          deal.outbound.bookingUrl,
          deal.outbound.departureDate,
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
  console.log(`   • IDA Argentina→Europa: ≤€${ONE_WAY_OUTBOUND_THRESHOLD} | VUELTA Europa→Argentina: ≤€${ONE_WAY_RETURN_THRESHOLD}`);
  console.log(`   • Combinado IDA+VUELTA: ≤€${COMBINED_DEAL_THRESHOLD} (gran) / ≤€${COMBINED_GOOD_THRESHOLD} (buena)`);
  console.log(`   • Casi oferta combinada: €${NEAR_DEAL_COMBINED_MIN}-€${NEAR_DEAL_COMBINED_MAX}`);
  console.log(`   • Solo ida Chile→Oceanía: ≤€${ONE_WAY_THRESHOLDS.chileToOceania}`);
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
      outbound: ONE_WAY_OUTBOUND_THRESHOLD,
      return: ONE_WAY_RETURN_THRESHOLD,
      combinedDeal: COMBINED_DEAL_THRESHOLD,
      combinedGood: COMBINED_GOOD_THRESHOLD,
      chileOceania: ONE_WAY_THRESHOLDS.chileToOceania,
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
  buildSearchPlan,
  MONITORED_ROUTES,
  ONE_WAY_THRESHOLDS,
  ONE_WAY_OUTBOUND_THRESHOLD,
  ONE_WAY_RETURN_THRESHOLD,
  COMBINED_DEAL_THRESHOLD,
  COMBINED_GOOD_THRESHOLD,
  NEAR_DEAL_COMBINED_MIN,
  NEAR_DEAL_COMBINED_MAX,
  // Compat aliases
  ROUND_TRIP_THRESHOLD,
  NEAR_DEAL_RT_MIN,
  NEAR_DEAL_RT_MAX,
};
