/**
 * Servicio de Monitoreo de Vuelos y Transporte v5.1
 *
 * Busca precios usando:
 * - Puppeteer (Google Flights) para vuelos
 * - FlixBus API para autobuses/trenes
 *
 * RUTAS (TODAS con alerta Telegram cuando hay oferta):
 * - Vuelos VCE/VRN → AMS (24-26 mar) — ALERTA ≤ €60
 * - Bus/tren Trento → Múnich (24-26 mar) — ALERTA ≤ €30
 * - Bus/tren Múnich → Amsterdam (24-26 mar) — ALERTA ≤ €40
 * - Vuelos AMS → MAD (3-5 abr) — ALERTA ≤ €75
 * - Bus/tren Amsterdam → Madrid (3-5 abr) — ALERTA ≤ €60
 *
 * + Informe diario PDF a las 21:00
 */

const cron = require('node-cron');
const { scrapeAllSources, scrapeTransitPrices } = require('../scrapers');
const { sendDealsReport, sendErrorAlert, isActive } = require('./telegram');
const { run, get, all, getProviderUsage, wasRecentlyAlerted } = require('../database/db');

// Estado del monitor
let isMonitoring = false;
let lastSearchTime = null;
let totalDealsFound = 0;
let cronJob = null;

// Timezone
const MONITOR_TIMEZONE = process.env.MONITOR_TIMEZONE || 'Europe/Rome';

// =============================================
// CONFIGURACIÓN DE RUTAS Y FECHAS
// =============================================

const MONITORED_ROUTES = [
  // ========== VUELOS: Venecia/Verona → Amsterdam (ALERTA ≤ €60) ==========
  { origin: 'VCE', destination: 'AMS', name: 'Venecia → Amsterdam', mode: 'flight', dates: ['2026-03-24', '2026-03-25', '2026-03-26'], tripType: 'oneway', alert: true, threshold: 60 },
  { origin: 'VRN', destination: 'AMS', name: 'Verona → Amsterdam', mode: 'flight', dates: ['2026-03-24', '2026-03-25', '2026-03-26'], tripType: 'oneway', alert: true, threshold: 60 },

  // ========== BUS/TREN: Trento → Múnich → Amsterdam (ALERTA ≤ €30/€40) ==========
  { origin: 'Trento', destination: 'Munich', name: 'Trento → Múnich', mode: 'transit', dates: ['2026-03-24', '2026-03-25', '2026-03-26'], tripType: 'oneway', alert: true, threshold: 30 },
  { origin: 'Munich', destination: 'Amsterdam', name: 'Múnich → Amsterdam', mode: 'transit', dates: ['2026-03-24', '2026-03-25', '2026-03-26'], tripType: 'oneway', alert: true, threshold: 40 },

  // ========== VUELOS: Amsterdam → Madrid (ALERTA ≤ €75) ==========
  { origin: 'AMS', destination: 'MAD', name: 'Amsterdam → Madrid', mode: 'flight', dates: ['2026-04-03', '2026-04-04', '2026-04-05'], tripType: 'oneway', alert: true, threshold: 75 },

  // ========== BUS/TREN: Amsterdam → Madrid (ALERTA ≤ €60) ==========
  { origin: 'Amsterdam', destination: 'Madrid', name: 'Amsterdam → Madrid', mode: 'transit', dates: ['2026-04-03', '2026-04-04', '2026-04-05'], tripType: 'oneway', alert: true, threshold: 60 },
];

// =============================================
// UMBRALES DE ALERTA (por ruta, definidos arriba)
// =============================================
const FLIGHT_ALERT_THRESHOLD = 75; // Referencia máxima para vuelos AMS→MAD

// =============================================
// HELPERS
// =============================================

