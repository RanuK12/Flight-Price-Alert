/**
 * Google Flights Scraper usando SerpApi
 * 
 * Obtiene precios REALES de vuelos usando la API de Google Flights
 * Incluye detección de ofertas basada en price_insights
 */

const axios = require('axios');

// API Key de SerpApi (plan gratuito: 250 búsquedas/mes)
const SERPAPI_KEY = process.env.SERPAPI_KEY || '';

/**
 * Códigos IATA de aeropuertos principales
 */
const AIRPORTS = {
  // Argentina
  'EZE': { name: 'Buenos Aires Ezeiza', country: 'Argentina', city: 'Buenos Aires' },
  'AEP': { name: 'Buenos Aires Aeroparque', country: 'Argentina', city: 'Buenos Aires' },
  'COR': { name: 'Córdoba', country: 'Argentina', city: 'Córdoba' },
  
  // Europa - Ciudades con vuelos económicos
  'MAD': { name: 'Madrid Barajas', country: 'España', city: 'Madrid' },
  'BCN': { name: 'Barcelona El Prat', country: 'España', city: 'Barcelona' },
  'LIS': { name: 'Lisboa Portela', country: 'Portugal', city: 'Lisboa' },
  'FCO': { name: 'Roma Fiumicino', country: 'Italia', city: 'Roma' },
  'MXP': { name: 'Milán Malpensa', country: 'Italia', city: 'Milán' },
  'CDG': { name: 'París Charles de Gaulle', country: 'Francia', city: 'París' },
  'FRA': { name: 'Frankfurt', country: 'Alemania', city: 'Frankfurt' },
  'AMS': { name: 'Amsterdam Schiphol', country: 'Países Bajos', city: 'Amsterdam' },
  'LHR': { name: 'Londres Heathrow', country: 'Reino Unido', city: 'Londres' },
  'LGW': { name: 'Londres Gatwick', country: 'Reino Unido', city: 'Londres' },
  
  // Estados Unidos
  'JFK': { name: 'New York JFK', country: 'USA', city: 'New York' },
  'EWR': { name: 'Newark', country: 'USA', city: 'New York' },
  'MIA': { name: 'Miami', country: 'USA', city: 'Miami' },
  'LAX': { name: 'Los Angeles', country: 'USA', city: 'Los Angeles' },
  'ORD': { name: 'Chicago O\'Hare', country: 'USA', city: 'Chicago' },
  'ATL': { name: 'Atlanta', country: 'USA', city: 'Atlanta' },
};

/**
 * Precios de referencia para detectar ofertas (en EUR)
 * Basados en promedios históricos para vuelos de ida
 */
const REFERENCE_PRICES = {
  // Europa → Argentina (precios típicos ida)
  'MAD-EZE': { typical: 650, deal: 400, steal: 300 },
  'BCN-EZE': { typical: 680, deal: 420, steal: 320 },
  'LIS-EZE': { typical: 600, deal: 380, steal: 280 },
  'FCO-EZE': { typical: 700, deal: 450, steal: 350 },
  'CDG-EZE': { typical: 720, deal: 460, steal: 360 },
  'FRA-EZE': { typical: 700, deal: 440, steal: 340 },
  'AMS-EZE': { typical: 680, deal: 430, steal: 330 },
  'LHR-EZE': { typical: 750, deal: 480, steal: 380 },
  
  // Europa → USA (precios típicos ida)
  'MAD-JFK': { typical: 400, deal: 250, steal: 180 },
  'MAD-MIA': { typical: 420, deal: 260, steal: 190 },
  'BCN-JFK': { typical: 420, deal: 260, steal: 200 },
  'LIS-JFK': { typical: 380, deal: 240, steal: 170 },
  'CDG-JFK': { typical: 380, deal: 230, steal: 160 },
  'LHR-JFK': { typical: 350, deal: 220, steal: 150 },
  'FRA-JFK': { typical: 400, deal: 250, steal: 180 },
  'AMS-JFK': { typical: 380, deal: 240, steal: 170 },
};

/**
 * Genera fechas de búsqueda (próximos días/semanas/meses)
 */
function generateSearchDates(daysAhead = [7, 14, 30, 45, 60, 90]) {
  const dates = [];
  const today = new Date();
  
  for (const days of daysAhead) {
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    dates.push(date.toISOString().split('T')[0]); // YYYY-MM-DD
  }
  
  return dates;
}

/**
 * Busca vuelos usando SerpApi Google Flights
 * 
 * @param {string} origin - Código IATA origen (ej: MAD)
 * @param {string} destination - Código IATA destino (ej: EZE)
 * @param {string} outboundDate - Fecha de ida YYYY-MM-DD
 * @param {string} returnDate - Fecha de vuelta YYYY-MM-DD (opcional)
 * @param {string} tripType - 'oneway' o 'roundtrip'
 */
