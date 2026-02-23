/**
 * Coordinador de búsqueda de vuelos v2.0 — PRECIOS REALES
 * 
 * Fuentes:
 *   1. Puppeteer (Google Flights) — todas las aerolíneas, sin API key
 *   2. Ryanair API — precios directos low-cost (sin Puppeteer, puro HTTP)
 *
 * Ambas fuentes se consultan en paralelo y los resultados se combinan.
 */

const { scrapeGoogleFlights } = require('./puppeteerGoogleFlights');
const { scrapeRyanair, isRyanairRoute } = require('./ryanair');

// Fechas de búsqueda por defecto
const DEFAULT_DEPARTURE = process.env.SEARCH_DATE_DEFAULT_DEPARTURE || '2026-03-28';
const DEFAULT_RETURN = process.env.SEARCH_DATE_DEFAULT_RETURN || '2026-04-04';

/**
 * Buscar vuelos en todas las fuentes disponibles
 * 
 * @param {string} origin - Código IATA origen
 * @param {string} destination - Código IATA destino  
 * @param {boolean} isRoundTrip - Si es ida y vuelta
 * @param {string} departureDate - Fecha de ida
 * @param {string} returnDate - Fecha de vuelta (solo para ida y vuelta)
 */
async function scrapeAllSources(origin, destination, isRoundTrip = false, departureDate = DEFAULT_DEPARTURE, returnDate = DEFAULT_RETURN) {
  const tripType = isRoundTrip ? 'ida y vuelta' : 'solo ida';
  console.log(`\n🔍 Buscando vuelos: ${origin} → ${destination} (${tripType})`);
  
  const results = {
    origin,
    destination,
    isRoundTrip,
    departureDate,
    returnDate: isRoundTrip ? returnDate : null,
    sources: [],
    minPrice: Infinity,
    cheapestFlight: null,
    allFlights: [],
  };

  // ══════════════════════════════════════════════════════════════
  // Lanzar búsquedas en paralelo
  // ══════════════════════════════════════════════════════════════
  const promises = [];

  // FUENTE 1: Puppeteer (Google Flights)
  promises.push(
    scrapeGoogleFlights(origin, destination, departureDate, isRoundTrip ? returnDate : null)
      .then(r => ({ source: 'Puppeteer (Google Flights)', ...r }))
      .catch(err => ({ source: 'Puppeteer (Google Flights)', success: false, flights: [], minPrice: null, error: err.message }))
  );

  // FUENTE 2: Ryanair API (solo si es one-way y ruta disponible)
  if (!isRoundTrip && isRyanairRoute(origin, destination)) {
    promises.push(
      scrapeRyanair(origin, destination, departureDate)
        .then(r => ({ source: 'Ryanair API', ...r }))
        .catch(err => ({ source: 'Ryanair API', success: false, flights: [], minPrice: null, error: err.message }))
    );
  }

  // Esperar todos los resultados
  const sourceResults = await Promise.all(promises);

  // ══════════════════════════════════════════════════════════════
  // Procesar resultados de cada fuente
  // ══════════════════════════════════════════════════════════════
  for (const sr of sourceResults) {
    results.sources.push({
      name: sr.source,
      minPrice: sr.minPrice,
      flightCount: sr.flights?.length || 0,
      success: sr.success,
      error: sr.error || null,
    });

    if (sr.flights && sr.flights.length > 0) {
      results.allFlights.push(...sr.flights);

      if (sr.minPrice && sr.minPrice < results.minPrice) {
        results.minPrice = sr.minPrice;
        results.cheapestFlight = sr.flights[0];
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // POST-PROCESAMIENTO: Deduplicar y ordenar
  // ══════════════════════════════════════════════════════════════
  const uniqueFlights = [];
  const seen = new Set();

  results.allFlights
    .sort((a, b) => a.price - b.price)
    .forEach(flight => {
      const key = `${flight.airline}-${Math.round(flight.price)}-${flight.departureDate}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFlights.push(flight);
      }
    });

  results.allFlights = uniqueFlights;

  // Resumen
  if (results.minPrice === Infinity) {
    results.minPrice = null;
    console.log(`  ⚠️ Sin resultados de ninguna fuente`);
  } else {
    const sourcesOk = results.sources.filter(s => s.success).map(s => s.name).join(' + ');
    console.log(`  ✅ Precio mínimo: €${results.minPrice} (${results.cheapestFlight?.airline || 'N/A'}) [${sourcesOk}]`);
  }

  return results;
}

/**
 * Buscar vuelos con fechas flexibles
 */
async function searchFlexible(origin, destination, dateFrom, dateTo, isRoundTrip = false) {
  const dates = [];
  let current = new Date(dateFrom);
  const end = new Date(dateTo);

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 3);
  }

  const allResults = [];

  for (const date of dates) {
    const returnDate = isRoundTrip
      ? new Date(new Date(date).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : null;

    const result = await scrapeAllSources(origin, destination, isRoundTrip, date, returnDate);

    if (result.allFlights.length > 0) {
      allResults.push(...result.allFlights);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  return {
    flights: allResults.sort((a, b) => a.price - b.price),
    dateRange: { from: dateFrom, to: dateTo },
  };
}

module.exports = {
  scrapeAllSources,
  searchFlexible,
};
