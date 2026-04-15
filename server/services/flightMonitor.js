/**
 * Servicio de Monitoreo de Vuelos v8.0
 *
 * Busca precios usando Google Flights API directa (sin Puppeteer).
 * Puppeteer solo como fallback si la API no devuelve resultados.
 *
 * RUTAS MONITOREADAS (TODAS con alerta Telegram):
 *
 * 1. MDQ → COR (19-24 abr) solo ida — ALERTA ≤ €110
 * 2. MAD → ORD (20-30 jun) solo ida — ALERTA ≤ €420
 * 3. BCN → ORD (20-30 jun) solo ida — ALERTA ≤ €390
 * 4. EZE → MAD/BCN (15 jun - 31 jul) solo ida — ALERTA ≤ €690
 * 5. EZE → FCO/MXP (15 jun - 31 jul) solo ida — ALERTA ≤ €750
 * 6. COR → MAD/BCN (15 jun - 31 jul) solo ida — ALERTA ≤ €820
 * 7. COR → FCO/MXP (15 jun - 31 jul) solo ida — ALERTA ≤ €850
 * 8. FCO → TYO (1 sep - 31 oct) ida/vuelta — ALERTA ≤ $1,100 USD
 * 9. MXP → TYO (1 sep - 31 oct) ida/vuelta — ALERTA ≤ $1,100 USD
 *
 * Precios en EUR.
 * + Informe diario PDF a las 21:00
 */

const cron = require('node-cron');
const { scrapeAllSources } = require('../scrapers');
const { sendDealsReport, sendErrorAlert, isActive } = require('./telegram');
const { run, get, all, wasRecentlyAlerted } = require('../database/db');

// Estado del monitor
let isMonitoring = false;
let searchRunning = false;
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
    threshold: 110,       // normal-bajo (precio aceptable)
    thresholdMuyBajo: 75, // muy bajo (muy buena oferta)
    thresholdOferton: 42, // ofertón (tarifa error/promo)
  },

  // ========== RUTA 2: España → Chicago (20-30 jun, temporada alta) ==========
  {
    origin: 'MAD', destination: 'ORD',
    name: 'Madrid → Chicago',
    dates: dateRange('2026-06-20', '2026-06-30'),
    tripType: 'oneway',
    alert: true,
    threshold: 420,
    thresholdMuyBajo: 320,
    thresholdOferton: 220,
  },
  {
    origin: 'BCN', destination: 'ORD',
    name: 'Barcelona → Chicago',
    dates: dateRange('2026-06-20', '2026-06-30'),
    tripType: 'oneway',
    alert: true,
    threshold: 390,
    thresholdMuyBajo: 295,
    thresholdOferton: 205,
  },

  // ========== RUTA 3: Buenos Aires → España (15 jun - 31 jul) ==========
  {
    origin: 'EZE', destination: 'MAD',
    name: 'Buenos Aires → Madrid',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 690,
    thresholdMuyBajo: 570,
    thresholdOferton: 450,
  },
  {
    origin: 'EZE', destination: 'BCN',
    name: 'Buenos Aires → Barcelona',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 690,
    thresholdMuyBajo: 570,
    thresholdOferton: 450,
  },

  // ========== RUTA 3b: Buenos Aires → Italia (15 jun - 31 jul) ==========
  {
    origin: 'EZE', destination: 'FCO',
    name: 'Buenos Aires → Roma',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 750,
    thresholdMuyBajo: 630,
    thresholdOferton: 480,
  },
  {
    origin: 'EZE', destination: 'MXP',
    name: 'Buenos Aires → Milán',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 750,
    thresholdMuyBajo: 630,
    thresholdOferton: 480,
  },

  // ========== RUTA 3c: Córdoba → España (15 jun - 31 jul) ==========
  {
    origin: 'COR', destination: 'MAD',
    name: 'Córdoba → Madrid',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 820,
    thresholdMuyBajo: 690,
    thresholdOferton: 520,
  },
  {
    origin: 'COR', destination: 'BCN',
    name: 'Córdoba → Barcelona',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 820,
    thresholdMuyBajo: 690,
    thresholdOferton: 520,
  },

  // ========== RUTA 3d: Córdoba → Italia (15 jun - 31 jul) ==========
  {
    origin: 'COR', destination: 'FCO',
    name: 'Córdoba → Roma',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 850,
    thresholdMuyBajo: 730,
    thresholdOferton: 540,
  },
  {
    origin: 'COR', destination: 'MXP',
    name: 'Córdoba → Milán',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 850,
    thresholdMuyBajo: 730,
    thresholdOferton: 540,
  },

  // ========== RUTA 4: Europa → Buenos Aires (15 jun - 31 jul) ==========
  {
    origin: 'MAD', destination: 'EZE',
    name: 'Madrid → Buenos Aires',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 590,
    thresholdMuyBajo: 480,
    thresholdOferton: 390,
  },
  {
    origin: 'BCN', destination: 'EZE',
    name: 'Barcelona → Buenos Aires',
    dates: dateRange('2026-06-15', '2026-07-31'),
    tripType: 'oneway',
    alert: true,
    threshold: 590,
    thresholdMuyBajo: 480,
    thresholdOferton: 390,
  },

  // ========== RUTA 5: Italia → Tokio (sep/oct 2026, ida y vuelta ~10 días) ==========
  // Precios reales relevados en Kayak el 15/04/2026 (FCO → TYO, sep 2026):
  //   Mínimo real:  ~USD 1,341 (ITA Airways directo) → ~€1,180 EUR
  //   Precio típico: USD 1,626–1,706 → ~€1,430–1,500 EUR
  //   Precio alto:   USD 1,800+ → €1,580+ EUR
  //
  // Thresholds en EUR:
  //   ✈️ Buen precio  ≤ €1,250 EUR  (por debajo del mínimo real)
  //   🔥🔥 Oferta     ≤ €1,100 EUR  (muy por debajo del mercado)
  //   🔥🔥🔥 Ofertón  ≤ €900 EUR    (tarifa error / promo excepcional)
  {
    origin: 'FCO', destination: 'TYO',
    name: 'Roma → Tokio',
    dates: dateRange('2026-09-01', '2026-10-21'), // salidas que permiten ~10 días antes de oct fin
    tripType: 'roundtrip',
    alert: true,
    threshold: 1250,        // ✈️ buen precio
    thresholdMuyBajo: 1100, // 🔥🔥 oferta
    thresholdOferton: 900,  // 🔥🔥🔥 ofertón
  },
  {
    origin: 'MXP', destination: 'TYO',
    name: 'Milán → Tokio',
    dates: dateRange('2026-09-01', '2026-10-21'),
    tripType: 'roundtrip',
    alert: true,
    threshold: 1250,
    thresholdMuyBajo: 1100,
    thresholdOferton: 900,
  },
];

