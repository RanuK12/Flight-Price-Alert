/**
 * Servicio de Monitoreo de Vuelos v7.0
 *
 * Busca precios usando Google Flights API directa (sin Puppeteer).
 * Puppeteer solo como fallback si la API no devuelve resultados.
 *
 * RUTAS MONITOREADAS (TODAS con alerta Telegram):
 *
 * 1. MDQ → COR (19-24 abr) solo ida — ALERTA ≤ $50
 * 2. MAD/BCN → ORD (20-30 jun) solo ida — ALERTA ≤ $300/$280
 * 3. EZE → MAD/BCN (15 jun - 31 jul) solo ida — ALERTA ≤ $450
 * 4. EZE → FCO/MXP (15 jun - 31 jul) solo ida — ALERTA ≤ $500
 * 5. COR → MAD/BCN (15 jun - 31 jul) solo ida — ALERTA ≤ $550
 * 6. COR → FCO/MXP (15 jun - 31 jul) solo ida — ALERTA ≤ $600
 *
 * Precios en USD.
 * + Informe diario PDF a las 21:00
 */

const cron = require('node-cron');
const { scrapeAllSources } = require('../scrapers');
const { sendDealsReport, sendErrorAlert, isActive } = require('./telegram');
const { run, get, all, wasRecentlyAlerted } = require('../database/db');

// Estado del monitor
let isMonitoring = false;
let lastSearchTime = null;
let totalDealsFound = 0;
let cronJob = null;

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

/**
 * Genera todas las fechas entre start y end (inclusive)
 */
