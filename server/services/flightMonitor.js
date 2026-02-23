/**
 * Servicio de Monitoreo de Vuelos v6.0
 *
 * Scrapers: Puppeteer (Google Flights) + Ryanair API
 *
 * Rutas monitoreadas:
 * - Ethiopian: EZE → FCO roundtrip (23 mar → 7 abr 2026)
 * - Chile → Oceanía: SCL → SYD solo ida (junio 2026)
 * - Europa interna (solo ida):
 *   FCO→AMS (24-30 mar), AMS→MAD (31 mar-4 abr), AMS→BCN (31 mar-4 abr),
 *   MAD→FCO (31 mar-4 abr), BCN→FCO (31 mar-4 abr),
 *   MAD→VCE (31 mar-4 abr), BCN→VCE (31 mar-4 abr)
 */

const cron = require('node-cron');
const { scrapeAllSources } = require('../scrapers');
const { sendDealsReport, sendErrorAlert, sendNearDealAlert, isActive } = require('./telegram');
const { run, get, all, wasRecentlyAlerted, isNewHistoricalLow } = require('../database/db');

// Estado del monitor
let isMonitoring = false;
let lastSearchTime = null;
let totalDealsFound = 0;
let cronJob = null;

// =============================================
// CONFIG: TIMEZONE
// =============================================
const MONITOR_TIMEZONE = process.env.MONITOR_TIMEZONE || 'Europe/Rome';

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// =============================================
// CONFIGURACIÓN DE FECHAS
// =============================================

// Ethiopian EZE → Roma roundtrip (fecha fija)
const ETHIOPIAN_DEPARTURE = '2026-03-23';
const ETHIOPIAN_RETURN = '2026-04-07';

// Cuántas fechas buscar por ruta en cada corrida
const DATES_PER_ROUTE = 2;