async function searchGoogleFlights(origin, destination, outboundDate, returnDate = null, tripType = 'oneway') {
  if (!SERPAPI_KEY) {
    console.warn('⚠️ SERPAPI_KEY no configurada. Usando modo de simulación.');
    return simulateFlightSearch(origin, destination, outboundDate, returnDate, tripType);
  }

  const params = {
    engine: 'google_flights',
    departure_id: origin,
    arrival_id: destination,
    outbound_date: outboundDate,
    currency: 'EUR',
    hl: 'es',
    gl: 'es',
    type: tripType === 'roundtrip' ? 1 : 2, // 1=roundtrip, 2=oneway
    api_key: SERPAPI_KEY,
  };

  if (returnDate && tripType === 'roundtrip') {
    params.return_date = returnDate;
  }

  try {
    console.log(`  🔍 Buscando ${origin} → ${destination} (${outboundDate})...`);
    
    const response = await axios.get('https://serpapi.com/search', { params });
    const data = response.data;

    if (!data) {
      throw new Error('Sin respuesta de SerpApi');
    }

    return parseGoogleFlightsResponse(data, origin, destination, outboundDate, returnDate, tripType);
    
  } catch (error) {
    console.error(`  ❌ Error en búsqueda ${origin}-${destination}:`, error.message);
    return {
      success: false,
      error: error.message,
      origin,
      destination,
      outboundDate,
    };
  }
}

/**
 * Parsea la respuesta de Google Flights
 */
function parseGoogleFlightsResponse(data, origin, destination, outboundDate, returnDate, tripType) {
  const result = {
    success: true,
    origin,
    destination,
    originInfo: AIRPORTS[origin] || { name: origin },
    destinationInfo: AIRPORTS[destination] || { name: destination },
    outboundDate,
    returnDate,
    tripType,
    searchedAt: new Date().toISOString(),
    flights: [],
    bestFlights: [],
    priceInsights: null,
    lowestPrice: null,
    isDeal: false,
    dealLevel: null, // 'good', 'great', 'steal'
  };

  // Extraer price_insights (clave para detectar ofertas)
  if (data.price_insights) {
    result.priceInsights = {
      lowestPrice: data.price_insights.lowest_price,
      priceLevel: data.price_insights.price_level, // 'low', 'typical', 'high'
      typicalPriceRange: data.price_insights.typical_price_range || [],
    };
    result.lowestPrice = data.price_insights.lowest_price;
  }

  // Extraer mejores vuelos
  if (data.best_flights && data.best_flights.length > 0) {
    result.bestFlights = data.best_flights.map(flight => parseFlightData(flight, origin, destination));
    
    if (!result.lowestPrice && result.bestFlights.length > 0) {
      result.lowestPrice = Math.min(...result.bestFlights.map(f => f.price));
    }
  }

  // Extraer otros vuelos
  if (data.other_flights && data.other_flights.length > 0) {
    result.flights = data.other_flights.map(flight => parseFlightData(flight, origin, destination));
  }

  // Combinar todos los vuelos
  const allFlights = [...result.bestFlights, ...result.flights];
  
  // Calcular si es una oferta
  const routeKey = `${origin}-${destination}`;
  const reference = REFERENCE_PRICES[routeKey];
  
  if (reference && result.lowestPrice) {
    if (result.lowestPrice <= reference.steal) {
      result.isDeal = true;
      result.dealLevel = 'steal'; // Ganga increíble
    } else if (result.lowestPrice <= reference.deal) {
      result.isDeal = true;
      result.dealLevel = 'great'; // Muy buena oferta
    } else if (result.lowestPrice <= reference.typical * 0.75) {
      result.isDeal = true;
      result.dealLevel = 'good'; // Buena oferta
    }
  }

  // También usar price_insights de Google si está disponible
  if (result.priceInsights?.priceLevel === 'low') {
    result.isDeal = true;
    if (!result.dealLevel) result.dealLevel = 'good';
  }

  return result;
}

/**
 * Parsea datos de un vuelo individual
 */
function parseFlightData(flight, origin, destination) {
  const segments = flight.flights || [];
  
  return {
    price: flight.price,
    currency: 'EUR',
    totalDuration: flight.total_duration, // minutos
    type: flight.type,
    airline: segments[0]?.airline || 'Multiple',
    airlineLogo: flight.airline_logo,
    stops: segments.length - 1,
    segments: segments.map(seg => ({
      airline: seg.airline,
      flightNumber: seg.flight_number,
      departure: {
        airport: seg.departure_airport?.id,
        airportName: seg.departure_airport?.name,
        time: seg.departure_airport?.time,
      },
      arrival: {
        airport: seg.arrival_airport?.id,
        airportName: seg.arrival_airport?.name,
        time: seg.arrival_airport?.time,
      },
      duration: seg.duration,
      airplane: seg.airplane,
      travelClass: seg.travel_class,
    })),
    layovers: (flight.layovers || []).map(lay => ({
      duration: lay.duration,
      airport: lay.id,
      airportName: lay.name,
      overnight: lay.overnight || false,
    })),
    bookingToken: flight.booking_token,
    carbonEmissions: flight.carbon_emissions,
    extensions: flight.extensions || [],
  };
}

