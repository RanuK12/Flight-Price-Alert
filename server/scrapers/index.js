/**
 * Coordinador de búsqueda de vuelos - PRECIOS REALES
 * 
 * Fuente única: Puppeteer (Google Flights) - Sin API key, sin límites
 * SerpApi/Amadeus/Kiwi desactivados para evitar errores y límites.
 */

const { scrapeGoogleFlights } = require('./puppeteerGoogleFlights');

// Fechas de búsqueda por defecto
const DEFAULT_DEPARTURE = process.env.SEARCH_DATE_DEFAULT_DEPARTURE || '2026-03-28';
const DEFAULT_RETURN = process.env.SEARCH_DATE_DEFAULT_RETURN || '2026-04-04';

/**
 * Buscar vuelos en todas las fuentes disponibles
 * Fuente: Puppeteer (Google Flights) — sin API keys, sin límites
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
  // FUENTE PRINCIPAL: Puppeteer (Google Flights) - Sin API key
  // ══════════════════════════════════════════════════════════════
  try {
    const puppeteerResult = await scrapeGoogleFlights(
      origin, 
      destination, 
      departureDate, 
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
      
      if (puppeteerResult.minPrice && puppeteerResult.minPrice < results.minPrice) {
        results.minPrice = puppeteerResult.minPrice;
        results.cheapestFlight = puppeteerResult.flights[0];
      }
    }
  } catch (err) {
    console.error(`  ❌ Error Puppeteer: ${err.message}`);
    results.sources.push({
      name: 'Puppeteer (Google Flights)',
      success: false,
      error: err.message,
    });
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
    console.log(`  ⚠️ Sin resultados`);
  } else {
    console.log(`  ✅ Precio mínimo: €${results.minPrice} (${results.cheapestFlight?.airline || 'N/A'})`);
  }

  return results;
}

/**
 * Buscar vuelos con fechas flexibles
 */
async function searchFlexible(origin, destination, dateFrom, dateTo, isRoundTrip = false) {
  // Generar fechas cada 3 días dentro del rango
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
    
    // Pequeña pausa entre búsquedas para no sobrecargar
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Ordenar por precio y devolver
  return {
    flights: allResults.sort((a, b) => a.price - b.price),
    dateRange: { from: dateFrom, to: dateTo },
  };
}

module.exports = {
  scrapeAllSources,
  searchFlexible,
};
