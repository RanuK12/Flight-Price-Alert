/**
 * Regression tests para el parser de Google Flights.
 *
 * Objetivo: si Google cambia la estructura del wrb.fr o si algun futuro
 * commit mete un bug tipo seg[11]→price, ESTOS TESTS FALLAN antes de que
 * el bot empiece a enviar precios falsos.
 *
 * Capa 1: invariantes estructurales (no acepta items envenenados).
 * Capa 2: extractPlausiblePrice (ranges).
 *
 * Las fixtures viven en tests/fixtures/google-flights/.
 * Ver tests/fixtures/google-flights/README.md.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  parseFlightsResponse,
  parseFlightItem,
  extractPlausiblePrice,
} = require('../server/scrapers/googleFlightsApi');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'google-flights');

describe('Google Flights parser — regression', () => {
  describe('extractPlausiblePrice', () => {
    test('rejects empty / non-array', () => {
      expect(extractPlausiblePrice(null)).toBeNull();
      expect(extractPlausiblePrice(undefined)).toBeNull();
      expect(extractPlausiblePrice([])).toBeNull();
      expect(extractPlausiblePrice('not-an-array')).toBeNull();
    });

    test('rejects sub-component-only (taxes < 30)', () => {
      // simulando un priceArr donde solo hay numeros bajos
      expect(extractPlausiblePrice([5, 10, 25])).toBeNull();
    });

    test('returns LAST plausible candidate (total with taxes)', () => {
      // Convencion Google: priceArr = [..., taxes, total]
      expect(extractPlausiblePrice([120, 811])).toBe(811);
      expect(extractPlausiblePrice([100, 200, 843])).toBe(843);
    });

    test('rejects implausible values (>15000) but returns last in-range', () => {
      // Un timestamp/id de Google a la izquierda no debe contaminar
      expect(extractPlausiblePrice([1778684621638628, 100, 811])).toBe(811);
    });

    test('regression seg[11]→price: a single 155-min duration must NOT be returned alone if other candidates exist', () => {
      // En el bug historico, priceArr=[155] se aceptaba. Hoy si hay 155 y 811,
      // SIEMPRE se queda con el ultimo (811). El caso 155 solo se cubre con
      // la capa de sanityCheck (long-haul floor).
      expect(extractPlausiblePrice([155, 811])).toBe(811);
    });
  });

  describe('parseFlightItem', () => {
    test('returns null on missing item[1] (price array)', () => {
      const flightOk = [['TK', ['Turkish'], [[null, null, null, 'EZE', '', 'MXP', '', '', [], 1500, 0]]]];
      // sin item[1] → priceArr undefined → null
      expect(parseFlightItem(flightOk)).toBeNull();
    });

    test('returns null on empty priceArr (regression)', () => {
      const item = [
        ['TK', ['Turkish'], [[null, null, null, 'EZE', '', 'MXP', '', '', [], 1500, 0]]],
        [[]], // priceArr vacio: NO inventar precio
      ];
      expect(parseFlightItem(item)).toBeNull();
    });

    test('extracts well-formed flight (NEW format)', () => {
      const item = [
        ['TK', ['Turkish Airlines'],
          [[null, null, null, 'EZE', 'Aero', 'MXP', 'Aero', '', [], 1500, 1, null, null, null, null, null, null, null, null, [2026, 6, 11], [2026, 6, 11]]]],
        [[121, 811]],
      ];
      const f = parseFlightItem(item);
      expect(f).not.toBeNull();
      expect(f.price).toBe(811);
      expect(f.airline).toBe('Turkish Airlines');
      expect(f.stops).toBe(1);
      expect(f.departureAirport).toBe('EZE');
      expect(f.arrivalAirport).toBe('MXP');
    });

    test('falls back to airline code map when name missing', () => {
      const item = [
        ['LH', null,
          [[null, null, null, 'EZE', '', 'MXP', '', '', [], 1500, 0]]],
        [[100, 843]],
      ];
      const f = parseFlightItem(item);
      expect(f.airline).toBe('Lufthansa'); // resuelto via AIRLINE_CODES
    });
  });

  describe('parseFlightsResponse — synthetic fixture', () => {
    const FIXTURE = path.join(FIXTURE_DIR, 'synthetic_eze-mxp_ow.txt');
    let raw;
    let flights;

    beforeAll(() => {
      raw = fs.readFileSync(FIXTURE, 'utf-8');
      flights = parseFlightsResponse(raw);
    });

    test('parses without throwing', () => {
      expect(Array.isArray(flights)).toBe(true);
    });

    test('extracts the 4 valid flights and DROPS the 1 poisoned item', () => {
      // Fixture tiene 5 items: 4 buenos + 1 con priceArr=[].
      // El parser DEBE descartar el envenenado.
      expect(flights.length).toBe(4);
    });

    test('all flights have plausible prices (long-haul floor)', () => {
      for (const f of flights) {
        expect(f.price).toBeGreaterThan(300);
        expect(f.price).toBeLessThan(2000);
      }
    });

    test('no flight has airline === ""', () => {
      for (const f of flights) {
        expect(typeof f.airline).toBe('string');
        expect(f.airline.length).toBeGreaterThan(0);
        expect(f.airline).not.toBe('Unknown'); // las 4 reales tienen nombre
      }
    });

    test('IATA airport codes are 3 chars', () => {
      for (const f of flights) {
        expect(f.departureAirport).toBe('EZE');
        expect(f.arrivalAirport).toBe('MXP');
      }
    });

    test('cheapest is Iberia at 737 (regression: NOT 155)', () => {
      const min = flights.reduce((a, b) => (a.price <= b.price ? a : b));
      expect(min.price).toBe(737);
      expect(min.airline).toBe('Iberia');
    });
  });

  describe('parseFlightsResponse — error tolerance', () => {
    test('handles XSSI prefix variations', () => {
      const minimal = ")]}'\n" + JSON.stringify([['wrb.fr', null, JSON.stringify([[], []])]]);
      expect(() => parseFlightsResponse(minimal)).not.toThrow();
      expect(parseFlightsResponse(minimal)).toEqual([]);
    });

    test('handles malformed outer JSON gracefully (returns [])', () => {
      const bad = ")]}'\nNOT JSON AT ALL";
      expect(parseFlightsResponse(bad)).toEqual([]);
    });

    test('handles missing parsed[0] gracefully', () => {
      const empty = ")]}'\n[]";
      expect(parseFlightsResponse(empty)).toEqual([]);
    });
  });
});