/**
 * Genera URL de reserva en Google Flights
 */
function generateBookingUrl(origin, destination, outboundDate, returnDate = null) {
  const baseUrl = 'https://www.google.com/travel/flights';
  const params = new URLSearchParams({
    hl: 'es',
    gl: 'es',
    curr: 'EUR',
  });
  
  // Formato simplificado de la URL
  let url = `${baseUrl}?${params.toString()}`;
  url += `#flt=${origin}.${destination}.${outboundDate.replace(/-/g, '')}`;
  
  if (returnDate) {
    url += `*${destination}.${origin}.${returnDate.replace(/-/g, '')}`;
  }
  
  return url;
}

/**
 * Modo simulación cuando no hay API key
 * Genera datos realistas basados en precios de referencia
 */
function simulateFlightSearch(origin, destination, outboundDate, returnDate, tripType) {
  const routeKey = `${origin}-${destination}`;
  const reference = REFERENCE_PRICES[routeKey] || { typical: 500, deal: 350, steal: 250 };
  
  // Simular variación de precio (-20% a +30% del típico)
  const variation = 0.8 + Math.random() * 0.5;
  const basePrice = Math.round(reference.typical * variation);
  
  // Ocasionalmente generar una "oferta" (10% de las veces)
  const isSimulatedDeal = Math.random() < 0.1;
  const price = isSimulatedDeal 
    ? Math.round(reference.deal * (0.8 + Math.random() * 0.3))
    : basePrice;

  const airlines = ['Iberia', 'Air Europa', 'LATAM', 'Aerolíneas Argentinas', 'Level', 'Norwegian', 'TAP'];
  const airline = airlines[Math.floor(Math.random() * airlines.length)];

  return {
    success: true,
    simulated: true,
    origin,
    destination,
    originInfo: AIRPORTS[origin] || { name: origin },
    destinationInfo: AIRPORTS[destination] || { name: destination },
    outboundDate,
    returnDate,
    tripType,
    searchedAt: new Date().toISOString(),
    lowestPrice: price,
    isDeal: price <= reference.deal,
    dealLevel: price <= reference.steal ? 'steal' : (price <= reference.deal ? 'great' : null),
    priceInsights: {
      lowestPrice: price,
      priceLevel: price <= reference.deal ? 'low' : 'typical',
      typicalPriceRange: [reference.deal, reference.typical * 1.2],
    },
    bestFlights: [{
      price,
      currency: 'EUR',
      totalDuration: 780 + Math.floor(Math.random() * 300),
      type: tripType === 'roundtrip' ? 'Round trip' : 'One way',
      airline,
      stops: Math.random() > 0.3 ? 1 : 0,
      segments: [{
        airline,
        departure: { airport: origin, time: outboundDate + ' 10:00' },
        arrival: { airport: destination, time: outboundDate + ' 20:00' },
      }],
    }],
    flights: [],
    bookingUrl: generateBookingUrl(origin, destination, outboundDate, returnDate),
  };
}

/**
 * Busca ofertas en múltiples rutas
 */
async function searchDeals(routes, dates = null) {
  const searchDates = dates || generateSearchDates([7, 14, 21, 30, 45, 60]);
  const results = [];
  const deals = [];

  for (const route of routes) {
    for (const date of searchDates) {
      try {
        // Pequeña pausa para no sobrecargar la API
        await new Promise(r => setTimeout(r, 500));
        
        const result = await searchGoogleFlights(
          route.origin,
          route.destination,
          date,
          route.returnDate || null,
          route.tripType || 'oneway'
        );

        results.push(result);

        if (result.isDeal) {
          deals.push({
            ...result,
            route: `${route.origin} → ${route.destination}`,
            bookingUrl: generateBookingUrl(route.origin, route.destination, date),
          });
          console.log(`  🔥 ¡OFERTA! ${route.origin}→${route.destination} ${date}: €${result.lowestPrice} (${result.dealLevel})`);
        }
      } catch (err) {
        console.error(`  Error buscando ${route.origin}-${route.destination}:`, err.message);
      }
    }
  }

  return {
    totalSearches: results.length,
    successfulSearches: results.filter(r => r.success).length,
    dealsFound: deals.length,
    deals: deals.sort((a, b) => a.lowestPrice - b.lowestPrice),
    allResults: results,
    searchedAt: new Date().toISOString(),
  };
}

module.exports = {
  searchGoogleFlights,
  searchDeals,
  generateSearchDates,
  generateBookingUrl,
  AIRPORTS,
  REFERENCE_PRICES,
};
