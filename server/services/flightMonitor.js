/**
 * Servicio de Monitoreo de Vuelos
 * 
 * Busca ofertas de vuelos continuamente y envía alertas
 */

const cron = require('node-cron');
const { searchGoogleFlights, generateBookingUrl, AIRPORTS } = require('../scrapers/googleFlights');
const { getAllRoutes, analyzePrice, generateSmartDates, PRICE_THRESHOLDS } = require('../config/routes');
const { initTelegram, sendDealAlert, sendSearchSummary, sendErrorAlert, sendMonitoringStarted, isActive } = require('./telegram');
const { saveFlightPrice, saveDeal, getRecentDeals, getDealStats } = require('../database/db');

// Estado del monitor
let isMonitoring = false;
let lastSearchTime = null;
let totalDealsFound = 0;
let cronJob = null;

/**
 * Realiza una búsqueda completa de ofertas
 */
async function runFullSearch(options = {}) {
  const {
    routeType = 'all', // 'all', 'argentina', 'usa'
    maxDates = 6,
    notifyDeals = true,
    sendSummary = false,
  } = options;

  console.log('\n' + '='.repeat(60));
  console.log('🔍 INICIANDO BÚSQUEDA DE OFERTAS');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📍 Tipo de rutas: ${routeType}`);
  console.log('');

  const routes = getAllRoutes(routeType);
  const dates = generateSmartDates({ maxDates });
  
  console.log(`📊 Rutas a buscar: ${routes.length}`);
  console.log(`📅 Fechas por ruta: ${dates.length}`);
  console.log(`🔢 Total búsquedas: ${routes.length * dates.length}`);
  console.log('');

  const results = {
    searches: [],
    deals: [],
    errors: [],
    startTime: new Date(),
    endTime: null,
  };

  let searchCount = 0;
  const totalSearches = routes.length * dates.length;

  for (const route of routes) {
    console.log(`\n🛫 ${route.name}`);
    
    for (const date of dates) {
      searchCount++;
      const progress = Math.round((searchCount / totalSearches) * 100);
      
      try {
        // Buscar vuelo
        const result = await searchGoogleFlights(
          route.origin,
          route.destination,
          date,
          null, // sin fecha de retorno (solo ida)
          'oneway'
        );

        results.searches.push(result);

        if (result.success && result.lowestPrice) {
          // Analizar si es oferta
          const analysis = analyzePrice(route.origin, route.destination, result.lowestPrice, 'oneway');
          
          if (analysis.isDeal) {
            const deal = {
              ...result,
              ...analysis,
              route: `${route.origin} → ${route.destination}`,
              routeName: route.name,
              bookingUrl: generateBookingUrl(route.origin, route.destination, date),
              foundAt: new Date().toISOString(),
            };

            results.deals.push(deal);
            totalDealsFound++;

            console.log(`  ${analysis.emoji} €${result.lowestPrice} - ${analysis.message}`);

            // Notificar por Telegram
            if (notifyDeals && isActive()) {
              await sendDealAlert(deal);
            }

            // Guardar en base de datos
            try {
              await saveDeal(deal);
            } catch (dbErr) {
              console.error('  Error guardando deal:', dbErr.message);
            }
          } else {
            console.log(`  ✈️ €${result.lowestPrice} - Precio normal`);
          }

          // Guardar precio histórico
          try {
            await saveFlightPrice({
              origin: route.origin,
              destination: route.destination,
              price: result.lowestPrice,
              date,
              airline: result.bestFlights?.[0]?.airline || 'Multiple',
              source: result.simulated ? 'simulation' : 'google_flights',
            });
          } catch (dbErr) {
            // Ignorar errores de duplicado
          }
        }

      } catch (error) {
        results.errors.push({
          route: `${route.origin}-${route.destination}`,
          date,
          error: error.message,
        });
        console.error(`  ❌ Error: ${error.message}`);
      }

      // Pausa entre búsquedas para no sobrecargar
      await sleep(1000);
    }
  }

  results.endTime = new Date();
  lastSearchTime = results.endTime;

  // Resumen
  const duration = (results.endTime - results.startTime) / 1000;
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN DE BÚSQUEDA');
  console.log('='.repeat(60));
  console.log(`✅ Búsquedas exitosas: ${results.searches.filter(s => s.success).length}/${totalSearches}`);
  console.log(`🔥 Ofertas encontradas: ${results.deals.length}`);
  console.log(`⏱️ Duración: ${duration.toFixed(1)} segundos`);
  console.log('');

  if (results.deals.length > 0) {
    console.log('🎯 MEJORES OFERTAS:');
    results.deals
      .sort((a, b) => a.lowestPrice - b.lowestPrice)
      .slice(0, 10)
      .forEach((deal, i) => {
        console.log(`  ${i + 1}. ${deal.route}: €${deal.lowestPrice} (${deal.outboundDate}) ${deal.emoji}`);
      });
  }

  // Enviar resumen por Telegram
  if (sendSummary && isActive()) {
    await sendSearchSummary({
      totalSearches,
      successfulSearches: results.searches.filter(s => s.success).length,
      dealsFound: results.deals.length,
      deals: results.deals,
      searchedAt: results.endTime.toISOString(),
    });
  }

  return results;
}

/**
 * Búsqueda rápida en rutas específicas
 */
async function quickSearch(origins, destinations, dates = null) {
  const searchDates = dates || generateSmartDates({ maxDates: 3 });
  const results = [];

  for (const origin of origins) {
    for (const destination of destinations) {
      for (const date of searchDates) {
        try {
          const result = await searchGoogleFlights(origin, destination, date);
          if (result.success) {
            const analysis = analyzePrice(origin, destination, result.lowestPrice);
            results.push({
              ...result,
              ...analysis,
              bookingUrl: generateBookingUrl(origin, destination, date),
            });
          }
        } catch (err) {
          console.error(`Error en ${origin}-${destination}:`, err.message);
        }
        await sleep(500);
      }
    }
  }

  return results.sort((a, b) => a.lowestPrice - b.lowestPrice);
}

/**
 * Inicia el monitoreo continuo
 */
function startMonitoring(cronSchedule = '0 */4 * * *') {
  // Por defecto: cada 4 horas
  // Formatos comunes:
  // '0 */4 * * *' = cada 4 horas
  // '0 */2 * * *' = cada 2 horas
  // '0 */6 * * *' = cada 6 horas
  // '0 8,14,20 * * *' = a las 8:00, 14:00, 20:00

  if (isMonitoring) {
    console.log('⚠️ El monitoreo ya está activo');
    return false;
  }

  // Inicializar Telegram
  initTelegram();

  console.log('\n🚀 INICIANDO MONITOREO CONTINUO');
  console.log(`⏰ Programación: ${cronSchedule}`);
  console.log('');

  // Enviar notificación de inicio
  if (isActive()) {
    sendMonitoringStarted();
  }

  // Ejecutar búsqueda inicial
  runFullSearch({ sendSummary: true }).catch(err => {
    console.error('Error en búsqueda inicial:', err);
    if (isActive()) sendErrorAlert(err, 'Búsqueda inicial');
  });

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
  };
}

/**
 * Obtiene estadísticas de ofertas
 */
async function getStats() {
  try {
    const stats = await getDealStats();
    const recentDeals = await getRecentDeals(10);
    
    return {
      ...stats,
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
};
