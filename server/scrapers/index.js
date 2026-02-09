/**
 * Coordinador de búsqueda de vuelos - PRECIOS REALES
 * 
 * Prioridad de fuentes:
 * 1. Puppeteer (Google Flights) - No requiere API key, siempre disponible
 * 2. SerpApi (Google Flights) - Si hay SERPAPI_KEY
 * 3. Amadeus - Si hay AMADEUS_API_KEY
 * 4. Kiwi - Si hay KIWI_API_KEY
 */

const { scrapeGoogleFlights } = require('./puppeteerGoogleFlights');

// APIs opcionales (solo si hay credenciales)
let amadeus = null;
let kiwi = null;
let serpApiSearch = null;

try {
  if (process.env.AMADEUS_API_KEY) {
    amadeus = require('./amadeus');
  }
} catch (e) { /* Módulo no disponible */ }

try {
  if (process.env.KIWI_API_KEY) {
    kiwi = require('./kiwi');
  }
} catch (e) { /* Módulo no disponible */ }

try {
  if (process.env.SERPAPI_KEY) {
    const gf = require('./googleFlights');
    serpApiSearch = gf.searchGoogleFlights;
  }
} catch (e) { /* Módulo no disponible */ }

// Fechas de búsqueda por defecto
const DEFAULT_DEPARTURE = process.env.SEARCH_DATE_DEFAULT_DEPARTURE || '2026-03-28';
const DEFAULT_RETURN = process.env.SEARCH_DATE_DEFAULT_RETURN || '2026-04-04';

/**
 * Buscar vuelos en todas las fuentes disponibles
 * Prioridad: Puppeteer (siempre) > SerpApi > Amadeus > Kiwi
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
  // FUENTES ADICIONALES (solo si hay API keys configuradas)
  // ══════════════════════════════════════════════════════════════
  
  // SerpApi (si está configurado)
  if (serpApiSearch && process.env.SERPAPI_KEY) {
    try {
      const trip = isRoundTrip ? 'roundtrip' : 'oneway';
      const serpResult = await serpApiSearch(origin, destination, departureDate, isRoundTrip ? returnDate : null, trip);
      
      if (serpResult?.success && serpResult.lowestPrice) {
        const flight = {
          price: serpResult.lowestPrice,
          airline: serpResult.bestFlights?.[0]?.airline || 'Multiple',
          source: 'SerpApi',
          departureDate,
          returnDate: isRoundTrip ? returnDate : null,
          link: serpResult.bookingUrl || serpResult.searchUrl,
        };
        
        results.allFlights.push(flight);
        results.sources.push({
          name: 'SerpApi',
          minPrice: serpResult.lowestPrice,
          success: true,
        });
        
        if (serpResult.lowestPrice < results.minPrice) {
          results.minPrice = serpResult.lowestPrice;
          results.cheapestFlight = flight;
        }
      }
    } catch (err) {
      console.log(`  ⚠️ SerpApi: ${err.message}`);
    }
  }

  // Amadeus (si está configurado)
  if (amadeus && process.env.AMADEUS_API_KEY) {
    try {
      const amadeusResult = isRoundTrip
        ? await amadeus.searchRoundTrip(origin, destination, departureDate, returnDate)
        : await amadeus.searchOneWay(origin, destination, departureDate);
      
      if (amadeusResult.flights && amadeusResult.flights.length > 0) {
        const flightsWithSource = amadeusResult.flights.map(f => ({ ...f, source: 'Amadeus' }));
        results.allFlights.push(...flightsWithSource);
        
        const minPrice = Math.min(...amadeusResult.flights.map(f => f.price));
        results.sources.push({
          name: 'Amadeus',
          minPrice,
          flightCount: amadeusResult.flights.length,
          success: true,
        });
        
        if (minPrice < results.minPrice) {
          results.minPrice = minPrice;
          results.cheapestFlight = flightsWithSource.find(f => f.price === minPrice);
        }
      }
    } catch (err) {
      console.log(`  ⚠️ Amadeus: ${err.message}`);
    }
  }

  // Kiwi (si está configurado)
  if (kiwi && process.env.KIWI_API_KEY) {
    try {
      const kiwiResult = isRoundTrip
        ? await kiwi.searchRoundTrip(origin, destination, departureDate, returnDate)
        : await kiwi.searchOneWay(origin, destination, departureDate);
      
      if (kiwiResult.flights && kiwiResult.flights.length > 0) {
        const flightsWithSource = kiwiResult.flights.map(f => ({ ...f, source: 'Kiwi' }));
        results.allFlights.push(...flightsWithSource);
        
        const minPrice = Math.min(...kiwiResult.flights.map(f => f.price));
        results.sources.push({
          name: 'Kiwi',
          minPrice,
          flightCount: kiwiResult.flights.length,
          success: true,
        });
        
        if (minPrice < results.minPrice) {
          results.minPrice = minPrice;
          results.cheapestFlight = flightsWithSource.find(f => f.price === minPrice);
        }
      }
    } catch (err) {
      console.log(`  ⚠️ Kiwi: ${err.message}`);
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
