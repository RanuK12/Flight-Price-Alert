const { scrapeGoogleFlights } = require('./skyscanner');
const { scrapeKayak } = require('./kayak');

// Coordinar múltiples fuentes de scraping
async function scrapeAllSources(origin, destination, isRoundTrip = false) {
  const tripType = isRoundTrip ? 'ida y vuelta' : 'solo ida';
  console.log(`\n🔍 Buscando vuelos: ${origin} → ${destination} (${tripType})`);
  
  const results = {
    origin,
    destination,
    isRoundTrip,
    sources: [],
    minPrice: Infinity,
    cheapestFlight: null,
    allFlights: [],
  };

  try {
    // Scrape Google Flights (más confiable)
    try {
      const googleResult = await scrapeGoogleFlights(origin, destination, isRoundTrip);
      results.sources.push({
        name: 'Google Flights',
        minPrice: googleResult.minPrice,
        flightCount: googleResult.flights?.length || 0,
        success: googleResult.success,
      });
      
      if (googleResult.flights && googleResult.flights.length > 0) {
        results.allFlights.push(...googleResult.flights);
        
        if (googleResult.minPrice && googleResult.minPrice < results.minPrice) {
          results.minPrice = googleResult.minPrice;
          results.cheapestFlight = googleResult.flights[0];
        }
      }
    } catch (err) {
      console.error(`Google Flights error: ${err.message}`);
    }

    // Scrape Kayak (backup)
    try {
      const kayakResult = await scrapeKayak(origin, destination, isRoundTrip ? '2026-04-11' : null);
      results.sources.push({
        name: 'Kayak',
        minPrice: kayakResult.minPrice,
        flightCount: kayakResult.flights?.length || 0,
        success: kayakResult.success,
      });
      
      if (kayakResult.flights && kayakResult.flights.length > 0) {
        results.allFlights.push(...kayakResult.flights);
        
        if (kayakResult.minPrice && kayakResult.minPrice < results.minPrice) {
          results.minPrice = kayakResult.minPrice;
          results.cheapestFlight = kayakResult.flights[0];
        }
      }
    } catch (err) {
      console.error(`Kayak error: ${err.message}`);
    }

    // Remover vuelos duplicados
    const uniqueFlights = [];
    const seen = new Set();

    results.allFlights.forEach(flight => {
      const key = `${flight.airline}-${flight.price}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFlights.push(flight);
      }
    });

    results.allFlights = uniqueFlights.sort((a, b) => a.price - b.price);

    if (results.minPrice === Infinity) {
      results.minPrice = null;
      console.log(`⚠️ No se encontraron precios reales`);
    } else {
      console.log(`✅ Precio mínimo REAL: €${results.minPrice}`);
    }

    return results;

  } catch (error) {
    console.error(`Error general en scraping: ${error.message}`);
    throw error;
  }
}

module.exports = {
  scrapeAllSources,
};
