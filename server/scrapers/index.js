/**
 * Coordinador de búsqueda de vuelos v4.0 — API DIRECTA + PUPPETEER FALLBACK
 *
 * Fuente principal: Google Flights API directa (sin browser)
 * Fallback: Puppeteer (Google Flights scraping)
 *
 * La API directa es ~10x más rápida y confiable que Puppeteer.
 */

const { searchFlightsApi, searchDateRange } = require('./googleFlightsApi');

// Puppeteer como fallback (lazy load)
let scrapeGoogleFlights = null;
try {
  scrapeGoogleFlights = require('./puppeteerGoogleFlights').scrapeGoogleFlights;
} catch (e) {
  console.log('⚠️ Puppeteer scraper not available (optional fallback)');
}

// Fechas de búsqueda por defecto
const DEFAULT_DEPARTURE = process.env.SEARCH_DATE_DEFAULT_DEPARTURE || '2026-04-19';
const DEFAULT_RETURN = process.env.SEARCH_DATE_DEFAULT_RETURN || '2026-04-24';

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
  // SOURCE 1: Google Flights API (primary - fast, no browser)
  // ══════════════════════════════════════════════════════════════
  let apiResult = null;
  try {
    apiResult = await searchFlightsApi(
      origin, destination, departureDate,
      isRoundTrip ? returnDate : null
    );

    results.sources.push({
      name: 'Google Flights API',
      minPrice: apiResult.minPrice,
      flightCount: apiResult.flights?.length || 0,
      success: apiResult.success,
      error: apiResult.error || null,
    });

    if (apiResult.flights && apiResult.flights.length > 0) {
      results.allFlights.push(...apiResult.flights);
    }
  } catch (err) {
    results.sources.push({
      name: 'Google Flights API',
      minPrice: null,
      flightCount: 0,
      success: false,
      error: err.message,
    });
  }

  // ══════════════════════════════════════════════════════════════
  // SOURCE 2: Puppeteer fallback (only if API returned 0 results)
  // DISABLED in production (Render free = 512MB, Chrome uses ~400MB → OOM kill)
  // ══════════════════════════════════════════════════════════════
  const apiGotResults = apiResult && apiResult.flights && apiResult.flights.length > 0;
  const isLowMemoryEnv = process.env.RENDER || process.env.DISABLE_PUPPETEER === 'true';

  if (!apiGotResults && scrapeGoogleFlights && !isLowMemoryEnv) {
    console.log('  🔄 API sin resultados, usando Puppeteer como fallback...');
    try {
      const puppeteerResult = await scrapeGoogleFlights(
        origin, destination, departureDate,
        isRoundTrip ? returnDate : null
      );

      results.sources.push({
        name: 'Puppeteer (Google Flights)',
        minPrice: puppeteerResult.minPrice,
        flightCount: puppeteerResult.flights?.length || 0,
        success: puppeteerResult.success,
        error: puppeteerResult.error || null,
      });

      if (puppeteerResult.flights && puppeteerResult.flights.length > 0) {
        results.allFlights.push(...puppeteerResult.flights);
      }
    } catch (err) {
      results.sources.push({
        name: 'Puppeteer (Google Flights)',
        minPrice: null,
        flightCount: 0,
        success: false,
        error: err.message,
      });
    }
  } else if (!apiGotResults && isLowMemoryEnv) {
    console.log('  ⏭️ Puppeteer deshabilitado en Render (poca memoria) — solo API');
  }

  // ══════════════════════════════════════════════════════════════
  // POST-PROCESSING: Deduplicate and sort
  // ══════════════════════════════════════════════════════════════
  const uniqueFlights = [];
  const seen = new Set();

  results.allFlights
    .sort((a, b) => a.price - b.price)
    .forEach(flight => {
      const key = `${flight.airline}-${Math.round(flight.price)}-${flight.departureDate || departureDate}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFlights.push(flight);
      }
    });

  results.allFlights = uniqueFlights;

  // Update min price
  if (uniqueFlights.length > 0) {
    results.minPrice = uniqueFlights[0].price;
    results.cheapestFlight = uniqueFlights[0];
    const sourcesOk = results.sources.filter(s => s.success).map(s => s.name).join(' + ');
    console.log(`  ✅ Precio mínimo: $${results.minPrice} (${results.cheapestFlight?.airline || 'N/A'}) [${sourcesOk}]`);
  } else {
    results.minPrice = null;
    console.log(`  ⚠️ Sin resultados de ninguna fuente`);
  }

  return results;
}

/**
 * Buscar vuelos con fechas flexibles usando la API de calendario
 */
async function searchFlexible(origin, destination, dateFrom, dateTo, isRoundTrip = false) {
  // Try the calendar API first for a quick overview
  const calendarResult = await searchDateRange(origin, destination, dateFrom, dateTo);

  if (calendarResult.success && calendarResult.dates.length > 0) {
    console.log(`  📅 Calendario API: ${calendarResult.dates.length} fechas con precios`);

    // Search top 5 cheapest dates for full details
    const topDates = calendarResult.dates.slice(0, 5);
    const allResults = [];

    for (const { date, price } of topDates) {
      const result = await scrapeAllSources(origin, destination, isRoundTrip, date);
      if (result.allFlights.length > 0) {
        allResults.push(...result.allFlights);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    return {
      flights: allResults.sort((a, b) => a.price - b.price),
      dateRange: { from: dateFrom, to: dateTo },
      calendarPrices: calendarResult.dates,
    };
  }

  // Fallback: search every 3 days
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
      ? new Date(new Date(date).getTime() + 14 * 86400000).toISOString().split('T')[0]
      : null;

    const result = await scrapeAllSources(origin, destination, isRoundTrip, date, returnDate);
    if (result.allFlights.length > 0) {
      allResults.push(...result.allFlights);
    }
    await new Promise(r => setTimeout(r, 1000));
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
