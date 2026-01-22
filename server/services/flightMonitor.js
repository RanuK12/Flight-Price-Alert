/**
 * Servicio de Monitoreo de Vuelos
 * 
 * Busca ofertas de vuelos usando web scraping (Skyscanner + Kayak)
 * SIN NECESIDAD DE API DE PAGO
 */

const cron = require('node-cron');
const { scrapeAllSources } = require('../scrapers');
const { sendDealAlert, sendSearchSummary, sendErrorAlert, sendMonitoringStarted, isActive } = require('./telegram');
const { run, get, all } = require('../database/db');

// Estado del monitor
let isMonitoring = false;
let lastSearchTime = null;
let totalDealsFound = 0;
let cronJob = null;

// Rutas a monitorear (Europa/USA → Argentina)
const MONITORED_ROUTES = [
  // Europa → Buenos Aires
  { origin: 'MAD', destination: 'EZE', name: 'Madrid → Buenos Aires', referencePrice: 700 },
  { origin: 'BCN', destination: 'EZE', name: 'Barcelona → Buenos Aires', referencePrice: 750 },
  { origin: 'FCO', destination: 'EZE', name: 'Roma → Buenos Aires', referencePrice: 750 },
  { origin: 'CDG', destination: 'EZE', name: 'París → Buenos Aires', referencePrice: 800 },
  { origin: 'FRA', destination: 'EZE', name: 'Frankfurt → Buenos Aires', referencePrice: 700 },
  { origin: 'AMS', destination: 'EZE', name: 'Amsterdam → Buenos Aires', referencePrice: 750 },
  { origin: 'LIS', destination: 'EZE', name: 'Lisboa → Buenos Aires', referencePrice: 650 },
  
  // USA → Buenos Aires  
  { origin: 'MIA', destination: 'EZE', name: 'Miami → Buenos Aires', referencePrice: 500 },
  { origin: 'JFK', destination: 'EZE', name: 'Nueva York → Buenos Aires', referencePrice: 600 },
  { origin: 'MCO', destination: 'EZE', name: 'Orlando → Buenos Aires', referencePrice: 550 },
];

// Umbrales para clasificar ofertas
const DEAL_THRESHOLDS = {
  steal: 0.45,  // 45% menos que referencia = GANGA
  great: 0.30,  // 30% menos = MUY BUENA OFERTA
  good: 0.15,   // 15% menos = Buena oferta
};

/**
 * Analiza si un precio es una oferta
 */
function analyzePrice(price, referencePrice) {
  const discount = (referencePrice - price) / referencePrice;
  const savings = referencePrice - price;
  
  if (discount >= DEAL_THRESHOLDS.steal) {
    return {
      isDeal: true,
      dealLevel: 'steal',
      emoji: '🔥🔥🔥',
      message: `¡GANGA INCREÍBLE! Ahorras €${Math.round(savings)} (${Math.round(discount * 100)}% menos)`,
      discount,
      savings,
    };
  } else if (discount >= DEAL_THRESHOLDS.great) {
    return {
      isDeal: true,
      dealLevel: 'great',
      emoji: '🔥🔥',
      message: `¡MUY BUENA OFERTA! Ahorras €${Math.round(savings)} (${Math.round(discount * 100)}% menos)`,
      discount,
      savings,
    };
  } else if (discount >= DEAL_THRESHOLDS.good) {
    return {
      isDeal: true,
      dealLevel: 'good',
      emoji: '🔥',
      message: `Buen precio. Ahorras €${Math.round(savings)} (${Math.round(discount * 100)}% menos)`,
      discount,
      savings,
    };
  }
  
  return {
    isDeal: false,
    dealLevel: 'normal',
    emoji: '✈️',
    message: 'Precio normal',
    discount,
    savings,
  };
}

/**
 * Realiza una búsqueda completa de ofertas usando web scraping
 */