// Generar fechas de búsqueda (diario para rangos cortos europeos)
function generateSearchDatesRange(startStr, endStr) {
  const dates = [];
  const start = new Date(startStr);
  const end = new Date(endStr);
  let current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// =============================================
// Construir plan de búsqueda
// =============================================

function buildSearchPlan() {
  return [...MONITORED_ROUTES];
}

/**
 * Devuelve fechas para una ruta. Rota según el día del mes para variar cobertura.
 */
function pickDatesForRoute(route, count = DATES_PER_ROUTE) {
  const searchDates = (route.dateStart && route.dateEnd)
    ? generateSearchDatesRange(route.dateStart, route.dateEnd)
    : [route.dateStart || ETHIOPIAN_DEPARTURE];

  if (searchDates.length <= count) return searchDates;

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

// Ethiopian EZE → FCO (roundtrip)
const RT_TICKET_THRESHOLD = 850;   // ≤€850 = oferta
const NEAR_RT_MIN = 850;           // Casi oferta desde €850
const NEAR_RT_MAX = 1050;          // Casi oferta hasta €1050

// Chile → Oceanía (solo ida, junio)
const ONE_WAY_THRESHOLDS = {
  chileToOceania: 800,
  chileToOceaniaNeardeal: 1050,
};

// Vuelos internos Europa (solo ida, incluye Ryanair/low-cost)
// Basado en investigación de precios reales feb-2026
const EUROPE_INTERNAL_THRESHOLDS = {
  'FCO-AMS': { deal: 70,  nearDeal: 100 },  // Roma → Ámsterdam
  'AMS-MAD': { deal: 80,  nearDeal: 120 },  // Ámsterdam → Madrid
  'AMS-BCN': { deal: 60,  nearDeal: 90  },  // Ámsterdam → Barcelona
  'MAD-FCO': { deal: 30,  nearDeal: 60  },  // Madrid → Roma (Ryanair desde €22)
  'BCN-FCO': { deal: 25,  nearDeal: 50  },  // Barcelona → Roma (Ryanair desde €20)
  'MAD-VCE': { deal: 30,  nearDeal: 65  },  // Madrid → Venecia (Ryanair desde €19)
  'BCN-VCE': { deal: 20,  nearDeal: 45  },  // Barcelona → Venecia (Ryanair desde €15)
};

// Compat aliases
const ROUND_TRIP_THRESHOLD = RT_TICKET_THRESHOLD;
const NEAR_DEAL_RT_MIN = NEAR_RT_MIN;
const NEAR_DEAL_RT_MAX = NEAR_RT_MAX;

// Aeropuertos por región
const EUROPE_AIRPORTS = ['MAD', 'BCN', 'FCO', 'CDG', 'FRA', 'AMS', 'LIS', 'LHR', 'MUC', 'ZRH', 'BRU', 'VIE', 'VCE'];
const CHILE_AIRPORTS = ['SCL'];
const OCEANIA_AIRPORTS = ['SYD', 'MEL', 'AKL'];

// =============================================
// RUTAS A MONITOREAR (9 rutas)
// =============================================

const MONITORED_ROUTES = [
  // ===== ETHIOPIAN: EZE → Roma (roundtrip, fecha fija 23 mar → 7 abr) =====
  { origin: 'EZE', destination: 'FCO', name: 'Buenos Aires → Roma (Ethiopian)', region: 'ethiopian', tripType: 'roundtrip', tripDirection: 'roundtrip', dateStart: '2026-03-23', dateEnd: '2026-03-23' },

  // ===== SOLO IDA: Chile → Oceanía (junio 2026) =====
  { origin: 'SCL', destination: 'SYD', name: 'Santiago → Sídney', region: 'chile_oceania', tripType: 'oneway', tripDirection: null, dateStart: '2026-06-01', dateEnd: '2026-06-30' },

  // ===== EUROPA INTERNA — solo ida =====
  { origin: 'FCO', destination: 'AMS', name: 'Roma → Ámsterdam', region: 'europe_internal', tripType: 'oneway', tripDirection: null, dateStart: '2026-03-24', dateEnd: '2026-03-30' },
  { origin: 'AMS', destination: 'MAD', name: 'Ámsterdam → Madrid', region: 'europe_internal', tripType: 'oneway', tripDirection: null, dateStart: '2026-03-31', dateEnd: '2026-04-04' },
  { origin: 'AMS', destination: 'BCN', name: 'Ámsterdam → Barcelona', region: 'europe_internal', tripType: 'oneway', tripDirection: null, dateStart: '2026-03-31', dateEnd: '2026-04-04' },
  { origin: 'MAD', destination: 'FCO', name: 'Madrid → Roma', region: 'europe_internal', tripType: 'oneway', tripDirection: null, dateStart: '2026-03-31', dateEnd: '2026-04-04' },
  { origin: 'BCN', destination: 'FCO', name: 'Barcelona → Roma', region: 'europe_internal', tripType: 'oneway', tripDirection: null, dateStart: '2026-03-31', dateEnd: '2026-04-04' },
  { origin: 'MAD', destination: 'VCE', name: 'Madrid → Venecia', region: 'europe_internal', tripType: 'oneway', tripDirection: null, dateStart: '2026-03-31', dateEnd: '2026-04-04' },
  { origin: 'BCN', destination: 'VCE', name: 'Barcelona → Venecia', region: 'europe_internal', tripType: 'oneway', tripDirection: null, dateStart: '2026-03-31', dateEnd: '2026-04-04' },
];

/**
 * Obtiene el umbral de oferta para una ruta
 */
function getThreshold(origin, destination) {
  if (CHILE_AIRPORTS.includes(origin) && OCEANIA_AIRPORTS.includes(destination)) {
    return ONE_WAY_THRESHOLDS.chileToOceania;
  }
  const euroKey = `${origin}-${destination}`;
  if (EUROPE_INTERNAL_THRESHOLDS[euroKey]) {
    return EUROPE_INTERNAL_THRESHOLDS[euroKey].deal;
  }
  return 999;
}

/**
 * Obtiene el umbral de "casi oferta" para una ruta
 */
function getNearDealThreshold(origin, destination) {
  if (CHILE_AIRPORTS.includes(origin) && OCEANIA_AIRPORTS.includes(destination)) {
    return ONE_WAY_THRESHOLDS.chileToOceaniaNeardeal;
  }
  const euroKey = `${origin}-${destination}`;
  if (EUROPE_INTERNAL_THRESHOLDS[euroKey]) {
    return EUROPE_INTERNAL_THRESHOLDS[euroKey].nearDeal;
  }
  return 999;
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
  const { notifyDeals = true } = options;

  console.log('\n' + '='.repeat(60));
  console.log('🔍 BÚSQUEDA DE OFERTAS DE VUELOS v6.0');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📊 Rutas: ${MONITORED_ROUTES.length}`);
  console.log(`🕒 Timezone: ${MONITOR_TIMEZONE}`);
  console.log(`🖥️ Scrapers: Puppeteer (Google Flights) + Ryanair API`);
  console.log('');
  console.log('📋 UMBRALES:');
  console.log(`   • Ethiopian EZE→FCO RT: ≤€${RT_TICKET_THRESHOLD} oferta | €${NEAR_RT_MIN}-€${NEAR_RT_MAX} casi oferta`);
  console.log(`   • Chile→Oceanía solo ida: ≤€${ONE_WAY_THRESHOLDS.chileToOceania}`);
  console.log('   • Europa interna (solo ida):');
  for (const [key, val] of Object.entries(EUROPE_INTERNAL_THRESHOLDS)) {
    console.log(`     ${key}: ≤€${val.deal} oferta | ≤€${val.nearDeal} casi oferta`);
  }
  console.log('');

  const results = {
    roundTripDeals: [],     // Ethiopian EZE→FCO RT ≤€850
    nearRoundTripDeals: [], // Ethiopian RT €850-€1050
    oneWayDeals: [],        // SCL→SYD solo ida ≤€800
    europeDeals: [],        // Europa interna (ofertas)
    nearEuropeDeals: [],    // Europa interna (casi ofertas)
    allSearches: [],
    errors: [],
    startTime: new Date(),
  };

  const plan = buildSearchPlan();
  const ethiopianRoutes = plan.filter(r => r.region === 'ethiopian');
  const sclRoutes = plan.filter(r => r.region === 'chile_oceania');
  const europeIntRoutes = plan.filter(r => r.region === 'europe_internal');

  console.log('═══════════════════════════════════════');
  console.log(`✈️  BUSCANDO: ${plan.length} rutas`);
  console.log(`   Ethiopian EZE→FCO RT: ${ethiopianRoutes.length} ruta (23 mar ↔ 7 abr)`);
  console.log(`   SCL→SYD: ${sclRoutes.length} ruta × ~${DATES_PER_ROUTE} fechas`);
  console.log(`   Europa interna: ${europeIntRoutes.length} rutas × ~${DATES_PER_ROUTE} fechas`);
  console.log('═══════════════════════════════════════');

  // Ejecutar búsqueda para cada ruta y sus fechas
  for (const route of plan) {
    const dates = pickDatesForRoute(route, DATES_PER_ROUTE);

    for (const departureDate of dates) {
      const isRoundTrip = route.tripType === 'roundtrip';
      const dirLabel = isRoundTrip ? '(ida+vuelta)' : '(solo ida)';
      console.log(`\n🛫 ${route.name} ${dirLabel}`);
      console.log(`   📅 ${departureDate}${isRoundTrip ? ` ↔ ${ETHIOPIAN_RETURN}` : ''}`);

      try {
        const searchResult = await scrapeAllSources(
          route.origin,
          route.destination,
          isRoundTrip,
          departureDate,
          isRoundTrip ? ETHIOPIAN_RETURN : undefined
        );

        results.allSearches.push({
          route: route.name,
          origin: route.origin,
          destination: route.destination,
          date: departureDate,
          success: searchResult.minPrice !== null,
        });

        if (searchResult.allFlights && searchResult.allFlights.length > 0) {
          for (const flight of searchResult.allFlights) {
            const price = Math.round(flight.price);
            const depDate = flight.departureDate || departureDate;

            // Validación de precios realistas
            // Europa interna puede ser desde €10 (Ryanair), intercontinental desde €250
            const minRealistic = isRoundTrip ? 250 : (route.region === 'europe_internal' ? 8 : 150);
            if (price < minRealistic || price > 5000) {
              console.log(`  ⚠️ Precio irreal ignorado: €${price}`);
              continue;
            }

            // ─────────────────────────────────────────────────────────
            // ROUNDTRIP: Ethiopian EZE → FCO
            // ─────────────────────────────────────────────────────────
            if (isRoundTrip) {
              const retDate = flight.returnDate || ETHIOPIAN_RETURN;
              if (price <= RT_TICKET_THRESHOLD) {
                const recentlyAlerted = await wasRecentlyAlerted(route.origin, route.destination, price, 24);
                if (!recentlyAlerted) {
                  results.roundTripDeals.push({
                    origin: route.origin, destination: route.destination,
                    routeName: route.name, region: route.region,
                    price, airline: flight.airline, source: flight.source,
                    departureDate: depDate, returnDate: retDate,
                    bookingUrl: flight.link, tripType: 'roundtrip',
                  });
                  console.log(`  🔥 OFERTA RT: €${price} (${flight.airline}) ${formatDate(depDate)} ↔ ${formatDate(retDate)}`);
                } else {
                  console.log(`  🔕 €${price} RT ya alertado (anti-spam)`);
                }
              } else if (price <= NEAR_RT_MAX) {
                const recentlyAlerted = await wasRecentlyAlerted(route.origin, route.destination, price, 24);
                if (!recentlyAlerted) {
                  results.nearRoundTripDeals.push({
                    origin: route.origin, destination: route.destination,
                    routeName: route.name, price, airline: flight.airline,
                    departureDate: depDate, returnDate: retDate,
                    bookingUrl: flight.link, tripType: 'roundtrip',
                  });
                  console.log(`  🟡 CASI OFERTA RT: €${price} (${flight.airline})`);
                }
              } else {
                console.log(`  ✈️ RT €${price} (${flight.airline}) - no oferta (máx €${RT_TICKET_THRESHOLD})`);
              }
              continue;
            }

            // ─────────────────────────────────────────────────────────
            // ONE-WAY: Europa interna y SCL→SYD
            // ─────────────────────────────────────────────────────────
            const threshold = getThreshold(route.origin, route.destination);
            const nearThreshold = getNearDealThreshold(route.origin, route.destination);

            if (price <= threshold) {
              const recentlyAlerted = await wasRecentlyAlerted(route.origin, route.destination, price, 24);
              if (!recentlyAlerted) {
                const dealEntry = {
                  origin: route.origin, destination: route.destination,
                  routeName: route.name, region: route.region,
                  price, airline: flight.airline, source: flight.source,
                  departureDate: depDate, bookingUrl: flight.link,
                  tripType: 'oneway', threshold,
                };
                if (route.region === 'chile_oceania') {
                  results.oneWayDeals.push(dealEntry);
                  console.log(`  🔥 OFERTA SCL→SYD: €${price} (${flight.airline}) - ${formatDate(depDate)}`);
                } else {
                  results.europeDeals.push(dealEntry);
                  console.log(`  🔥 OFERTA EUR: €${price} (${flight.airline}) ${route.origin}→${route.destination} - ${formatDate(depDate)}`);
                }
              } else {
                console.log(`  🔕 €${price} ya alertado (anti-spam)`);
              }
            } else if (price <= nearThreshold) {
              console.log(`  🟡 CASI OFERTA: €${price} (${flight.airline}) ${route.origin}→${route.destination} - ${formatDate(depDate)}`);
              results.nearEuropeDeals.push({
                origin: route.origin, destination: route.destination,
                routeName: route.name, region: route.region,
                price, airline: flight.airline,
                departureDate: depDate, bookingUrl: flight.link,
              });
            } else {
              console.log(`  ✈️ €${price} (${flight.airline}) - umbral oferta €${threshold}`);
            }
          }
        } else {
          console.log(`  ⚠️ Sin precios reales encontrados`);
        }
      } catch (error) {
        results.errors.push({ route: route.name, error: error.message });
        console.error(`  ❌ Error: ${error.message}`);
      }

      await sleep(1500); // pausa anti-detección
    }
  }

  results.endTime = new Date();
  lastSearchTime = results.endTime;

  // Deduplicar y ordenar
  results.roundTripDeals = removeDuplicatesAndSort(results.roundTripDeals);
  results.nearRoundTripDeals = removeDuplicatesAndSort(results.nearRoundTripDeals);
  results.oneWayDeals = removeDuplicatesAndSort(results.oneWayDeals);
  results.europeDeals = removeDuplicatesAndSort(results.europeDeals);
  results.nearEuropeDeals = removeDuplicatesAndSort(results.nearEuropeDeals);

  totalDealsFound += results.roundTripDeals.length + results.oneWayDeals.length + results.europeDeals.length;

  // ═══════════════════════════════════════════════════════════════
  // RESUMEN
  // ═══════════════════════════════════════════════════════════════
  const duration = (results.endTime - results.startTime) / 1000;
  const successfulSearches = results.allSearches.filter(s => s.success).length;

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN');
  console.log('='.repeat(60));
  console.log(`✅ Búsquedas exitosas: ${successfulSearches}/${results.allSearches.length}`);
  if (results.errors.length > 0) console.log(`❌ Errores: ${results.errors.length}`);
  if (results.roundTripDeals.length > 0) console.log(`🔥 Ethiopian RT ofertas: ${results.roundTripDeals.length}`);
  if (results.nearRoundTripDeals.length > 0) console.log(`🟡 Ethiopian RT casi-oferta: ${results.nearRoundTripDeals.length}`);
  if (results.europeDeals.length > 0) console.log(`🔥 Europa interna ofertas: ${results.europeDeals.length}`);
  if (results.nearEuropeDeals.length > 0) console.log(`🟡 Europa interna casi-oferta: ${results.nearEuropeDeals.length}`);
  if (results.oneWayDeals.length > 0) console.log(`🔥 SCL→SYD ofertas: ${results.oneWayDeals.length}`);
  console.log(`⏱️ Duración: ${duration.toFixed(1)}s`);

  if (results.europeDeals.length > 0) {
    console.log('\n🎯 TOP EUROPA INTERNA:');
    results.europeDeals.slice(0, 7).forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.routeName}: €${d.price} (${d.airline}) - ${formatDate(d.departureDate)}`);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // NOTIFICACIONES TELEGRAM
  // ═══════════════════════════════════════════════════════════════
  if (notifyDeals && isActive()) {
    const hasDeals = results.roundTripDeals.length > 0 || results.oneWayDeals.length > 0 || results.europeDeals.length > 0;
    if (hasDeals) {
      await sendDealsReport(results.oneWayDeals, [], [], [], results.europeDeals, results.roundTripDeals);
      console.log('📱 Notificación Telegram enviada con ofertas');
    } else {
      console.log('📴 Sin ofertas - no se envía notificación (anti-spam)');
    }

    // Construir resumen de búsquedas
    const searchSummary = {
      ezeSearched: results.allSearches.some(s => s.origin === 'EZE'),
      ezeTotal: results.allSearches.filter(s => s.origin === 'EZE').length,
      ezeSuccess: results.allSearches.filter(s => s.origin === 'EZE' && s.success).length,
      sclSearched: results.allSearches.some(s => s.origin === 'SCL'),
      sclTotal: results.allSearches.filter(s => s.origin === 'SCL').length,
      sclSuccess: results.allSearches.filter(s => s.origin === 'SCL' && s.success).length,
      eurSearched: results.allSearches.some(s => ['FCO', 'AMS', 'MAD', 'BCN'].includes(s.origin)),
      eurTotal: results.allSearches.filter(s => ['FCO', 'AMS', 'MAD', 'BCN'].includes(s.origin)).length,
      eurSuccess: results.allSearches.filter(s => ['FCO', 'AMS', 'MAD', 'BCN'].includes(s.origin) && s.success).length,
    };

    // Enviar casi-ofertas
    const hasNearDeals = results.nearRoundTripDeals.length > 0 || results.nearEuropeDeals.length > 0;
    if (hasNearDeals) {
      await sendNearDealAlert(results.nearEuropeDeals, searchSummary, results.nearRoundTripDeals);
      console.log('📱 Alerta "Casi Oferta" enviada a Telegram');
    }
  }

  // Guardar en base de datos
  await saveDealsToDatabase(results.roundTripDeals);
  await saveDealsToDatabase(results.nearRoundTripDeals);
  await saveDealsToDatabase(results.oneWayDeals);
  await saveDealsToDatabase(results.europeDeals);
  await saveDealsToDatabase(results.nearEuropeDeals);

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
function startMonitoring(cronSchedule = '*/30 * * * *', timezone = 'Europe/Rome') {
  if (isMonitoring) {
    console.log('⚠️ El monitoreo ya está activo');
    return false;
  }

  console.log('\n🚀 INICIANDO MONITOREO DE VUELOS v6.0');
  console.log(`⏰ Programación: ${cronSchedule}`);
  console.log(`📊 Rutas: ${MONITORED_ROUTES.length}`);
  console.log('📋 Umbrales:');
  console.log(`   • Ethiopian EZE→FCO RT: ≤€${RT_TICKET_THRESHOLD} | casi oferta €${NEAR_RT_MIN}-€${NEAR_RT_MAX}`);
  console.log(`   • Chile→Oceanía: ≤€${ONE_WAY_THRESHOLDS.chileToOceania}`);
  console.log('   • Europa interna:');
  for (const [key, val] of Object.entries(EUROPE_INTERNAL_THRESHOLDS)) {
    console.log(`     ${key}: ≤€${val.deal} oferta | ≤€${val.nearDeal} casi oferta`);
  }
  console.log('');

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
      ethiopianRT: RT_TICKET_THRESHOLD,
      chileOceania: ONE_WAY_THRESHOLDS.chileToOceania,
      europeInternal: EUROPE_INTERNAL_THRESHOLDS,
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
  EUROPE_INTERNAL_THRESHOLDS,
  RT_TICKET_THRESHOLD,
  NEAR_RT_MIN,
  NEAR_RT_MAX,
  ROUND_TRIP_THRESHOLD,
  NEAR_DEAL_RT_MIN,
  NEAR_DEAL_RT_MAX,
};
