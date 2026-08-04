/**
 * Tests de los botones de reserva.
 *
 * El bug que motivó esto: el botón decía "Reservar en Amadeus" y llevaba a
 * Google Flights, en el 100% de los resultados. Un botón que miente sobre a
 * dónde lleva es peor que no tener botón, así que lo que se ata acá es que la
 * etiqueta describa el destino real.
 */

'use strict';

const { buildLinksForFlight } = require('../src/bot/deepLinks');

/** Vuelo del scraper: Google llena bookingUrl con su propia búsqueda. */
function delScraper(extra = {}) {
  return {
    source: 'google_flights',
    origin: 'MXP', destination: 'EZE',
    departureDate: '2026-09-14', returnDate: '2026-11-07',
    price: 868, currency: 'EUR', tripType: 'roundtrip',
    airline: 'LATAM', carrierCodes: ['LA'], stops: 1,
    bookingUrl: 'https://www.google.com/travel/flights?q=Flights+from+MXP+to+EZE&curr=EUR&hl=es',
    ...extra,
  };
}

/** Todas las etiquetas, en orden (primary primero). */
function etiquetas(flight) {
  const { primary, alternatives } = buildLinksForFlight(flight);
  return [primary, ...alternatives].map(l => l.label);
}

/** Todas las URLs. */
function urls(flight) {
  const { primary, alternatives } = buildLinksForFlight(flight);
  return [primary, ...alternatives].map(l => l.url);
}

/** El link cuya etiqueta contiene `txt`. */
function link(flight, txt) {
  const { primary, alternatives } = buildLinksForFlight(flight);
  return [primary, ...alternatives].find(l => l.label.includes(txt));
}

describe('la etiqueta dice a dónde lleva', () => {
  test('un vuelo del scraper NO dice "Amadeus" en ningún botón', () => {
    expect(etiquetas(delScraper()).join(' ')).not.toMatch(/amadeus/i);
  });

  test('el botón de reserva apunta a Google Flights', () => {
    expect(link(delScraper(), 'Ver y reservar').url).toContain('google.com/travel/flights');
  });

  test('el botón de Skyscanner apunta a Skyscanner', () => {
    expect(link(delScraper(), 'Skyscanner').url).toContain('skyscanner');
  });

});

describe('no se ofrecen links de aerolínea', () => {
  // Se probaron 5 en un navegador real el 2026-08-04 y las 5 daban error o
  // caían en la home. Si alguien vuelve a agregarlos, que sea a propósito.
  test('ningún botón manda al sitio de una aerolínea', () => {
    for (const dominio of ['latamairlines', 'iberia.com', 'aerolineas.com.ar',
      'lufthansa', 'aireuropa', 'britishairways', 'klm.com']) {
      expect(urls(delScraper()).join(' ')).not.toContain(dominio);
    }
  });

  test('el primary es siempre algo que funciona', () => {
    const { primary } = buildLinksForFlight(delScraper());
    expect(primary.label).toBe('Ver y reservar');
    expect(primary.url).toContain('google.com/travel/flights');
  });

  test('usa la frase que abre resultados, no la portada de Google', () => {
    // "return X" cae en la búsqueda hecha; "returning X" y el filtro "with LA"
    // caían en la portada, o sea un botón "reservar" sin un solo vuelo.
    // Verificado en un navegador real el 2026-08-04: el título pasa de
    // "Encuentra vuelos baratos a todo el mundo" a "De Milán a Buenos Aires".
    const url = decodeURIComponent(link(delScraper(), 'Ver y reservar').url);
    expect(url).toContain('Flights from MXP to EZE on 2026-09-14 return 2026-11-07');
    expect(url).not.toContain('returning');
    expect(url).not.toContain('with ');
  });

  test('solo ida lo dice, para que no invente una vuelta', () => {
    const soloIda = delScraper({ returnDate: null, tripType: 'oneway' });
    const url = decodeURIComponent(link(soloIda, 'Ver y reservar').url);
    expect(url).toContain('on 2026-09-14 one way');
  });
});

describe('sin botones repetidos', () => {
  test('el bookingUrl del scraper no se ofrece dos veces', () => {
    // Es la misma búsqueda de Google que ya está en la lista.
    const aGoogle = urls(delScraper()).filter(u => u.includes('google.com'));
    expect(aGoogle).toHaveLength(1);
  });

  test('un bookingUrl que sí lleva a otro lado sí se ofrece', () => {
    const conAmadeus = delScraper({
      source: 'amadeus',
      bookingUrl: 'https://www.amadeus.com/flight-search?origin=MXP&destination=EZE',
    });
    expect(etiquetas(conAmadeus)).toContain('Ver la oferta en Amadeus');
  });

  test('ninguna URL se repite', () => {
    const { primary, alternatives } = buildLinksForFlight(delScraper());
    const urls = [primary, ...alternatives].map(l => l.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('no se rompe con datos incompletos', () => {
  test('sin fechas devuelve links igual', () => {
    const { primary, alternatives } = buildLinksForFlight({
      origin: 'MXP', destination: 'EZE', departureDate: null, returnDate: null,
      price: 800, currency: 'EUR', tripType: 'oneway', airline: '?', stops: 0,
    });
    expect(primary.url).toMatch(/^https:\/\//);
    for (const a of alternatives) expect(a.url).toMatch(/^https:\/\//);
  });

  test('siempre hay al menos un link', () => {
    const { primary } = buildLinksForFlight({ origin: 'MXP', destination: 'EZE' });
    expect(primary).toBeTruthy();
    expect(primary.url).toMatch(/^https:\/\//);
  });
});
