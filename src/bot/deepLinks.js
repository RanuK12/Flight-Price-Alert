/**
 * Links de compra para una oferta.
 *
 * Hubo una tabla de URLs armadas a mano por aerolínea (Iberia, LATAM,
 * Aerolíneas, Lufthansa, Air Europa, BA, KLM/AF, JetSmart, Flybondi). Se
 * probaron las cinco más usadas en estas rutas el 2026-08-04, en un navegador
 * real, y NINGUNA seguía viva:
 *
 *   Aerolíneas Argentinas → "Ups, página no encontrada"
 *   LATAM                 → "Application error: a client-side exception"
 *   Iberia                → redirige a /notfound/
 *   Lufthansa             → "No ha sido posible encontrar la página"
 *   Air Europa            → cae en la home, sin la búsqueda cargada
 *
 * El problema no es que estuvieran mal escritas: las aerolíneas cambian sus
 * URLs y nadie se entera, porque los sitios bloquean a los bots y ningún test
 * automático puede verificarlas. Un botón "Reservar en LATAM" que abre una
 * pantalla de error es peor que no tener el botón.
 *
 * Quedan los dos que sí funcionan y no dependen de adivinar:
 *
 *   1) Google Flights — de ahí sale el precio, y desde ahí se llega a la
 *      aerolínea con la tarifa ya seleccionada.
 *   2) Skyscanner — para comparar.
 *
 * @module bot/deepLinks
 */

'use strict';

/**
 * @typedef {import('../providers/base').Flight} Flight
 */

/**
 * URL de búsqueda de Google Flights.
 *
 * La frase es EXACTAMENTE la que usa el scraper (`buildSearchUrl` en
 * server/scrapers/playwrightScraper.js), y no por casualidad: es la única
 * probada. Decía "returning X" y agregaba "with LA" para filtrar por
 * aerolínea; con esas variantes Google abre su portada en vez de los
 * resultados, o sea que el botón "reservar" no mostraba ningún vuelo. Con
 * "return X" abre la búsqueda hecha, que es de donde salió el precio.
 *
 * Si algún día se toca esto, hay que abrirlo en un navegador y confirmar que
 * caiga en resultados: un test no lo puede ver.
 *
 * @param {{origin:string,destination:string,departureDate:string,returnDate?:string|null,currency?:string,carrier?:string}} args
 */
function googleFlightsUrl(args) {
  if (!args || !args.origin || !args.destination) {
    return 'https://www.google.com/travel/flights?hl=es';
  }
  let q = `Flights from ${args.origin} to ${args.destination}`;
  if (args.departureDate) q += ` on ${args.departureDate}`;
  if (args.departureDate) q += args.returnDate ? ` return ${args.returnDate}` : ' one way';
  const curr = args.currency || 'EUR';
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=${curr}&hl=es`;
}

/**
 * Skyscanner — útil para comparar metasearch.
 * @param {{origin:string,destination:string,departureDate:string,returnDate?:string|null}} args
 */
function skyscannerUrl({ origin, destination, departureDate, returnDate }) {
  // Guard: notificaciones históricas sin departureDate completo no deben crashear.
  // Si falta origin/destination/date, devolvemos un fallback genérico.
  if (!origin || !destination || !departureDate) {
    return 'https://www.skyscanner.es/';
  }
  const d = String(departureDate).replaceAll('-', '').slice(2); // YYMMDD
  const r = returnDate ? String(returnDate).replaceAll('-', '').slice(2) : '';
  const base = `https://www.skyscanner.es/transport/vuelos/${String(origin).toLowerCase()}/${String(destination).toLowerCase()}/${d}`;
  return returnDate ? `${base}/${r}/` : `${base}/`;
}

/** Host de una URL, o '' si no parsea. Para no ofrecer dos veces el mismo sitio. */
function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Devuelve los links de compra de una oferta.
 *
 * Cada botón dice a dónde lleva DE VERDAD. Antes la etiqueta se elegía por
 * "¿tiene bookingUrl?", y como el scraper llena ese campo con la búsqueda de
 * Google, el botón decía "Reservar en Amadeus" sobre un link de Google Flights
 * en el 100% de los resultados (Amadeus está caído, así que todos vienen del
 * scraper).
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

  const mainCarrier = flight.carrierCodes?.[0] || flight.segments?.[0]?.carrierCode;

  /** @type {{label:string,url:string}[]} */
  const links = [];

  // Google Flights, filtrado por la aerolínea de la oferta: es de donde salió
  // el precio y desde ahí se llega a comprar.
  const gf = googleFlightsUrl({ ...common, currency: flight.currency, carrier: mainCarrier });
  links.push({ label: 'Ver y reservar', url: gf });

  // El bookingUrl del provider, sólo si lleva a otro lado. El del scraper es la
  // misma búsqueda de Google que ya está arriba: repetirla es un botón que
  // promete algo distinto y no lo es.
  if (flight.bookingUrl && hostOf(flight.bookingUrl) !== hostOf(gf)) {
    links.push({ label: 'Ver la oferta en Amadeus', url: flight.bookingUrl });
  }

  links.push({ label: 'Comparar en Skyscanner', url: skyscannerUrl(common) });

  return { primary: links[0], alternatives: links.slice(1) };
}

module.exports = {
  buildLinksForFlight,
  googleFlightsUrl,
  skyscannerUrl,
};
