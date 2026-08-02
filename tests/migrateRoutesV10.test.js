/**
 * Tests de la migración V10.
 *
 * Lo crítico: que sea ADITIVA. Las alertas de Emilio son "sagradas" según
 * .agents/AGENTS.md, y V9 ya demostró que una migración que purga se lleva
 * puesto todo en cada arranque.
 */

'use strict';

jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
}));
jest.mock('../src/database/models/User', () => ({ find: jest.fn(), updateOne: jest.fn() }));
jest.mock('../src/database/models/Route', () => ({ bulkWrite: jest.fn(), deleteMany: jest.fn() }));

const Route = require('../src/database/models/Route');
const { buildOps, ALL_EU_AIRPORTS, NEW_EU_AIRPORTS } = require('../src/bootstrap/migrateRoutesV10');

const USER = { _id: 'u1', telegramUserId: 123, telegramChatId: 123 };

describe('migrateRoutesV10 — no destruye nada', () => {
  test('todas las operaciones son upsert, ninguna borra', () => {
    const ops = buildOps(USER);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op).toHaveProperty('updateOne');
      expect(op.updateOne.upsert).toBe(true);
      expect(op).not.toHaveProperty('deleteOne');
      expect(op).not.toHaveProperty('deleteMany');
    }
  });

  test('el modulo nunca llama a deleteMany', () => {
    buildOps(USER);
    expect(Route.deleteMany).not.toHaveBeenCalled();
  });

  test('cada operacion apunta a una sola combinacion (no pisa vecinas)', () => {
    const claves = buildOps(USER).map(op => JSON.stringify(op.updateOne.filter));
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe('migrateRoutesV10 — lo que agrega', () => {
  const ops = buildOps(USER);
  const pares = new Set(ops.map(op => {
    const f = op.updateOne.filter;
    return `${f.tripType}:${f.origin}-${f.destination}`;
  }));

  test('suma Lisboa y Oporto, que no estaban', () => {
    expect(NEW_EU_AIRPORTS).toEqual(['LIS', 'OPO']);
    expect(pares.has('roundtrip:LIS-EZE')).toBe(true);
    expect(pares.has('oneway:LIS-EZE')).toBe(true);
    expect(pares.has('oneway:OPO-COR')).toBe(true);
  });

  test('cubre el largo radio de todos los aeropuertos EU contra EZE', () => {
    for (const eu of ALL_EU_AIRPORTS) {
      expect(pares.has(`roundtrip:${eu}-EZE`)).toBe(true);
    }
  });

  test('agrega el salto domestico EZE-COR en las dos direcciones', () => {
    expect(pares.has('oneway:EZE-COR')).toBe(true);
    expect(pares.has('oneway:COR-EZE')).toBe(true);
  });

  test('el domestico tiene umbral propio, no el de largo radio', () => {
    const dom = ops.find(op => {
      const f = op.updateOne.filter;
      return f.origin === 'EZE' && f.destination === 'COR';
    });
    expect(dom.updateOne.update.$set.priceThreshold).toBe(90);

    const largo = ops.find(op => {
      const f = op.updateOne.filter;
      return f.origin === 'LIS' && f.destination === 'EZE' && f.tripType === 'roundtrip';
    });
    expect(largo.updateOne.update.$set.priceThreshold).toBe(800);
  });

  test('respeta los umbrales de Emilio: 800 ida y vuelta, 400 ida sola', () => {
    const rt = ops.filter(op => op.updateOne.filter.tripType === 'roundtrip');
    expect(rt.every(op => op.updateOne.update.$set.priceThreshold === 800)).toBe(true);

    const ow = ops.filter(op => {
      const f = op.updateOne.filter;
      return f.tripType === 'oneway' && !['EZE', 'COR'].includes(f.origin);
    });
    expect(ow.every(op => op.updateOne.update.$set.priceThreshold === 400)).toBe(true);
  });

  test('MIL no se usa: Google lo manda a la pagina generica de la ciudad', () => {
    expect(ALL_EU_AIRPORTS).not.toContain('MIL');
    expect(ALL_EU_AIRPORTS).toContain('MXP');
  });

  test('todo va en EUR, que es la moneda de los umbrales', () => {
    expect(ops.every(op => op.updateOne.update.$set.currency === 'EUR')).toBe(true);
  });
});
