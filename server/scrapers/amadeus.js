/**
 * Amadeus API - Precios REALES de vuelos
 * Registrarse gratis en: https://developers.amadeus.com/
 * Tier gratuito: 2000 llamadas/mes
 */

const axios = require('axios');

// Credenciales Amadeus (obtener en https://developers.amadeus.com/)
const AMADEUS_API_KEY = process.env.AMADEUS_API_KEY || '';
const AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET || '';

let accessToken = null;
let tokenExpiry = null;

/**
 * Obtener token de acceso de Amadeus
 */
async function getAccessToken() {
  // Si el token aún es válido, reutilizarlo
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  if (!AMADEUS_API_KEY || !AMADEUS_API_SECRET) {
    console.log('⚠️ Amadeus: No hay credenciales configuradas');
    return null;
  }

  try {
    const response = await axios.post(
      'https://api.amadeus.com/v1/security/oauth2/token',
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: AMADEUS_API_KEY,
        client_secret: AMADEUS_API_SECRET,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    accessToken = response.data.access_token;
    // Token expira en ~30 minutos, renovar 5 min antes
    tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;
    
    console.log('✅ Amadeus: Token obtenido correctamente');
    return accessToken;
  } catch (error) {
    console.error('❌ Amadeus: Error obteniendo token:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Buscar vuelos con Amadeus Flight Offers Search API
 * @param {string} origin - Código IATA origen (ej: MAD)
 * @param {string} destination - Código IATA destino (ej: EZE)
 * @param {string} departureDate - Fecha YYYY-MM-DD
 * @param {string|null} returnDate - Fecha vuelta (null para solo ida)
 * @param {number} adults - Número de adultos
 */
async function searchFlights(origin, destination, departureDate, returnDate = null, adults = 1) {
  const token = await getAccessToken();
  if (!token) {
    return { flights: [], error: 'No hay token de Amadeus' };
  }

  try {
    const params = {
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate: departureDate,
      adults: adults,
      currencyCode: 'EUR',
      max: 10, // Máximo 10 resultados para no gastar cuota
    };

    if (returnDate) {
      params.returnDate = returnDate;
    }

    console.log(`🔍 Amadeus: Buscando ${origin} → ${destination} (${departureDate}${returnDate ? ' ↔ ' + returnDate : ''})`);

    const response = await axios.get(
      'https://api.amadeus.com/v2/shopping/flight-offers',
      {
        params,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const flights = [];
    
    if (response.data.data && response.data.data.length > 0) {
      for (const offer of response.data.data) {
        const price = parseFloat(offer.price.total);
        
        // Obtener aerolíneas del itinerario
        const airlines = new Set();
        for (const itinerary of offer.itineraries) {
          for (const segment of itinerary.segments) {
            airlines.add(segment.carrierCode);
          }
        }
        
        // Obtener información del primer segmento
        const firstSegment = offer.itineraries[0].segments[0];
        const lastSegment = offer.itineraries[0].segments[offer.itineraries[0].segments.length - 1];
        
        flights.push({
          price: price,
          currency: offer.price.currency,
          airline: Array.from(airlines).join(', '),
          departureDate: firstSegment.departure.at.split('T')[0],
          departureTime: firstSegment.departure.at.split('T')[1]?.substring(0, 5),
          arrivalDate: lastSegment.arrival.at.split('T')[0],
          arrivalTime: lastSegment.arrival.at.split('T')[1]?.substring(0, 5),
          stops: offer.itineraries[0].segments.length - 1,
          duration: offer.itineraries[0].duration,
          source: 'Amadeus',
          isRoundTrip: offer.itineraries.length > 1,
          returnDate: offer.itineraries.length > 1 
            ? offer.itineraries[1].segments[0].departure.at.split('T')[0] 
            : null,
          bookingClass: offer.travelerPricings[0].fareDetailsBySegment[0].cabin,
          link: `https://www.google.com/travel/flights?q=flights%20from%20${origin}%20to%20${destination}%20on%20${departureDate}`,
        });
      }
      
      console.log(`✅ Amadeus: ${flights.length} vuelos encontrados (min €${Math.min(...flights.map(f => f.price))})`);
    } else {
      console.log('⚠️ Amadeus: Sin resultados');
    }

    return { flights, error: null };
  } catch (error) {
    const errorMsg = error.response?.data?.errors?.[0]?.detail || error.message;
    console.error('❌ Amadeus error:', errorMsg);
    return { flights: [], error: errorMsg };
  }
}

/**
 * Wrapper para buscar solo ida
 */
async function searchOneWay(origin, destination, departureDate) {
  return searchFlights(origin, destination, departureDate, null);
}

/**
 * Wrapper para buscar ida y vuelta
 */
async function searchRoundTrip(origin, destination, departureDate, returnDate) {
  return searchFlights(origin, destination, departureDate, returnDate);
}

module.exports = {
  searchFlights,
  searchOneWay,
  searchRoundTrip,
  getAccessToken,
};
