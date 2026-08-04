/**
 * Tests de la configuración pedida por Emilio el 2026-08-03.
 *
 * Lo que se verifica es el PEDIDO literal, para que un cambio futuro que lo
 * rompa se note:
 *   · ida ≤ €480, ida y vuelta ≤ €900
 *   · Italia (FCO/VCE/MXP) y España (MAD/BCN) presentes
 *   · menos rutas que antes, sin perder cobertura de fechas
 */

'use strict';

jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
}));
jest.mock('../src/database/models/User', () => ({ find: jest.fn(), updateOne: jest.fn() }));
jest.mock('../src/database/models/Route', () => ({ bulkWrite: jest.fn(), deleteMany: jest.fn() }));

const {
  buildOps, datesBetween, EU_AIRPORTS, AR_AIRPORTS, OW_THRESHOLD, RT_THRESHOLD,
} = require('../src/bootstrap/migrateRoutesV11');

const USER = { _id: 'u1', telegramUserId: 123, telegramChatId: 123 };
const ops = buildOps(USER);
const set = (op) => op.updateOne.update.$set;
const roundtrips = ops.filter(o => set(o).tripType === 'roundtrip');
const oneways = ops.filter(o => set(o).tripType === 'oneway');

describe('lo que pidió Emilio', () => {
  test('ida ≤ €480', () => {
    expect(OW_THRESHOLD).toBe(480);
    expect(oneways.every(o => set(o).priceThreshold === 480)).toBe(true);
  });

  test('ida y vuelta ≤ €900 el total', () => {
    expect(RT_THRESHOLD).toBe(900);
    expect(roundtrips.every(o => set(o).priceThreshold === 900)).toBe(true);
  });

  test('€900 deja pasar el vuelo real que €800 dejaba afuera', () => {
    // MXP↔EZE medido el 2026-08-03 dentro de la ventana: €868. Es el motivo
    // literal del cambio, así que si alguien vuelve a bajar el umbral se nota.
    expect(868).toBeLessThanOrEqual(RT_THRESHOLD);
    expect(868).toBeGreaterThan(800);
  });

  test('estan Roma, Venecia y Milan', () => {
    for (const iata of ['FCO', 'VCE', 'MXP']) expect(EU_AIRPORTS).toContain(iata);
  });

  test('estan Madrid y Barcelona', () => {
    for (const iata of ['MAD', 'BCN']) expect(EU_AIRPORTS).toContain(iata);
  });

  test('solo ida va de Europa a Argentina, no al reves', () => {
    for (const op of oneways) {
      expect(EU_AIRPORTS).toContain(op.updateOne.filter.origin);
      expect(AR_AIRPORTS).toContain(op.updateOne.filter.destination);
    }
  });
});

describe('menos rutas, sin perder cobertura', () => {
  test('96 rutas en total (antes 640)', () => {
    expect(ops).toHaveLength(96);
    expect(ops.length).toBeLessThan(640);
  });

  test('ida y vuelta: una ruta VENTANA por par de aeropuertos, no una por combinacion', () => {
    // 6 EU x 2 AR = 12. Con una ruta por combinación de fechas serían 588.
    expect(roundtrips).toHaveLength(EU_AIRPORTS.length * AR_AIRPORTS.length);
    expect(roundtrips).toHaveLength(12);
  });

  test('la ventana cubre las 7 fechas de ida y las 7 de vuelta pedidas', () => {
    const s = set(roundtrips[0]);
    expect(datesBetween(
      s.outboundDate.toISOString().split('T')[0],
      s.outboundDateEnd.toISOString().split('T')[0],
    )).toHaveLength(7);
    expect(datesBetween(
      s.returnDate.toISOString().split('T')[0],
      s.returnDateEnd.toISOString().split('T')[0],
    )).toHaveLength(7);

    // Las fechas exactas que pidió Emilio.
    expect(s.outboundDate.toISOString().split('T')[0]).toBe('2026-09-14');
    expect(s.outboundDateEnd.toISOString().split('T')[0]).toBe('2026-09-20');
    expect(s.returnDate.toISOString().split('T')[0]).toBe('2026-11-01');
    expect(s.returnDateEnd.toISOString().split('T')[0]).toBe('2026-11-07');
  });

  test('solo ida: una por fecha, porque Google no da grilla sin fecha de vuelta', () => {
    expect(oneways).toHaveLength(6 * 2 * 7);
    expect(oneways.every(o => set(o).outboundDateEnd === null)).toBe(true);
  });

  test('cada operacion apunta a una combinacion distinta', () => {
    const claves = ops.map(o => JSON.stringify(o.updateOne.filter));
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe('criterio propio', () => {
  test('entra Lisboa, que midio EUR 929 y era el mas barato', () => {
    expect(EU_AIRPORTS).toContain('LIS');
  });

  test('MIL no se usa: Google lo manda a la pagina generica de la ciudad', () => {
    expect(EU_AIRPORTS).not.toContain('MIL');
  });

  test('todo en EUR, que es la moneda de los umbrales', () => {
    expect(ops.every(o => set(o).currency === 'EUR')).toBe(true);
  });
});

describe('datesBetween', () => {
  test('incluye los dos extremos', () => {
    expect(datesBetween('2026-09-15', '2026-09-18'))
      .toEqual(['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
  });

  test('un solo dia devuelve ese dia', () => {
    expect(datesBetween('2026-09-15', '2026-09-15')).toEqual(['2026-09-15']);
  });

  test('cruza el cambio de mes', () => {
    expect(datesBetween('2026-10-30', '2026-11-02'))
      .toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });
});
