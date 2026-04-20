/**
 * Deep links "Reservar ahora" a la aerolínea o metasearch.
 *
 * Amadeus Self-Service NO provee una URL de booking directa a la
 * aerolínea (eso es parte de la Booking API enterprise). Con el
 * offer, podemos construir deep links best-effort por carrier:
 *
 *   1) Aerolínea directa (Iberia, Air Europa, AR, LATAM, Lufthansa…)
 *   2) Google Flights filtrado por carrier + fecha + ruta (universal)
 *   3) Skyscanner como backup
 *
 * Si el offer confirma precio con Amadeus pricing, usamos el offer.id
 * junto con los segmentos reales → link más fiable.
 *
 * @module bot/deepLinks
 */

'use strict';

/**
 * @typedef {import('../providers/base').Flight} Flight
 */

/**
 * Mapping IATA carrier → builder de URL directa en el sitio de la aerolínea.
 * Cada builder recibe datos ya normalizados y devuelve la URL o null si
 * no puede armarse.
 *
 * @type {Record<string, (args:{origin:string,destination:string,departureDate:string,returnDate?:string|null,flightNumber?:string,passengers?:number}) => string|null>}
 */
const CARRIER_BUILDERS = {
  // Iberia — sitio soporta query params de búsqueda
  IB: ({ origin, destination, departureDate, returnDate, passengers = 1 }) => {
    const base = 'https://www.iberia.com/es/vuelos/';
    const params = new URLSearchParams({
      market: 'es',
      originCode: origin,
      destinationCode: destination,
      departureDate,
      adults: String(passengers),
    });
    if (returnDate) params.set('returnDate', returnDate);
    return `${base}?${params.toString()}`;
  },

  // Air Europa
  UX: ({ origin, destination, departureDate, returnDate }) => {
    const params = new URLSearchParams({
      trip: returnDate ? 'RT' : 'OW',
      origin,
      destination,
      departure: departureDate,
      ...(returnDate ? { return: returnDate } : {}),
      adults: '1',
    });
    return `https://www.aireuropa.com/es/vuelos?${params.toString()}`;
  },

  // Aerolíneas Argentinas
  AR: ({ origin, destination, departureDate, returnDate }) => {
    const params = new URLSearchParams({
      origin,
      destination,
      departure: departureDate,
      ...(returnDate ? { return: returnDate, trip: 'RT' } : { trip: 'OW' }),
    });
    return `https://www.aerolineas.com.ar/es-ar/buscar-vuelos?${params.toString()}`;
  },

  // LATAM
  LA: ({ origin, destination, departureDate, returnDate }) => {
    const dateStr = returnDate ? `${departureDate}/${returnDate}` : departureDate;
    return `https://www.latamairlines.com/ar/es/ofertas-vuelos?origin=${origin}&destination=${destination}&outbound=${dateStr}&adt=1&chd=0&inf=0&trip=${returnDate ? 'RT' : 'OW'}`;
  },

  // Lufthansa
  LH: ({ origin, destination, departureDate, returnDate }) => {
    const path = returnDate
      ? `roundtrip/${origin}-${destination}/${departureDate}/${returnDate}`
      : `oneway/${origin}-${destination}/${departureDate}`;
    return `https://www.lufthansa.com/es/es/book/flight/${path}?adults=1`;
  },

  // KLM / Air France (comparten motor)
  KL: klmAf,
  AF: klmAf,

  // British Airways
  BA: ({ origin, destination, departureDate, returnDate }) => {
    const params = new URLSearchParams({
      eId: '111001',
      Origin: origin,
      Destination: destination,
      DepartDate: departureDate,
      ...(returnDate ? { ReturnDate: returnDate } : {}),
      CabinCode: 'M',
      NumberOfAdults: '1',
    });
    return `https://www.britishairways.com/travel/fx/public/es_es?${params.toString()}`;
  },

  // JetSmart
  JA: ({ origin, destination, departureDate, returnDate }) => {
    return `https://jetsmart.com/ar/es/?origin=${origin}&destination=${destination}&departure=${departureDate}${returnDate ? `&return=${returnDate}` : ''}`;
  },

  // Flybondi
  FO: ({ origin, destination, departureDate, returnDate }) => {
    return `https://flybondi.com/ar/book?origin=${origin}&destination=${destination}&departure=${departureDate}${returnDate ? `&return=${returnDate}` : ''}`;
  },
};

/** @type {typeof CARRIER_BUILDERS[string]} */
function klmAf({ origin, destination, departureDate, returnDate }) {
  const trip = returnDate ? 'R' : 'O';
  return `https://www.klm.com/home/es/es/prepare-for-travel/bookFlight/flights?trip=${trip}&orig=${origin}&dest=${destination}&deptDate=${departureDate}${returnDate ? `&retDate=${returnDate}` : ''}&adt=1`;
}

/**
 * URL genérica de Google Flights — universal, respeta carriers en la UI.
 * @param {{origin:string,destination:string,departureDate:string,returnDate?:string|null,currency?:string,carrier?:string}} args
 */
function googleFlightsUrl(args) {
  const parts = [`Flights from ${args.origin} to ${args.destination} on ${args.departureDate}`];
  if (args.returnDate) parts.push(`returning ${args.returnDate}`);
  if (args.carrier) parts.push(`with ${args.carrier}`);
  const q = encodeURIComponent(parts.join(' '));
  const curr = args.currency || 'EUR';
  return `https://www.google.com/travel/flights?q=${q}&curr=${curr}&hl=es`;
}

/**
 * Skyscanner — útil para comparar metasearch.
 * @param {{origin:string,destination:string,departureDate:string,returnDate?:string|null}} args
 */
function skyscannerUrl({ origin, destination, departureDate, returnDate }) {
  const d = departureDate.replaceAll('-', '').slice(2); // YYMMDD
  const r = returnDate ? returnDate.replaceAll('-', '').slice(2) : '';
  const base = `https://www.skyscanner.es/transport/vuelos/${origin.toLowerCase()}/${destination.toLowerCase()}/${d}`;
  return returnDate ? `${base}/${r}/` : `${base}/`;
}

/**
 * Devuelve un set de links "best-effort" para una oferta concreta.
 *
 * @param {Flight} flight
 * @returns {{primary:{label:string,url:string}, alternatives:Array<{label:string,url:string}>}}
 */
function buildLinksForFlight(flight) {
  const common = {
    origin: flight.origin,
    destination: flight.destination,
    departureDate: flight.departureDate,
    returnDate: flight.returnDate,
    passengers: 1,
  };

  const firstSeg = flight.segments?.[0];
  const flightNumber = firstSeg?.flightNumber;
  const mainCarrier = flight.carrierCodes?.[0] || firstSeg?.carrierCode;

  /** @type {{label:string,url:string}[]} */
  const alternatives = [];
  let primary = null;

  if (mainCarrier && CARRIER_BUILDERS[mainCarrier]) {
    const url = CARRIER_BUILDERS[mainCarrier]({ ...common, flightNumber });
    if (url) primary = { label: `Reservar en ${mainCarrier}`, url };
  }

  const gf = googleFlightsUrl({ ...common, currency: flight.currency, carrier: mainCarrier });
  const sky = skyscannerUrl(common);
  if (!primary) primary = { label: 'Ver en Google Flights', url: gf };
  else alternatives.push({ label: 'Google Flights', url: gf });
  alternatives.push({ label: 'Skyscanner', url: sky });

  return { primary, alternatives };
}

module.exports = {
  buildLinksForFlight,
  googleFlightsUrl,
  skyscannerUrl,
  CARRIER_BUILDERS,
};
