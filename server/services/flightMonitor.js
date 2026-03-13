/**
 * Servicio de Monitoreo de Vuelos v6.0
 *
 * Busca precios usando Puppeteer (Google Flights).
 *
 * RUTAS (TODAS con alerta Telegram cuando hay oferta):
 * - Vuelo MDQ → COR (14-20 abr) — ALERTA ≤ €70
 * - Vuelo SCL → SYD (junio) — ALERTA ≤ €650
 * - Vuelo SCL → MEL (junio) — ALERTA ≤ €650
 * - Vuelo EZE → MAD (junio) — ALERTA ≤ €450
 * - Vuelo EZE → BCN (junio) — ALERTA ≤ €450
 *
 * + Informe diario PDF a las 21:00
 */

const cron = require('node-cron');
const { scrapeAllSources } = require('../scrapers');
const { sendDealsReport, sendErrorAlert, isActive } = require('./telegram');
const { run, get, all, getProviderUsage, wasRecentlyAlerted } = require('../database/db');

// Estado del monitor
let isMonitoring = false;
let lastSearchTime = null;
let totalDealsFound = 0;
let cronJob = null;

// Timezone
const MONITOR_TIMEZONE = process.env.MONITOR_TIMEZONE || 'America/Argentina/Buenos_Aires';

// =============================================
// CONFIGURACIÓN DE RUTAS Y FECHAS
// =============================================

const MONITORED_ROUTES = [
  // ========== VUELO: Mar del Plata → Córdoba (ALERTA ≤ €70) ==========
  { origin: 'MDQ', destination: 'COR', name: 'Mar del Plata → Córdoba', mode: 'flight', dates: ['2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17', '2026-04-18', '2026-04-19', '2026-04-20'], tripType: 'oneway', alert: true, threshold: 70 },

  // ========== VUELOS: Santiago → Australia (ALERTA ≤ €650) ==========
  { origin: 'SCL', destination: 'SYD', name: 'Santiago → Sídney', mode: 'flight', dates: ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'], tripType: 'oneway', alert: true, threshold: 650 },
  { origin: 'SCL', destination: 'MEL', name: 'Santiago → Melbourne', mode: 'flight', dates: ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'], tripType: 'oneway', alert: true, threshold: 650 },

  // ========== VUELOS: Argentina → España (ALERTA ≤ €450) ==========
  { origin: 'EZE', destination: 'MAD', name: 'Buenos Aires → Madrid', mode: 'flight', dates: ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'], tripType: 'oneway', alert: true, threshold: 450 },
  { origin: 'EZE', destination: 'BCN', name: 'Buenos Aires → Barcelona', mode: 'flight', dates: ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'], tripType: 'oneway', alert: true, threshold: 450 },
];

// =============================================
// UMBRALES DE ALERTA (por ruta, definidos arriba)
// =============================================
const FLIGHT_ALERT_THRESHOLD = 650; // Referencia máxima (SCL→AUS)

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
  console.log('🔍 BÚSQUEDA DE VUELOS v6.0');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📊 Rutas: ${MONITORED_ROUTES.length} (TODAS con alerta)`);
  console.log('');
  console.log('📋 CONFIGURACIÓN:');
  console.log('   ✈️ MDQ → COR: vuelos 14-20 abr (ALERTA ≤ €70)');
  console.log('   ✈️ SCL → SYD/MEL: vuelos junio (ALERTA ≤ €650)');
  console.log('   ✈️ EZE → MAD/BCN: vuelos junio (ALERTA ≤ €450)');
  console.log('');

  const results = {
    flightDeals: [],    // Vuelos que pasan el umbral
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
  const totalNewDeals = results.flightDeals.length;
  totalDealsFound += totalNewDeals;

  // ══════════════ RESUMEN ══════════════
  const duration = (results.endTime - results.startTime) / 1000;
  const successCount = results.allSearches.filter(s => s.success).length;

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN');
  console.log('='.repeat(60));
  console.log(`✅ Búsquedas: ${successCount}/${results.allSearches.length}`);
  if (results.errors.length > 0) console.log(`❌ Errores: ${results.errors.length}`);
  console.log(`✈️ Ofertas encontradas: ${results.flightDeals.length}`);
  console.log(`⏱️ Duración: ${duration.toFixed(1)}s`);

  if (results.flightDeals.length > 0) {
    console.log('\n🎯 ALERTAS VUELOS:');
    results.flightDeals.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.routeName}: €${d.price} (${d.airline}) — ${formatDate(d.departureDate)}`);
    });
  }

  // ══════════════ TELEGRAM — alertas para TODAS las rutas ══════════════
  if (notifyDeals && isActive() && totalNewDeals > 0) {
    await sendDealsReport(results.flightDeals, []);
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

function startMonitoring(cronSchedule = '0 */2 * * *', timezone = 'America/Argentina/Buenos_Aires') {
  if (isMonitoring) {
    console.log('⚠️ El monitoreo ya está activo');
    return false;
  }

  console.log('\n🚀 INICIANDO MONITOREO v6.0');
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
