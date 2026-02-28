/**
 * Transit Scraper v1.0 — FlixBus API
 *
 * Busca precios de autobuses y trenes vía FlixBus/FlixTrain API.
 * Rutas: Trento→Múnich, Múnich→Amsterdam, Amsterdam→Madrid
 */

const axios = require('axios');

const FLIXBUS_API_BASE = 'https://global.api.flixbus.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Caché de city IDs (se resuelven una vez y se reusan)
const cityCache = {};

// City IDs hardcodeados como fallback (obtenidos de la API)
const FALLBACK_CITY_IDS = {
  'Trento':    '40dfd6cf-8646-11e6-9066-549f350fcb0c',
  'Munich':    '40d901a5-8646-11e6-9066-549f350fcb0c',
  'Amsterdam': '40dde3b8-8646-11e6-9066-549f350fcb0c',
  'Madrid':    '9a07bb38-3596-48eb-a857-18fd01199c62',
};

/**
 * Resuelve nombre de ciudad → FlixBus city UUID
 */
async function resolveCity(cityName) {
  if (cityCache[cityName]) return cityCache[cityName];

  try {
    const resp = await axios.get(`${FLIXBUS_API_BASE}/search/autocomplete/cities`, {
      params: { q: cityName, lang: 'en', flixbus_cities_only: false },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
    });

    if (resp.data && resp.data.length > 0) {
      const city = resp.data[0];
      cityCache[cityName] = city.id;
      return city.id;
    }
  } catch (err) {
    console.error(`  ⚠️ FlixBus autocomplete falló para ${cityName}: ${err.message}`);
  }

  // Fallback a IDs hardcodeados
  if (FALLBACK_CITY_IDS[cityName]) {
    cityCache[cityName] = FALLBACK_CITY_IDS[cityName];
    return FALLBACK_CITY_IDS[cityName];
  }

  return null;
}

/**
 * Busca viajes en FlixBus/FlixTrain para una ruta y fecha
 *
 * @param {string} originCity - Nombre de ciudad origen (ej: "Trento")
 * @param {string} destCity - Nombre de ciudad destino (ej: "Munich")
 * @param {string} departureDate - Fecha YYYY-MM-DD
 * @returns {object} Resultado con journeys, minPrice, etc.
 */
async function scrapeTransitPrices(originCity, destCity, departureDate) {
  console.log(`\n🚌 Buscando transit: ${originCity} → ${destCity} (${departureDate})`);

  const fromId = await resolveCity(originCity);
  const toId = await resolveCity(destCity);

  if (!fromId || !toId) {
    console.error(`  ❌ No se pudieron resolver ciudades: ${originCity}, ${destCity}`);
    return {
      success: false,
      journeys: [],
      minPrice: null,
      origin: originCity,
      destination: destCity,
      departureDate,
      error: `City lookup failed: ${originCity} or ${destCity}`,
      scrapedAt: new Date().toISOString(),
    };
  }

  // Formatear fecha DD.MM.YYYY
  const [y, m, d] = departureDate.split('-');
  const dateFormatted = `${d}.${m}.${y}`;

  try {
    const resp = await axios.get(`${FLIXBUS_API_BASE}/search/service/v4/search`, {
      params: {
        from_city_id: fromId,
        to_city_id: toId,
        departure_date: dateFormatted,
        products: JSON.stringify({ adult: 1 }),
        currency: 'EUR',
        locale: 'en',
        search_by: 'cities',
        include_after_midnight_departures: 1,
      },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
    });

    const trips = resp.data?.trips || [];
    const journeys = [];

    for (const trip of trips) {
      const results = trip.results || {};
      for (const [key, result] of Object.entries(results)) {
        if (result.status !== 'available') continue;

        const price = result.price?.total;
        if (!price || price <= 0) continue;

        // Determinar tipo de transporte (bus vs tren)
        const legs = result.legs || [];
        const means = legs.map(l => l.means_of_transport).filter(Boolean);
        let transportType = 'bus';
        if (means.some(m => m === 'train')) transportType = 'train';
        if (means.some(m => m === 'bus') && means.some(m => m === 'train')) transportType = 'bus+train';

        const depTime = result.departure?.date ? new Date(result.departure.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
        const arrTime = result.arrival?.date ? new Date(result.arrival.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
        const duration = result.duration ? `${result.duration.hours}h${result.duration.minutes > 0 ? result.duration.minutes + 'm' : ''}` : null;

        journeys.push({
          price: Math.round(price * 100) / 100,
          provider: result.provider === 'flixbus' ? 'FlixBus' : (result.provider || 'FlixBus'),
          transportType,
          transferType: result.transfer_type || 'Direct',
          departureTime: depTime,
          arrivalTime: arrTime,
          duration,
          departureDate,
          source: 'FlixBus API',
          link: `https://shop.flixbus.com/search?departureCity=${encodeURIComponent(fromId)}&arrivalCity=${encodeURIComponent(toId)}&rideDate=${dateFormatted}&adult=1&_locale=en`,
        });
      }
    }

    // Ordenar por precio
    journeys.sort((a, b) => a.price - b.price);

    const minPrice = journeys.length > 0 ? journeys[0].price : null;

    if (journeys.length > 0) {
      console.log(`  ✅ ${journeys.length} opciones encontradas. Mín: €${minPrice} (${journeys[0].transportType})`);
    } else {
      console.log(`  ⚠️ Sin resultados de FlixBus`);
    }

    return {
      success: journeys.length > 0,
      journeys,
      minPrice,
      origin: originCity,
      destination: destCity,
      departureDate,
      scrapedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`  ❌ Error FlixBus API: ${err.message}`);
    return {
      success: false,
      journeys: [],
      minPrice: null,
      origin: originCity,
      destination: destCity,
      departureDate,
      error: err.message,
      scrapedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  scrapeTransitPrices,
  resolveCity,
};
