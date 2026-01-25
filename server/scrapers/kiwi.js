/**
 * Kiwi.com (Tequila) API - Precios REALES de vuelos
 * Registrarse gratis en: https://tequila.kiwi.com/
 * Tier gratuito: Suficiente para uso personal
 */

const axios = require('axios');

// API Key de Kiwi/Tequila (obtener en https://tequila.kiwi.com/)
const KIWI_API_KEY = process.env.KIWI_API_KEY || '';

const TEQUILA_API = 'https://api.tequila.kiwi.com/v2';

/**
 * Convertir fecha de YYYY-MM-DD a DD/MM/YYYY (formato Kiwi)
 */
function formatDateForKiwi(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Buscar vuelos con Kiwi/Tequila API
 * @param {string} origin - Código IATA origen (ej: MAD)
 * @param {string} destination - Código IATA destino (ej: EZE)
 * @param {string} departureDate - Fecha YYYY-MM-DD
 * @param {string|null} returnDate - Fecha vuelta (null para solo ida)
 */
async function searchFlights(origin, destination, departureDate, returnDate = null) {
  if (!KIWI_API_KEY) {
    console.log('⚠️ Kiwi: No hay API key configurada');
    return { flights: [], error: 'No hay API key de Kiwi' };
  }

  try {
    const params = {
      fly_from: origin,
      fly_to: destination,
      date_from: formatDateForKiwi(departureDate),
      date_to: formatDateForKiwi(departureDate), // Mismo día para búsqueda exacta
      curr: 'EUR',
      locale: 'es',
      adults: 1,
      limit: 15,
      sort: 'price',
      vehicle_type: 'aircraft',
    };

    // Si es ida y vuelta
    if (returnDate) {
      params.return_from = formatDateForKiwi(returnDate);
      params.return_to = formatDateForKiwi(returnDate);
      params.flight_type = 'round';
    } else {
      params.flight_type = 'oneway';
    }

    console.log(`🔍 Kiwi: Buscando ${origin} → ${destination} (${departureDate}${returnDate ? ' ↔ ' + returnDate : ''})`);

    const response = await axios.get(`${TEQUILA_API}/search`, {
      params,
      headers: {
        apikey: KIWI_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    const flights = [];

    if (response.data.data && response.data.data.length > 0) {
      for (const offer of response.data.data) {
        // Extraer aerolíneas únicas
        const airlines = [...new Set(offer.route.map(r => r.airline))];
        
        // Contar escalas (solo ida)
        const outboundSegments = offer.route.filter(r => r.return === 0);
        const stops = Math.max(0, outboundSegments.length - 1);
        
        flights.push({
          price: offer.price,
          currency: 'EUR',
          airline: airlines.join(', '),
          departureDate: new Date(offer.dTime * 1000).toISOString().split('T')[0],
          departureTime: new Date(offer.dTime * 1000).toISOString().split('T')[1].substring(0, 5),
          arrivalDate: new Date(offer.aTime * 1000).toISOString().split('T')[0],
          arrivalTime: new Date(offer.aTime * 1000).toISOString().split('T')[1].substring(0, 5),
          stops: stops,
          duration: `${Math.floor(offer.fly_duration / 3600)}h ${Math.floor((offer.fly_duration % 3600) / 60)}m`,
          source: 'Kiwi',
          isRoundTrip: returnDate !== null,
          returnDate: returnDate,
          link: offer.deep_link,
          bookingToken: offer.booking_token,
        });
      }
      
      console.log(`✅ Kiwi: ${flights.length} vuelos encontrados (min €${Math.min(...flights.map(f => f.price))})`);
    } else {
      console.log('⚠️ Kiwi: Sin resultados');
    }

    return { flights, error: null };
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ Kiwi error:', errorMsg);
    return { flights: [], error: errorMsg };
  }
}

/**
 * Buscar vuelos flexibles (rango de fechas)
 */
async function searchFlexible(origin, destination, dateFrom, dateTo, returnDateFrom = null, returnDateTo = null) {
  if (!KIWI_API_KEY) {
    console.log('⚠️ Kiwi: No hay API key configurada');
    return { flights: [], error: 'No hay API key de Kiwi' };
  }

  try {
    const params = {
      fly_from: origin,
      fly_to: destination,
      date_from: formatDateForKiwi(dateFrom),
      date_to: formatDateForKiwi(dateTo),
      curr: 'EUR',
      locale: 'es',
      adults: 1,
      limit: 20,
      sort: 'price',
      vehicle_type: 'aircraft',
    };

    if (returnDateFrom && returnDateTo) {
      params.return_from = formatDateForKiwi(returnDateFrom);
      params.return_to = formatDateForKiwi(returnDateTo);
      params.flight_type = 'round';
      params.nights_in_dst_from = 7;
      params.nights_in_dst_to = 21;
    } else {
      params.flight_type = 'oneway';
    }

    console.log(`🔍 Kiwi Flexible: ${origin} → ${destination} (${dateFrom} a ${dateTo})`);

    const response = await axios.get(`${TEQUILA_API}/search`, {
      params,
      headers: {
        apikey: KIWI_API_KEY,
      },
    });

    const flights = [];

    if (response.data.data && response.data.data.length > 0) {
      for (const offer of response.data.data) {
        const airlines = [...new Set(offer.route.map(r => r.airline))];
        const outboundSegments = offer.route.filter(r => r.return === 0);
        const stops = Math.max(0, outboundSegments.length - 1);
        
        // Calcular fecha de vuelta si existe
        let returnDate = null;
        const returnSegments = offer.route.filter(r => r.return === 1);
        if (returnSegments.length > 0) {
          returnDate = new Date(returnSegments[0].dTime * 1000).toISOString().split('T')[0];
        }

        flights.push({
          price: offer.price,
          currency: 'EUR',
          airline: airlines.join(', '),
          departureDate: new Date(offer.dTime * 1000).toISOString().split('T')[0],
          departureTime: new Date(offer.dTime * 1000).toISOString().split('T')[1].substring(0, 5),
          arrivalDate: new Date(offer.aTime * 1000).toISOString().split('T')[0],
          stops: stops,
          duration: `${Math.floor(offer.fly_duration / 3600)}h ${Math.floor((offer.fly_duration % 3600) / 60)}m`,
          source: 'Kiwi',
          isRoundTrip: returnSegments.length > 0,
          returnDate: returnDate,
          link: offer.deep_link,
        });
      }
      
      console.log(`✅ Kiwi Flexible: ${flights.length} vuelos encontrados`);
    }

    return { flights, error: null };
  } catch (error) {
    console.error('❌ Kiwi Flexible error:', error.message);
    return { flights: [], error: error.message };
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
  searchFlexible,
  searchOneWay,
  searchRoundTrip,
};