function dateRange(start, end) {
  const dates = [];
  let current = new Date(start);
  const endDate = new Date(end);
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// Rotación: en cada corrida buscamos un subconjunto de fechas por ruta
let rotationOffset = 0;

function pickDatesForRun(allDates, count = 3) {
  if (allDates.length <= count) return [...allDates];
  const picked = [];
  for (let i = 0; i < count; i++) {
    const idx = (rotationOffset + i) % allDates.length;
    picked.push(allDates[idx]);
  }
  return picked;
}

// =============================================
// CONFIGURACIÓN DE RUTAS Y FECHAS
// =============================================

const MONITORED_ROUTES = [
  // ========== RUTA 1: Mar del Plata → Córdoba (19-24 abr) ==========
  {
    origin: 'MDQ', destination: 'COR',
    name: 'Mar del Plata → Córdoba',
    dates: dateRange('2026-04-19', '2026-04-24'),
    tripType: 'oneway',
    alert: true,
    threshold: 250,  // USD — real $318+, oferta <$250
  },

  // ========== RUTA 2: España → Chicago (20-30 jun, temporada alta) ==========
  {
    origin: 'MAD', destination: 'ORD',
    name: 'Madrid → Chicago',
    dates: dateRange('2026-06-20', '2026-06-30'),
    tripType: 'oneway',
    alert: true,
    threshold: 480,  // USD — real $551+, oferta <$480
  },
  {
    origin: 'BCN', destination: 'ORD',
    name: 'Barcelona → Chicago',
    dates: dateRange('2026-06-20', '2026-06-30'),
    tripType: 'oneway',
    alert: true,
    threshold: 480,  // USD — real $561+, oferta <$480
  },

  // ========== RUTA 3: Buenos Aires → España (15 jun - 31 jul, temporada alta) ==========
  {
    origin: 'EZE', destination: 'MAD',
    name: 'Buenos Aires → Madrid',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 700,  // USD — real $606+, oferta <$700
  },
  {
    origin: 'EZE', destination: 'BCN',
    name: 'Buenos Aires → Barcelona',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 700,  // USD — real $682+, oferta <$700
  },

  // ========== RUTA 3b: Buenos Aires → Italia (15 jun - 31 jul) ==========
  {
    origin: 'EZE', destination: 'FCO',
    name: 'Buenos Aires → Roma',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 750,  // USD — estimado $700+, oferta <$750
  },
  {
    origin: 'EZE', destination: 'MXP',
    name: 'Buenos Aires → Milán',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 750,  // USD
  },

  // ========== RUTA 3c: Córdoba → España (15 jun - 31 jul) ==========
  {
    origin: 'COR', destination: 'MAD',
    name: 'Córdoba → Madrid',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 850,  // USD — COR +$100-200 vs EZE
  },
  {
    origin: 'COR', destination: 'BCN',
    name: 'Córdoba → Barcelona',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 850,  // USD
  },

  // ========== RUTA 3d: Córdoba → Italia (15 jun - 31 jul) ==========
  {
    origin: 'COR', destination: 'FCO',
    name: 'Córdoba → Roma',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 900,  // USD
  },
  {
    origin: 'COR', destination: 'MXP',
    name: 'Córdoba → Milán',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 900,  // USD
  },
];

// =============================================
// BÚSQUEDA PRINCIPAL
// =============================================

async function runFullSearch(options = {}) {
  const { notifyDeals = true } = options;

  console.log('\n' + '='.repeat(60));
  console.log('🔍 BÚSQUEDA DE VUELOS v7.0 (API Directa)');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📊 Rutas: ${MONITORED_ROUTES.length} (TODAS con alerta)`);
  console.log('');
  console.log('📋 CONFIGURACIÓN (umbrales ajustados a precios reales):');
  console.log('   ✈️ MDQ → COR: 19-24 abr (ALERTA ≤ $250)');
  console.log('   ✈️ MAD/BCN → ORD: 20-30 jun (ALERTA ≤ $480)');
  console.log('   ✈️ EZE → MAD/BCN: 15 jun - 31 jul (ALERTA ≤ $700)');
  console.log('   ✈️ EZE → FCO/MXP: 15 jun - 31 jul (ALERTA ≤ $750)');
  console.log('   ✈️ COR → MAD/BCN: 15 jun - 31 jul (ALERTA ≤ $850)');
  console.log('   ✈️ COR → FCO/MXP: 15 jun - 31 jul (ALERTA ≤ $900)');
  console.log('');

  const results = {
    flightDeals: [],
    allSearches: [],
    errors: [],
    startTime: new Date(),
  };

  // Incrementar offset de rotación
  rotationOffset = (rotationOffset + 1) % 20;

  for (const route of MONITORED_ROUTES) {
    // Seleccionar fechas para esta corrida (3 fechas rotando)
    const datesToSearch = pickDatesForRun(route.dates, 3);

    for (const departureDate of datesToSearch) {
      console.log(`\n✈️ ${route.name} — ${departureDate} [ALERTA ≤ $${route.threshold}]`);

      try {
        const searchResult = await scrapeAllSources(
          route.origin,
          route.destination,
          false, // one-way
          departureDate,
          undefined
        );

        results.allSearches.push({
          route: route.name,
          date: departureDate,
          success: searchResult.minPrice !== null,
        });

        if (searchResult.allFlights && searchResult.allFlights.length > 0) {
          for (const flight of searchResult.allFlights) {
            const price = Math.round(flight.price);

            // Validar precio realista
            if (price < 10 || price > 5000) {
              console.log(`  ⚠️ Precio irreal ignorado: $${price}`);
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
            });

            if (price <= route.threshold) {
              console.log(`  🔥 OFERTA: $${price} (${flight.airline}) — ${formatDate(departureDate)}`);

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
                    stops: flight.stops,
                    totalDuration: flight.totalDuration,
                  });
                } else {
                  console.log(`  🔕 Ya alertado recientemente (anti-spam)`);
                }
              }
            } else {
              console.log(`  ✈️ $${price} (${flight.airline}) — no es oferta (máx $${route.threshold})`);
            }
          }
        } else {
          console.log(`  ⚠️ Sin precios encontrados`);
        }
      } catch (error) {
        results.errors.push({ route: route.name, error: error.message });
        console.error(`  ❌ Error: ${error.message}`);
      }

      // Delay entre búsquedas (más corto que Puppeteer ya que no hay browser)
      await sleep(500);
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
    console.log('\n🎯 ALERTAS:');
    results.flightDeals.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.routeName}: $${d.price} (${d.airline}) — ${formatDate(d.departureDate)}`);
    });
  }

  // ══════════════ TELEGRAM ══════════════
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
    const key = `${deal.origin}-${deal.destination}-${deal.price}-${deal.airline || 'unknown'}`;
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

  console.log('\n🚀 INICIANDO MONITOREO v7.0 (API Directa)');
  console.log(`⏰ Programación: ${cronSchedule}`);
  console.log('📋 Rutas monitoreadas:');
  for (const r of MONITORED_ROUTES) {
    const dateLabel = r.dates.length > 6
      ? `${r.dates[0]} a ${r.dates[r.dates.length - 1]}`
      : r.dates.join(', ');
    console.log(`   ✈️ ${r.name} — ${dateLabel} [ALERTA ≤ $${r.threshold}]`);
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
    routes: MONITORED_ROUTES.length,
    routeDetails: MONITORED_ROUTES.map(r => ({
      name: r.name,
      threshold: r.threshold,
      dateRange: `${r.dates[0]} — ${r.dates[r.dates.length - 1]}`,
    })),
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
};
