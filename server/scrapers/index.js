/**
 * Coordinador de búsqueda de vuelos - APIs REALES
 * Usa Amadeus y Kiwi.com para obtener precios reales
 */

const amadeus = require('./amadeus');
const kiwi = require('./kiwi');

// Fechas de búsqueda por defecto
const DEFAULT_DEPARTURE = '2026-03-28';
const DEFAULT_RETURN = '2026-04-11';

/**
 * Buscar vuelos en todas las fuentes disponibles
 * @param {string} origin - Código IATA origen
 * @param {string} destination - Código IATA destino  
 * @param {boolean} isRoundTrip - Si es ida y vuelta
 * @param {string} departureDate - Fecha de ida
 * @param {string} returnDate - Fecha de vuelta (solo para ida y vuelta)
 */
async function scrapeAllSources(origin, destination, isRoundTrip = false, departureDate = DEFAULT_DEPARTURE, returnDate = DEFAULT_RETURN) {
  const tripType = isRoundTrip ? 'ida y vuelta' : 'solo ida';
  console.log(`\n🔍 Buscando vuelos REALES: ${origin} → ${destination} (${tripType})`);
  
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

  const searchPromises = [];

  // 1. Buscar en Amadeus
  if (process.env.AMADEUS_API_KEY) {
    const amadeusPromise = isRoundTrip
      ? amadeus.searchRoundTrip(origin, destination, departureDate, returnDate)
      : amadeus.searchOneWay(origin, destination, departureDate);
    
    searchPromises.push(
      amadeusPromise
        .then(result => ({ source: 'Amadeus', result }))
        .catch(err => ({ source: 'Amadeus', result: { flights: [], error: err.message } }))
    );
  } else {
    console.log('⚠️ Amadeus: Sin credenciales (AMADEUS_API_KEY)');
  }

  // 2. Buscar en Kiwi
  if (process.env.KIWI_API_KEY) {
    const kiwiPromise = isRoundTrip
      ? kiwi.searchRoundTrip(origin, destination, departureDate, returnDate)
      : kiwi.searchOneWay(origin, destination, departureDate);
    
    searchPromises.push(
      kiwiPromise
        .then(result => ({ source: 'Kiwi', result }))
        .catch(err => ({ source: 'Kiwi', result: { flights: [], error: err.message } }))
    );
  } else {
    console.log('⚠️ Kiwi: Sin credenciales (KIWI_API_KEY)');
  }

  // Si no hay ninguna API configurada, dar instrucciones
  if (searchPromises.length === 0) {
    console.log('\n❌ NO HAY APIs CONFIGURADAS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Para obtener precios REALES necesitas configurar al menos una API:');
    console.log('');
    console.log('📌 OPCIÓN 1: Amadeus (Recomendado, 2000 llamadas gratis/mes)');
    console.log('   1. Registrarse en: https://developers.amadeus.com/');
    console.log('   2. Crear una app en el dashboard');
    console.log('   3. Añadir en Railway:');
    console.log('      AMADEUS_API_KEY=tu_api_key');
    console.log('      AMADEUS_API_SECRET=tu_api_secret');
    console.log('');
    console.log('📌 OPCIÓN 2: Kiwi.com/Tequila (Gratis)');
    console.log('   1. Registrarse en: https://tequila.kiwi.com/');
    console.log('   2. Obtener API key del dashboard');
    console.log('   3. Añadir en Railway:');
    console.log('      KIWI_API_KEY=tu_api_key');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    return results;
  }

  // Ejecutar búsquedas en paralelo
  const searchResults = await Promise.all(searchPromises);

  // Procesar resultados
  for (const { source, result } of searchResults) {
    results.sources.push({
      name: source,
      minPrice: result.flights?.length > 0 ? Math.min(...result.flights.map(f => f.price)) : null,
      flightCount: result.flights?.length || 0,
      success: result.flights?.length > 0,
      error: result.error || null,
    });

    if (result.flights && result.flights.length > 0) {
      // Añadir source a cada vuelo
      const flightsWithSource = result.flights.map(f => ({
        ...f,
        source: source,
      }));
      
      results.allFlights.push(...flightsWithSource);

      const sourceMinPrice = Math.min(...result.flights.map(f => f.price));
      if (sourceMinPrice < results.minPrice) {
        results.minPrice = sourceMinPrice;
        results.cheapestFlight = result.flights.find(f => f.price === sourceMinPrice);
      }
    }
  }

  // Eliminar duplicados y ordenar por precio
  const uniqueFlights = [];
  const seen = new Set();

  results.allFlights
    .sort((a, b) => a.price - b.price)
    .forEach(flight => {
      // Clave única: aerolínea + precio + fecha
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
    console.log(`⚠️ Sin resultados de ninguna API`);
  } else {
    console.log(`\n✅ PRECIO MÍNIMO REAL: €${results.minPrice} (${results.cheapestFlight?.airline || 'N/A'})`);
    console.log(`📊 Total vuelos encontrados: ${results.allFlights.length}`);
  }

  return results;
}

/**
 * Buscar vuelos con fechas flexibles (solo Kiwi)
 */
async function searchFlexible(origin, destination, dateFrom, dateTo, isRoundTrip = false) {
  if (!process.env.KIWI_API_KEY) {
    console.log('⚠️ Búsqueda flexible requiere KIWI_API_KEY');
    return { flights: [], error: 'No Kiwi API key' };
  }

  if (isRoundTrip) {
    // Para ida y vuelta, buscar con rango de fechas para la vuelta también
    const returnFrom = new Date(dateFrom);
    returnFrom.setDate(returnFrom.getDate() + 7);
    const returnTo = new Date(dateTo);
    returnTo.setDate(returnTo.getDate() + 14);
    
    return kiwi.searchFlexible(
      origin, 
      destination, 
      dateFrom, 
      dateTo,
      returnFrom.toISOString().split('T')[0],
      returnTo.toISOString().split('T')[0]
    );
  }

  return kiwi.searchFlexible(origin, destination, dateFrom, dateTo);
}

module.exports = {
  scrapeAllSources,
  searchFlexible,
};
