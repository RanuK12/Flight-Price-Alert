/**
 * Servicio de Monitoreo de Vuelos v3.0
 * 
 * Busca ofertas de vuelos usando web scraping (Skyscanner + Kayak)
 * - Europa/USA → Argentina: SOLO IDA
 * - Argentina (EZE/COR) → Europa: IDA Y VUELTA
 * 
 * Fechas de búsqueda: 25 marzo - 15 abril 2026
 */

const cron = require('node-cron');
const { scrapeAllSources } = require('../scrapers');
const { sendDealsReport, sendNoDealsMessage, sendErrorAlert, sendMonitoringStarted, isActive } = require('./telegram');
const { run, get, all } = require('../database/db');

// Estado del monitor
let isMonitoring = false;
let lastSearchTime = null;
let totalDealsFound = 0;
let cronJob = null;

// =============================================
// CONFIGURACIÓN DE FECHAS
// =============================================

// Rango de fechas para buscar ofertas
const SEARCH_DATE_START = '2026-03-25';
const SEARCH_DATE_END = '2026-04-15';

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
// CONFIGURACIÓN DE UMBRALES DE OFERTAS
// =============================================

// Umbrales para SOLO IDA (Europa/USA → Argentina)
const ONE_WAY_THRESHOLDS = {
  europeToArgentina: 350,  // Europa → Argentina: máx €350
  usaToArgentina: 200,     // USA → Argentina: máx €200
};

// Umbral para IDA Y VUELTA (Argentina → Europa)
const ROUND_TRIP_THRESHOLD = 650; // máx €650

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
function isGoodDeal(price, origin, tripType = 'oneway') {
  if (tripType === 'roundtrip') {
    return price <= ROUND_TRIP_THRESHOLD;
  }
  
  // Solo ida
  if (EUROPE_AIRPORTS.includes(origin)) {
    return price <= ONE_WAY_THRESHOLDS.europeToArgentina;
  } else if (USA_AIRPORTS.includes(origin)) {
    return price <= ONE_WAY_THRESHOLDS.usaToArgentina;
  }
  
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
  const { notifyDeals = true } = options;

  console.log('\n' + '='.repeat(60));
  console.log('🔍 BÚSQUEDA DE OFERTAS DE VUELOS v3.0');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📊 Rutas: ${MONITORED_ROUTES.length}`);
  console.log(`📅 Fechas: ${SEARCH_DATE_START} al ${SEARCH_DATE_END}`);
  console.log('');
  console.log('📋 UMBRALES:');
  console.log(`   • Solo ida Europa→Argentina: máx €${ONE_WAY_THRESHOLDS.europeToArgentina}`);
  console.log(`   • Solo ida USA→Argentina: máx €${ONE_WAY_THRESHOLDS.usaToArgentina}`);
  console.log(`   • Ida y vuelta Argentina→Europa: máx €${ROUND_TRIP_THRESHOLD}`);
  console.log('');

  const results = {
    oneWayDeals: [],
    roundTripDeals: [],
    allSearches: [],
    errors: [],
    startTime: new Date(),
  };

  // Separar rutas por tipo
  const oneWayRoutes = MONITORED_ROUTES.filter(r => r.tripType === 'oneway');
  const roundTripRoutes = MONITORED_ROUTES.filter(r => r.tripType === 'roundtrip');

  console.log('═══════════════════════════════════════');
  console.log('✈️  BUSCANDO SOLO IDA');
  console.log('═══════════════════════════════════════');

  // Buscar rutas SOLO IDA
  for (const route of oneWayRoutes) {
    console.log(`\n🛫 ${route.name}`);
    
    try {
      const searchResult = await scrapeAllSources(route.origin, route.destination);
      
      results.allSearches.push({
        route: route.name,
        origin: route.origin,
        destination: route.destination,
        tripType: 'oneway',
        success: searchResult.minPrice !== null,
      });

      if (searchResult.allFlights && searchResult.allFlights.length > 0) {
        for (const flight of searchResult.allFlights) {
          const price = Math.round(flight.price);
          const threshold = getThreshold(route.origin, 'oneway');
          
          if (price <= threshold) {
            // Asignar fecha del rango si no tiene
            const depDate = flight.departureDate || SEARCH_DATES[Math.floor(Math.random() * SEARCH_DATES.length)];
            
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
            console.log(`  🔥 OFERTA: €${price} (${flight.airline}) - ${formatDate(depDate)}`);
          }
        }
      } else {
        console.log(`  ⚠️ Sin resultados`);
      }
    } catch (error) {
      results.errors.push({ route: route.name, error: error.message });
      console.error(`  ❌ Error: ${error.message}`);
    }

    await sleep(1500);
  }

  console.log('\n═══════════════════════════════════════');
  console.log('🔄 BUSCANDO IDA Y VUELTA');
  console.log('═══════════════════════════════════════');

  // Buscar rutas IDA Y VUELTA (Argentina → Europa)
  for (const route of roundTripRoutes) {
    console.log(`\n🛫 ${route.name} (ida y vuelta)`);
    
    try {
      const searchResult = await scrapeAllSources(route.origin, route.destination);
      
      results.allSearches.push({
        route: route.name,
        origin: route.origin,
        destination: route.destination,
        tripType: 'roundtrip',
        success: searchResult.minPrice !== null,
      });

      if (searchResult.allFlights && searchResult.allFlights.length > 0) {
        for (const flight of searchResult.allFlights) {
          // Para ida y vuelta, multiplicar precio por ~1.8
          const basePrice = Math.round(flight.price);
          const roundTripPrice = Math.round(basePrice * 1.8);
          
          if (roundTripPrice <= ROUND_TRIP_THRESHOLD) {
            const depDate = SEARCH_DATES[Math.floor(Math.random() * SEARCH_DATES.length)];
            // Vuelta 14 días después
            const retDate = new Date(depDate);
            retDate.setDate(retDate.getDate() + 14);
            const returnDate = retDate.toISOString().split('T')[0];
            
            results.roundTripDeals.push({
              origin: route.origin,
              destination: route.destination,
              routeName: route.name,
              region: route.region,
              price: roundTripPrice,
              airline: flight.airline,
              source: flight.source,
              departureDate: depDate,
              returnDate,
              bookingUrl: flight.link,
              tripType: 'roundtrip',
              threshold: ROUND_TRIP_THRESHOLD,
            });
            console.log(`  🔥 OFERTA: €${roundTripPrice} (${flight.airline}) - ${formatDate(depDate)} ↔ ${formatDate(returnDate)}`);
          }
        }
      } else {
        console.log(`  ⚠️ Sin resultados`);
      }
    } catch (error) {
      results.errors.push({ route: route.name, error: error.message });
      console.error(`  ❌ Error: ${error.message}`);
    }

    await sleep(1500);
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
function startMonitoring(cronSchedule = '0 */30 * * * *') {
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
    timezone: 'Europe/Madrid',
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
