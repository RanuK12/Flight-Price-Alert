/**
 * Ryanair API Scraper v1.0
 *
 * Consulta la API pública de Ryanair para obtener precios reales.
 * No necesita Puppeteer — usa HTTP directo (mucho más rápido).
 *
 * Rutas Ryanair confirmadas en España→Italia:
 *   MAD→FCO ✅, BCN→FCO ✅, MAD→VCE ✅, BCN→VCE ✅
 *
 * Ryanair NO vuela desde/hacia AMS (Schiphol). La alternativa sería
 * EIN (Eindhoven), pero no está en nuestras rutas monitoreadas.
 */

const https = require('https');

// ═══════════════════════════════════════════════════════════════
// RUTAS RYANAIR CONOCIDAS (solo las que nos interesan)
// ═══════════════════════════════════════════════════════════════
const RYANAIR_ROUTES = new Set([
  'MAD-FCO', 'FCO-MAD',
  'BCN-FCO', 'FCO-BCN',
  'MAD-VCE', 'VCE-MAD',
  'BCN-VCE', 'VCE-BCN',
  'FCO-BCN', 'BCN-FCO',
  // Ryanair NO sirve AMS — esas rutas las cubre Google Flights
]);

// ═══════════════════════════════════════════════════════════════
// CACHE (evitar llamadas repetidas)
// ═══════════════════════════════════════════════════════════════
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hora

function getCacheKey(origin, destination, date) {
  return `ryanair-${origin}-${destination}-${date}`;
}

// ═══════════════════════════════════════════════════════════════
// FETCH HELPER
// ═══════════════════════════════════════════════════════════════

/**
 * Realiza una petición HTTPS GET y devuelve JSON
 */
function fetchJSON(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Ryanair API timeout'));
    }, timeoutMs);

    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': 'https://www.ryanair.com/',
        'Origin': 'https://www.ryanair.com',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`Ryanair API HTTP ${res.statusCode}`));
            return;
          }
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Ryanair API parse error: ${e.message}`));
        }
      });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// SCRAPER PRINCIPAL
// ═══════════════════════════════════════════════════════════════

/**
 * Busca vuelos en Ryanair para una ruta y fecha específica.
 * Usa FlexDays para buscar ±2 días alrededor de la fecha dada.
 *
 * @param {string} origin - Código IATA origen (ej: MAD)
 * @param {string} destination - Código IATA destino (ej: FCO)
 * @param {string} departureDate - Fecha de ida (YYYY-MM-DD)
 * @returns {Object} { success, flights[], minPrice, error }
 */
async function scrapeRyanair(origin, destination, departureDate) {
  const routeKey = `${origin}-${destination}`;

  // 1. Verificar si Ryanair sirve esta ruta
  if (!RYANAIR_ROUTES.has(routeKey)) {
    return {
      success: false,
      flights: [],
      minPrice: null,
      error: `Ryanair no opera ${routeKey}`,
    };
  }

  // 2. Revisar cache
  const cacheKey = getCacheKey(origin, destination, departureDate);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`  ✈️ [Ryanair] Cache hit: ${routeKey} ${departureDate}`);
    return cached.data;
  }

  // 3. Construir URL de la API de disponibilidad
  const url = `https://www.ryanair.com/api/booking/v4/es-es/availability`
    + `?ADT=1&TEEN=0&CHD=0&INF=0`
    + `&DateOut=${departureDate}`
    + `&DateIn=`
    + `&Origin=${origin}`
    + `&Destination=${destination}`
    + `&Disc=0`
    + `&promoCode=`
    + `&IncludeConnectingFlights=false`
    + `&FlexDaysBeforeOut=2`
    + `&FlexDaysOut=2`
    + `&FlexDaysBeforeIn=0`
    + `&FlexDaysIn=0`
    + `&RoundTrip=false`
    + `&ToUs=AGREED`;

  console.log(`  ✈️ [Ryanair] Buscando ${routeKey} ${departureDate}...`);

  try {
    const data = await fetchJSON(url);
    const flights = [];

    // La API devuelve: { trips: [{ dates: [{ flights: [...] }] }] }
    if (data.trips && data.trips.length > 0) {
      for (const trip of data.trips) {
        if (!trip.dates) continue;
        for (const dateEntry of trip.dates) {
          if (!dateEntry.flights || dateEntry.flights.length === 0) continue;

          for (const flight of dateEntry.flights) {
            // Saltar vuelos sin plazas
            if (flight.faresLeft <= 0 && flight.faresLeft !== -1) continue;

            // Extraer precio del fare regular
            let price = null;
            if (flight.regularFare && flight.regularFare.fares) {
              for (const fare of flight.regularFare.fares) {
                if (fare.type === 'ADT' && fare.amount) {
                  price = fare.amount;
                  break;
                }
              }
            }

            if (!price || price <= 0) continue;

            // Extraer fecha del vuelo
            const flightDate = dateEntry.dateOut
              ? dateEntry.dateOut.split('T')[0]
              : departureDate;

            // Extraer horarios
            const depTime = flight.time ? flight.time[0] : null;
            const arrTime = flight.time ? flight.time[1] : null;

            flights.push({
              price: Math.round(price * 100) / 100,
              airline: 'Ryanair',
              source: 'Ryanair API',
              departureDate: flightDate,
              departureTime: depTime,
              arrivalTime: arrTime,
              flightNumber: flight.flightNumber || `FR-${origin}${destination}`,
              origin,
              destination,
              link: `https://www.ryanair.com/es/es/trip/flights/select?adults=1&teens=0&children=0&infants=0&dateOut=${flightDate}&dateIn=&originIata=${origin}&destinationIata=${destination}&isConnectedFlight=false&isReturn=false&discount=0&promoCode=&tpAdults=1&tpTeens=0&tpChildren=0&tpInfants=0&tpStartDate=${flightDate}&tpEndDate=&tpDiscount=0&tpPromoCode=&tpOriginIata=${origin}&tpDestinationIata=${destination}`,
            });
          }
        }
      }
    }

    // Ordenar por precio
    flights.sort((a, b) => a.price - b.price);
    const minPrice = flights.length > 0 ? flights[0].price : null;

    const result = {
      success: flights.length > 0,
      flights,
      minPrice,
      error: flights.length === 0 ? 'Sin vuelos disponibles' : null,
    };

    // Guardar en cache
    cache.set(cacheKey, { data: result, timestamp: Date.now() });

    if (flights.length > 0) {
      console.log(`  ✅ [Ryanair] ${flights.length} vuelos encontrados. Mínimo: €${minPrice}`);
    } else {
      console.log(`  ⚠️ [Ryanair] Sin vuelos para ${routeKey} ${departureDate}`);
    }

    return result;

  } catch (error) {
    console.error(`  ❌ [Ryanair] Error ${routeKey}: ${error.message}`);
    return {
      success: false,
      flights: [],
      minPrice: null,
      error: error.message,
    };
  }
}

/**
 * Verifica si Ryanair opera una ruta específica
 */
function isRyanairRoute(origin, destination) {
  return RYANAIR_ROUTES.has(`${origin}-${destination}`);
}

module.exports = {
  scrapeRyanair,
  isRyanairRoute,
  RYANAIR_ROUTES,
};
