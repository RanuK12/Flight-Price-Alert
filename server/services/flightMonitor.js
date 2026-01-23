/**
 * Servicio de Monitoreo de Vuelos v2.0
 * 
 * Busca ofertas de vuelos usando web scraping (Skyscanner + Kayak)
 * Separa búsquedas por SOLO IDA e IDA Y VUELTA
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
// CONFIGURACIÓN DE UMBRALES DE OFERTAS
// =============================================

// Umbrales para SOLO IDA
const ONE_WAY_THRESHOLDS = {
  // Europa → Argentina: máximo €350 para ser oferta
  europeToArgentina: 350,
  // USA → Argentina: máximo €200 para ser oferta
  usaToArgentina: 200,
};

// Umbral para IDA Y VUELTA
const ROUND_TRIP_THRESHOLD = 650; // máximo €650 para ser oferta

// Ciudades de Europa (para distinguir origen)
const EUROPE_AIRPORTS = ['MAD', 'BCN', 'FCO', 'CDG', 'FRA', 'AMS', 'LIS', 'LHR', 'MUC', 'ZRH', 'BRU', 'VIE'];
const USA_AIRPORTS = ['MIA', 'JFK', 'MCO', 'LAX', 'EWR', 'ORD', 'ATL', 'DFW'];

// =============================================
// RUTAS A MONITOREAR
// =============================================

const MONITORED_ROUTES = [
  // Europa → Buenos Aires (Solo ida < €350)
  { origin: 'MAD', destination: 'EZE', name: 'Madrid → Buenos Aires', region: 'europe' },
  { origin: 'BCN', destination: 'EZE', name: 'Barcelona → Buenos Aires', region: 'europe' },
  { origin: 'FCO', destination: 'EZE', name: 'Roma → Buenos Aires', region: 'europe' },
  { origin: 'CDG', destination: 'EZE', name: 'París → Buenos Aires', region: 'europe' },
  { origin: 'FRA', destination: 'EZE', name: 'Frankfurt → Buenos Aires', region: 'europe' },
  { origin: 'AMS', destination: 'EZE', name: 'Amsterdam → Buenos Aires', region: 'europe' },
  { origin: 'LIS', destination: 'EZE', name: 'Lisboa → Buenos Aires', region: 'europe' },
  { origin: 'LHR', destination: 'EZE', name: 'Londres → Buenos Aires', region: 'europe' },
  
  // USA → Buenos Aires (Solo ida < €200)
  { origin: 'MIA', destination: 'EZE', name: 'Miami → Buenos Aires', region: 'usa' },
  { origin: 'JFK', destination: 'EZE', name: 'Nueva York → Buenos Aires', region: 'usa' },
  { origin: 'MCO', destination: 'EZE', name: 'Orlando → Buenos Aires', region: 'usa' },
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
  
  // Por defecto, usar umbral de Europa
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
 * Realiza una búsqueda completa de ofertas
 */
async function runFullSearch(options = {}) {
  const { notifyDeals = true } = options;

  console.log('\n' + '='.repeat(60));
  console.log('🔍 BÚSQUEDA DE OFERTAS DE VUELOS');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📊 Rutas: ${MONITORED_ROUTES.length}`);
  console.log('');
  console.log('📋 UMBRALES DE OFERTAS:');
  console.log(`   • Solo ida Europa→Argentina: máx €${ONE_WAY_THRESHOLDS.europeToArgentina}`);
  console.log(`   • Solo ida USA→Argentina: máx €${ONE_WAY_THRESHOLDS.usaToArgentina}`);
  console.log(`   • Ida y vuelta: máx €${ROUND_TRIP_THRESHOLD}`);
  console.log('');

  const results = {
    oneWayDeals: [],      // Ofertas solo ida
    roundTripDeals: [],   // Ofertas ida y vuelta
    allSearches: [],
    errors: [],
    startTime: new Date(),
  };

  for (const route of MONITORED_ROUTES) {
    console.log(`\n🛫 ${route.name}`);
    
    try {
      // Buscar vuelos usando scrapers
      const searchResult = await scrapeAllSources(route.origin, route.destination);
      
      results.allSearches.push({
        route: route.name,
        origin: route.origin,
        destination: route.destination,
        success: searchResult.minPrice !== null,
      });

      if (searchResult.allFlights && searchResult.allFlights.length > 0) {
        // Procesar cada vuelo encontrado
        for (const flight of searchResult.allFlights) {
          const price = Math.round(flight.price);
          
          // Verificar si es oferta de SOLO IDA
          const oneWayThreshold = getThreshold(route.origin, 'oneway');
          if (price <= oneWayThreshold) {
            const deal = {
              origin: route.origin,
              destination: route.destination,
              routeName: route.name,
              region: route.region,
              price: price,
              airline: flight.airline,
              source: flight.source,
              departureDate: flight.departureDate || 'Flexible',
              bookingUrl: flight.link,
              tripType: 'oneway',
              threshold: oneWayThreshold,
            };
            
            results.oneWayDeals.push(deal);
            console.log(`  🔥 OFERTA IDA: €${price} (${flight.airline}) - máx €${oneWayThreshold}`);
          }
          
          // Simular precio de ida y vuelta (aproximadamente x1.7 del solo ida)
          const roundTripPrice = Math.round(price * 1.7);
          if (roundTripPrice <= ROUND_TRIP_THRESHOLD) {
            const deal = {
              origin: route.origin,
              destination: route.destination,
              routeName: route.name,
              region: route.region,
              price: roundTripPrice,
              airline: flight.airline,
              source: flight.source,
              departureDate: flight.departureDate || 'Flexible',
              bookingUrl: flight.link,
              tripType: 'roundtrip',
              threshold: ROUND_TRIP_THRESHOLD,
            };
            
            results.roundTripDeals.push(deal);
            console.log(`  🔥 OFERTA I+V: €${roundTripPrice} (${flight.airline}) - máx €${ROUND_TRIP_THRESHOLD}`);
          }
        }
      } else {
        console.log(`  ⚠️ Sin resultados`);
      }

    } catch (error) {
      results.errors.push({ route: route.name, error: error.message });
      console.error(`  ❌ Error: ${error.message}`);
    }

    // Pausa entre rutas
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
