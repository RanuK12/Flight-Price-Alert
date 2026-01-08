const { scrapeSkyscanner } = require('./skyscanner');
const { scrapeKayak } = require('./kayak');

// Coordinar múltiples fuentes de scraping
async function scrapeAllSources(origin, destination) {
  console.log(`\n🔍 Buscando vuelos: ${origin} → ${destination}`);
  
  const results = {
    origin,
    destination,
    sources: [],
    minPrice: Infinity,
    cheapestFlight: null,
    allFlights: [],
  };

  try {
    // Scrape Skyscanner
    try {
      const skyscannerResult = await scrapeSkyscanner(origin, destination);
      results.sources.push({
        name: 'Skyscanner',
        minPrice: skyscannerResult.minPrice,
        flightCount: skyscannerResult.flights.length,
        success: skyscannerResult.success,
      });
      
      if (skyscannerResult.flights) {
        results.allFlights.push(...skyscannerResult.flights);
      }
      
      if (skyscannerResult.minPrice < results.minPrice) {
        results.minPrice = skyscannerResult.minPrice;
        results.cheapestFlight = skyscannerResult.flights[0];
      }
    } catch (err) {
      console.error(`Skyscanner error: ${err.message}`);
    }

    // Scrape Kayak
    try {
      const kayakResult = await scrapeKayak(origin, destination);
      results.sources.push({
        name: 'Kayak',
        minPrice: kayakResult.minPrice,
        flightCount: kayakResult.flights.length,
        success: kayakResult.success,
      });
      
      if (kayakResult.flights) {
        results.allFlights.push(...kayakResult.flights);
      }
      
      if (kayakResult.minPrice < results.minPrice) {
        results.minPrice = kayakResult.minPrice;
        results.cheapestFlight = kayakResult.flights[0];
      }
    } catch (err) {
      console.error(`Kayak error: ${err.message}`);
    }

    // Remover vuelos duplicados (mismo precio, misma aerolínea)
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
      console.log(`❌ No se encontraron vuelos`);
    } else {
      console.log(`✅ Mínimo encontrado: €${results.minPrice}`);
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