function formatDate(dateStr) {
  if (!dateStr || dateStr === 'Flexible') return 'Flexible';
  const date = new Date(dateStr);
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Rotación: en cada corrida buscamos un subconjunto de fechas por ruta
let rotationOffset = 0;

function pickDatesForRun(allDates, count = 2) {
  if (allDates.length <= count) return [...allDates];
  const picked = [];
  for (let i = 0; i < count; i++) {
    const idx = (rotationOffset + i) % allDates.length;
    picked.push(allDates[idx]);
  }
  return picked;
}

// =============================================
// BÚSQUEDA PRINCIPAL
// =============================================

async function runFullSearch(options = {}) {
  const { notifyDeals = true } = options;

  console.log('\n' + '='.repeat(60));
  console.log('🔍 BÚSQUEDA DE VUELOS Y TRANSPORTE v5.1');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📊 Rutas: ${MONITORED_ROUTES.length} (TODAS con alerta)`);
  console.log('');
  console.log('📋 CONFIGURACIÓN:');
  console.log('   ✈️ VCE/VRN → AMS: vuelos 24-26 mar (ALERTA ≤ €60)');
  console.log('   🚌 Trento → Múnich → AMS: bus/tren 24-26 mar (ALERTA ≤ €30/€40)');
  console.log('   ✈️ AMS → MAD: vuelos 3-5 abr (ALERTA ≤ €75)');
  console.log('   🚌 AMS → MAD: bus/tren 3-5 abr (ALERTA ≤ €60)');
  console.log('');

  const results = {
    flightDeals: [],    // Vuelos que pasan el umbral
    transitDeals: [],   // Transit que pasan el umbral
    allSearches: [],
    errors: [],
    startTime: new Date(),
  };

  // Incrementar offset de rotación
  rotationOffset = (rotationOffset + 1) % 10;

  for (const route of MONITORED_ROUTES) {
    // Seleccionar fechas para esta corrida (2 de las 3 disponibles, rotando)
    const datesToSearch = pickDatesForRun(route.dates, 2);

    for (const departureDate of datesToSearch) {
      const modeEmoji = route.mode === 'flight' ? '✈️' : '🚌';
      const alertBadge = route.alert ? ' [ALERTA]' : '';
      console.log(`\n${modeEmoji} ${route.name} — ${departureDate}${alertBadge}`);

      try {
        if (route.mode === 'flight') {
          // ══════════════ VUELOS ══════════════
          const searchResult = await scrapeAllSources(
            route.origin,
            route.destination,
            false, // one-way
            departureDate,
            undefined
          );

          results.allSearches.push({
            route: route.name,
            mode: 'flight',
            date: departureDate,
            success: searchResult.minPrice !== null,
          });

          if (searchResult.allFlights && searchResult.allFlights.length > 0) {
            for (const flight of searchResult.allFlights) {
              const price = Math.round(flight.price);

              // Validar precio realista
              if (price < 15 || price > 5000) {
                console.log(`  ⚠️ Precio irreal ignorado: €${price}`);
                continue;
              }

              // Guardar en DB
              await saveToDatabase({
                origin: route.origin,
                destination: route.destination,
                price,
                airline: flight.airline,
                source: flight.source,
                departureDate,
                link: flight.link,
                mode: 'flight',
              });

              if (price <= route.threshold) {
                console.log(`  🔥 OFERTA: €${price} (${flight.airline}) — ${formatDate(departureDate)}`);

                // Solo alertar si la ruta tiene alerta habilitada
                if (route.alert) {
                  const recentlyAlerted = await wasRecentlyAlerted(route.origin, route.destination, price, 24);
                  if (!recentlyAlerted) {
                    results.flightDeals.push({
                      origin: route.origin,
                      destination: route.destination,
                      routeName: route.name,
                      price,
                      airline: flight.airline,
                      source: flight.source,
                      departureDate,
                      bookingUrl: flight.link,
                      tripType: 'oneway',
                      threshold: route.threshold,
                      mode: 'flight',
                    });
                  } else {
                    console.log(`  🔕 Ya alertado recientemente (anti-spam)`);
                  }
                }
              } else {
                console.log(`  ✈️ €${price} (${flight.airline}) — no es oferta (máx €${route.threshold})`);
              }
            }
          } else {
            console.log(`  ⚠️ Sin precios encontrados`);
          }

        } else if (route.mode === 'transit') {
          // ══════════════ BUS/TREN ══════════════
          const transitResult = await scrapeTransitPrices(
            route.origin,
            route.destination,
            departureDate
          );

          results.allSearches.push({
            route: route.name,
            mode: 'transit',
            date: departureDate,
            success: transitResult.success,
          });

          if (transitResult.journeys && transitResult.journeys.length > 0) {
            for (const journey of transitResult.journeys) {
              const price = Math.round(journey.price * 100) / 100;

              // Guardar en DB
              await saveToDatabase({
                origin: route.origin,
                destination: route.destination,
                price,
                airline: `${journey.provider} (${journey.transportType})`,
                source: journey.source,
                departureDate,
                link: journey.link,
                mode: 'transit',
              });

              if (price <= route.threshold) {
                console.log(`  🔥 OFERTA: €${price} (${journey.provider} ${journey.transportType}) — ${journey.departureTime || ''}`);

                if (route.alert) {
                  const recentlyAlerted = await wasRecentlyAlerted(route.origin, route.destination, price, 24);
                  if (!recentlyAlerted) {
                    results.transitDeals.push({
                      origin: route.origin,
                      destination: route.destination,
                      routeName: route.name,
                      price,
                      provider: journey.provider,
                      transportType: journey.transportType,
                      departureDate,
                      departureTime: journey.departureTime,
                      duration: journey.duration,
                      bookingUrl: journey.link,
                      mode: 'transit',
                    });
                  } else {
                    console.log(`  🔕 Ya alertado recientemente (anti-spam)`);
                  }
                }
              }
            }
          } else {
            console.log(`  ⚠️ Sin resultados de transit`);
          }
        }
      } catch (error) {
        results.errors.push({ route: route.name, error: error.message });
        console.error(`  ❌ Error: ${error.message}`);
      }

      await sleep(1500);
    }
  }

  results.endTime = new Date();
  lastSearchTime = results.endTime;

  // Deduplicar ofertas
  results.flightDeals = deduplicateAndSort(results.flightDeals);
  results.transitDeals = deduplicateAndSort(results.transitDeals);
  const totalNewDeals = results.flightDeals.length + results.transitDeals.length;
  totalDealsFound += totalNewDeals;

  // ══════════════ RESUMEN ══════════════
  const duration = (results.endTime - results.startTime) / 1000;
  const successCount = results.allSearches.filter(s => s.success).length;

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN');
  console.log('='.repeat(60));
  console.log(`✅ Búsquedas: ${successCount}/${results.allSearches.length}`);
  if (results.errors.length > 0) console.log(`❌ Errores: ${results.errors.length}`);
  console.log(`✈️ Ofertas vuelos: ${results.flightDeals.length}`);
  console.log(`🚌 Ofertas transit: ${results.transitDeals.length}`);
  console.log(`🔥 Total ofertas alertables: ${totalNewDeals}`);
  console.log(`⏱️ Duración: ${duration.toFixed(1)}s`);

  if (results.flightDeals.length > 0) {
    console.log('\n🎯 ALERTAS VUELOS:');
    results.flightDeals.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.routeName}: €${d.price} (${d.airline}) — ${formatDate(d.departureDate)}`);
    });
  }

  if (results.transitDeals.length > 0) {
    console.log('\n🎯 ALERTAS BUS/TREN:');
    results.transitDeals.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.routeName}: €${d.price} (${d.provider} ${d.transportType}) — ${formatDate(d.departureDate)}`);
    });
  }

  // ══════════════ TELEGRAM — alertas para TODAS las rutas ══════════════
  if (notifyDeals && isActive() && totalNewDeals > 0) {
    await sendDealsReport(results.flightDeals, results.transitDeals);
    console.log(`📱 Alerta Telegram enviada (${totalNewDeals} ofertas)`);
  } else if (totalNewDeals === 0) {
    console.log('📴 Sin ofertas alertables — no se envía Telegram');
  }

  return results;
}

// =============================================
// DB + DEDUP
// =============================================

function deduplicateAndSort(deals) {
  const unique = [];
  const seen = new Set();
  for (const deal of deals) {
    const key = `${deal.origin}-${deal.destination}-${deal.price}-${deal.airline || deal.provider}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(deal);
    }
  }
  return unique.sort((a, b) => a.price - b.price);
}