// =============================================
// BÚSQUEDA PRINCIPAL
// =============================================

// Timeout global para evitar que una búsqueda cuelgue el proceso
const SEARCH_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutos máximo

async function runFullSearch(options = {}) {
  const { notifyDeals = true } = options;

  // Timeout global protector
  return Promise.race([
    _runFullSearchInternal(options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT: búsqueda excedió 8 minutos')), SEARCH_TIMEOUT_MS)
    ),
  ]).catch(err => {
    console.error(`\n❌ runFullSearch FAILED: ${err.message}`);
    logMemory();
    return { flightDeals: [], allSearches: [], errors: [{ route: 'global', error: err.message }] };
  });
}

function logMemory() {
  try {
    const mem = process.memoryUsage();
    const rss = (mem.rss / 1024 / 1024).toFixed(1);
    const heap = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const heapTotal = (mem.heapTotal / 1024 / 1024).toFixed(1);
    console.log(`🧠 Memoria: RSS=${rss}MB, Heap=${heap}/${heapTotal}MB`);
  } catch (e) {}
}

async function _runFullSearchInternal(options = {}) {
  const { notifyDeals = true } = options;

  console.log('\n' + '='.repeat(60));
  console.log('🔍 BÚSQUEDA DE VUELOS v9.0 (API Directa + Robustez)');
  console.log('='.repeat(60));
  console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
  console.log(`📊 Rutas: ${MONITORED_ROUTES.length} (TODAS con alerta)`);
  logMemory();
  console.log('');
  console.log('📋 CONFIGURACIÓN (umbrales = "normal-bajo" techo):');
  console.log('   ✈️ MDQ → COR: 19-24 abr (≤€110 normal-bajo, ≤€75 muy bajo, ≤€42 ofertón)');
  console.log('   ✈️ MAD → ORD: 20-30 jun (≤€420 normal-bajo, ≤€320 muy bajo, ≤€220 ofertón)');
  console.log('   ✈️ BCN → ORD: 20-30 jun (≤€390 normal-bajo, ≤€295 muy bajo, ≤€205 ofertón)');
  console.log('   ✈️ EZE → MAD/BCN: 15 jun - 31 jul (≤€690 normal-bajo, ≤€570 muy bajo, ≤€450 ofertón)');
  console.log('   ✈️ EZE → FCO/MXP: 15 jun - 31 jul (≤€750 normal-bajo, ≤€630 muy bajo, ≤€480 ofertón)');
  console.log('   ✈️ COR → MAD/BCN: 15 jun - 31 jul (≤€820 normal-bajo, ≤€690 muy bajo, ≤€520 ofertón)');
  console.log('   ✈️ COR → FCO/MXP: 15 jun - 31 jul (≤€850 normal-bajo, ≤€730 muy bajo, ≤€540 ofertón)');
  console.log('   ✈️ MAD/BCN → EZE: 15 jun - 31 jul (≤€590 normal-bajo, ≤€480 muy bajo, ≤€390 ofertón)');
  console.log('   ✈️ AMS → EZE: 15 jun - 31 jul (≤€720 normal-bajo, ≤€580 muy bajo, ≤€460 ofertón)');
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
      console.log(`\n✈️ ${route.name} — ${departureDate} [ALERTA ≤ €${route.threshold}]`);

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
            });

            if (price <= route.threshold) {
              // Clasificar nivel de oferta
              let dealLevel, dealEmoji;
              if (price <= (route.thresholdOferton || route.threshold * 0.4)) {
                dealLevel = 'oferton';
                dealEmoji = '🚨🔥🔥🔥';
              } else if (price <= (route.thresholdMuyBajo || route.threshold * 0.7)) {
                dealLevel = 'muy_bajo';
                dealEmoji = '💰🔥🔥';
              } else {
                dealLevel = 'normal_bajo';
                dealEmoji = '✅🔥';
              }
              console.log(`  ${dealEmoji} ${dealLevel.toUpperCase()}: €${price} (${flight.airline}) — ${formatDate(departureDate)}`);

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
                    thresholdMuyBajo: route.thresholdMuyBajo,
                    thresholdOferton: route.thresholdOferton,
                    dealLevel,
                    stops: flight.stops,
                    totalDuration: flight.totalDuration,
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
      } catch (error) {
        results.errors.push({ route: route.name, error: error.message });
        console.error(`  ❌ Error: ${error.message}`);
        // No crashear el loop entero por un error individual
      }

      // Delay aleatorio entre búsquedas (evita el Error 429 de Google)
      const randomDelay = Math.floor(Math.random() * 4000) + 3000; // Entre 3 y 7 segundos
      await sleep(randomDelay);
    }

    // Log de progreso entre rutas
    const routeIdx = MONITORED_ROUTES.indexOf(route) + 1;
    if (routeIdx % 5 === 0) {
      logMemory();
      console.log(`📊 Progreso: ${routeIdx}/${MONITORED_ROUTES.length} rutas`);
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
  console.log('📊 RESUMEN DE BÚSQUEDA');
  console.log('='.repeat(60));
  console.log(`✅ Búsquedas: ${successCount}/${results.allSearches.length}`);
  if (results.errors.length > 0) {
    console.log(`❌ Errores: ${results.errors.length}`);
    results.errors.forEach(e => console.log(`   • ${e.route}: ${e.error}`));
  }
  console.log(`✈️ Ofertas encontradas: ${results.flightDeals.length}`);
  console.log(`⏱️ Duración: ${duration.toFixed(1)}s`);
  logMemory();

  if (results.flightDeals.length > 0) {
    console.log('\n🎯 ALERTAS:');
    results.flightDeals.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.routeName}: €${d.price} (${d.airline}) — ${formatDate(d.departureDate)}`);
    });
  }

  // ══════════════ TELEGRAM ══════════════
  if (notifyDeals && isActive() && totalNewDeals > 0) {
    try {
      await sendDealsReport(results.flightDeals, []);
      console.log(`📱 Alerta Telegram enviada (${totalNewDeals} ofertas)`);
    } catch (telegramErr) {
      console.error(`❌ Error enviando Telegram: ${telegramErr.message}`);
    }
  } else if (totalNewDeals === 0) {
    console.log('📴 Sin ofertas alertables — no se envía Telegram');
  }

  console.log(`\n✅ BÚSQUEDA COMPLETADA a las ${new Date().toLocaleString('es-ES')}`);
  console.log('='.repeat(60) + '\n');

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
    console.log(`   ✈️ ${r.name} — ${dateLabel} [ALERTA ≤ €${r.threshold}]`);
  }
  console.log('');

  cronJob = cron.schedule(cronSchedule, async () => {
    console.log('\n' + '🔔'.repeat(30));
    console.log(`⏰ BÚSQUEDA PROGRAMADA CRON: ${new Date().toLocaleString('es-ES')}`);
    console.log('🔔'.repeat(30));
    try {
      searchRunning = true;
      await runFullSearch();
    } catch (error) {
      console.error('❌ Error FATAL en búsqueda programada:', error.message);
      console.error(error.stack);
      try {
        if (isActive()) await sendErrorAlert(error, 'Búsqueda programada');
      } catch (e) {
        console.error('❌ No se pudo enviar alerta de error:', e.message);
      }
    } finally {
      searchRunning = false;
      console.log(`⏰ Próxima búsqueda: en ~30 minutos (${new Date(Date.now() + 30*60*1000).toLocaleString('es-ES')})`);
    }
  }, {
    scheduled: true,
    timezone,
  });

  isMonitoring = true;
  console.log('✅ Monitoreo CRON iniciado — el proceso DEBE seguir vivo');
  console.log(`⏰ Próxima búsqueda programada: ~30 minutos\n`);
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