async function runFullSearch(options = {}) {
  const { notifyDeals = true, sendSummary = false } = options;

  console.log('\n' + '='.repeat(60));
  console.log('🔍 INICIANDO BÚSQUEDA DE OFERTAS (Web Scraping)');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📊 Rutas a buscar: ${MONITORED_ROUTES.length}`);
  console.log(`🌐 Fuentes: Skyscanner + Kayak`);
  console.log('');

  const results = {
    searches: [],
    deals: [],
    errors: [],
    startTime: new Date(),
    endTime: null,
  };

  for (const route of MONITORED_ROUTES) {
    console.log(`\n🛫 ${route.name}`);
    
    try {
      // Buscar usando nuestros scrapers (Skyscanner + Kayak)
      const searchResult = await scrapeAllSources(route.origin, route.destination);
      
      results.searches.push({
        route: route.name,
        success: searchResult.minPrice !== null,
        ...searchResult,
      });

      if (searchResult.minPrice && searchResult.cheapestFlight) {
        const price = Math.round(searchResult.minPrice);
        const analysis = analyzePrice(price, route.referencePrice);
        
        console.log(`  ${analysis.emoji} €${price} - ${analysis.message}`);
        
        if (analysis.isDeal) {
          const deal = {
            origin: route.origin,
            destination: route.destination,
            originCity: route.name.split(' → ')[0],
            destinationCity: route.name.split(' → ')[1],
            lowestPrice: price,
            referencePrice: route.referencePrice,
            airline: searchResult.cheapestFlight.airline,
            source: searchResult.cheapestFlight.source,
            departureDate: searchResult.cheapestFlight.departureDate || 'Flexible',
            bookingUrl: searchResult.cheapestFlight.link,
            dealLevel: analysis.dealLevel,
            discount: analysis.discount,
            savings: analysis.savings,
            foundAt: new Date().toISOString(),
          };

          results.deals.push(deal);
          totalDealsFound++;

          // Notificar por Telegram
          if (notifyDeals && isActive()) {
            await sendDealAlert(deal);
          }

          // Guardar en base de datos
          try {
            await run(
              `INSERT INTO flight_prices (route_id, origin, destination, airline, price, source, booking_url, departure_date, recorded_at) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
              [
                `${route.origin}-${route.destination}`,
                route.origin,
                route.destination,
                deal.airline,
                deal.lowestPrice,
                deal.source,
                deal.bookingUrl,
                deal.departureDate,
              ]
            );
          } catch (dbErr) {
            // Ignorar errores de duplicado
          }
        }
      } else {
        console.log(`  ⚠️ Sin resultados disponibles`);
      }

    } catch (error) {
      results.errors.push({
        route: route.name,
        error: error.message,
      });
      console.error(`  ❌ Error: ${error.message}`);
    }

    // Pausa entre rutas para no sobrecargar
    await sleep(2000);
  }

  results.endTime = new Date();
  lastSearchTime = results.endTime;

  // Resumen
  const duration = (results.endTime - results.startTime) / 1000;
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN DE BÚSQUEDA');
  console.log('='.repeat(60));
  console.log(`✅ Búsquedas exitosas: ${results.searches.filter(s => s.success).length}/${MONITORED_ROUTES.length}`);
  console.log(`🔥 Ofertas encontradas: ${results.deals.length}`);
  console.log(`⏱️ Duración: ${duration.toFixed(1)} segundos`);
  console.log('');

  if (results.deals.length > 0) {
    console.log('🎯 MEJORES OFERTAS:');
    results.deals
      .sort((a, b) => a.lowestPrice - b.lowestPrice)
      .slice(0, 10)
      .forEach((deal, i) => {
        console.log(`  ${i + 1}. ${deal.originCity} → ${deal.destinationCity}: €${deal.lowestPrice} (${deal.airline})`);
      });
  }

  // Enviar resumen por Telegram
  if (sendSummary && isActive() && results.deals.length > 0) {
    await sendSearchSummary({
      totalSearches: MONITORED_ROUTES.length,
      successfulSearches: results.searches.filter(s => s.success).length,
      dealsFound: results.deals.length,
      deals: results.deals,
      searchedAt: results.endTime.toISOString(),
    });
  }

  return results;
}

/**
 * Búsqueda rápida para una ruta específica
 */
async function quickSearch(origin, destination) {
  try {
    const result = await scrapeAllSources(origin, destination);
    
    // Encontrar precio de referencia si existe
    const route = MONITORED_ROUTES.find(r => r.origin === origin && r.destination === destination);
    const referencePrice = route?.referencePrice || 700;
    
    if (result.minPrice) {
      const analysis = analyzePrice(result.minPrice, referencePrice);
      return {
        ...result,
        ...analysis,
        referencePrice,
      };
    }
    
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
  // Por defecto: cada 30 minutos
  // '0 */30 * * * *' = cada 30 min
  // '0 */4 * * *' = cada 4 horas
  // '0 8,14,20 * * *' = a las 8:00, 14:00, 20:00

  if (isMonitoring) {
    console.log('⚠️ El monitoreo ya está activo');
    return false;
  }

  console.log('\n🚀 INICIANDO MONITOREO CONTINUO');
  console.log(`⏰ Programación: ${cronSchedule}`);
  console.log('📡 Fuentes: Skyscanner + Kayak (Web Scraping)');
  console.log('');

  // Enviar notificación de inicio
  if (isActive()) {
    sendMonitoringStarted();
  }

  // Programar búsquedas periódicas
  cronJob = cron.schedule(cronSchedule, async () => {
    console.log(`\n⏰ Ejecutando búsqueda programada: ${new Date().toLocaleString('es-ES')}`);
    
    try {
      await runFullSearch({ sendSummary: true });
    } catch (error) {
      console.error('Error en búsqueda programada:', error);
      if (isActive()) sendErrorAlert(error, 'Búsqueda programada');
    }
  }, {
    scheduled: true,
    timezone: 'Europe/Madrid',
  });

  isMonitoring = true;
  console.log('✅ Monitoreo iniciado correctamente\n');
  
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
    uptime: process.uptime(),
    routes: MONITORED_ROUTES.length,
    sources: ['Skyscanner', 'Kayak'],
  };
}

/**
 * Obtiene estadísticas
 */
async function getStats() {
  try {
    const totalFlights = await get('SELECT COUNT(*) as count FROM flight_prices');
    const recentDeals = await all(
      `SELECT * FROM flight_prices WHERE price < 500 ORDER BY recorded_at DESC LIMIT 10`
    );
    
    return {
      totalFlights: totalFlights?.count || 0,
      recentDeals,
      monitorStatus: getMonitorStatus(),
    };
  } catch (error) {
    return {
      error: error.message,
      monitorStatus: getMonitorStatus(),
    };
  }
}

/**
 * Helper para pausas
 */
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
};