async function saveToDatabase(data) {
  try {
    await run(
      `INSERT INTO flight_prices (route_id, origin, destination, airline, price, source, booking_url, departure_date, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        `${data.origin}-${data.destination}`,
        data.origin,
        data.destination,
        data.airline,
        data.price,
        data.source,
        data.link,
        data.departureDate,
      ]
    );
  } catch (err) {
    // Ignorar duplicados
  }
}

// =============================================
// BÚSQUEDA RÁPIDA (API web)
// =============================================

async function quickSearch(origin, destination) {
  try {
    const result = await scrapeAllSources(origin, destination);
    return result;
  } catch (error) {
    console.error(`Error en búsqueda rápida:`, error.message);
    throw error;
  }
}

// =============================================
// MONITOREO CONTINUO
// =============================================

function startMonitoring(cronSchedule = '0 */2 * * *', timezone = 'Europe/Rome') {
  if (isMonitoring) {
    console.log('⚠️ El monitoreo ya está activo');
    return false;
  }

  console.log('\n🚀 INICIANDO MONITOREO v5.1');
  console.log(`⏰ Programación: ${cronSchedule}`);
  console.log('📋 Rutas (TODAS con alerta Telegram):');
  for (const r of MONITORED_ROUTES) {
    const emoji = r.mode === 'flight' ? '✈️' : '🚌';
    console.log(`   ${emoji} ${r.name} — ${r.dates.join(', ')} [ALERTA ≤ €${r.threshold}]`);
  }
  console.log(`📢 Alertas Telegram: TODAS las rutas + informe diario PDF`);
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

function stopMonitoring() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
  isMonitoring = false;
  console.log('🛑 Monitoreo detenido');
  return true;
}

function getMonitorStatus() {
  return {
    isMonitoring,
    lastSearchTime,
    totalDealsFound,
    telegramActive: isActive(),
    thresholds: {
      flightAlert: FLIGHT_ALERT_THRESHOLD,
    },
    routes: MONITORED_ROUTES.length,
  };
}

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

module.exports = {
  runFullSearch,
  quickSearch,
  startMonitoring,
  stopMonitoring,
  getMonitorStatus,
  getStats,
  MONITORED_ROUTES,
  FLIGHT_ALERT_THRESHOLD,
};
