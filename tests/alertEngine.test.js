/**
 * Regresión del bug que dejó al bot sin enviar NINGUNA alerta.
 *
 * Dos defectos apilados en alertEngine:
 *
 *   1. `classifyPrice` devuelve {level, threshold}, pero el motor asignaba el
 *      objeto entero a `level`. LEVEL_RANK[objeto] es undefined → rank=99 →
 *      `rank > minRank` siempre true → ninguna oferta pasaba, a cualquier precio.
 *
 *   2. El 4to argumento de `classifyPrice` es el string 'roundtrip'|'oneway'.
 *      Se le pasaba un booleano, así que getThreshold caía siempre en la tabla
 *      de one-way: un roundtrip FCO-COR se comparaba contra deal €400 en vez
 *      de €800.
 *
 * Los tests de nivel de motor usan el pacing real (3,5s por ruta), por eso se
 * mantienen en el mínimo indispensable.
 */

'use strict';

jest.mock('../src/utils/logger', () => ({
  child: () => ({
    info: () => { }, warn: () => { }, debug: () => { }, error: () => { },
  }),
}));

jest.mock('../src/database/repositories/routesRepo', () => ({
  listAllActive: jest.fn(),
  markChecked: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/database/repositories/userPrefsRepo', () => ({
  getOrCreate: jest.fn().mockResolvedValue({ alert_min_level: 'great', currency: 'EUR' }),
}));

jest.mock('../src/database/models/Notification', () => ({
  findOne: () => ({ sort: () => ({ lean: () => Promise.resolve(null) }) }),
}));

jest.mock('../src/database/models/Route', () => ({
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
}));

jest.mock('../src/services/hybridSearch', () => ({ search: jest.fn() }));

jest.mock('../src/bot/notifier', () => ({
  notifyOffer: jest.fn().mockResolvedValue({ sent: true, id: 1 }),
  notifyBatchHeader: jest.fn().mockResolvedValue(undefined),
}));

const { classifyPrice, getThreshold } = require('../src/config/priceThresholds');
const routesRepo = require('../src/database/repositories/routesRepo');
const hybrid = require('../src/services/hybridSearch');
const notifier = require('../src/bot/notifier');
const alertEngine = require('../src/services/alertEngine');

/** Ruta de ejemplo: la config real de Emilio (FCO↔COR, umbral €800 roundtrip). */
function makeRoute(overrides = {}) {
  return {
    _id: 'route-1',
    telegramUserId: 111,
    telegramChatId: 111,
    origin: 'FCO',
    destination: 'COR',
    tripType: 'roundtrip',
    outboundDate: new Date('2026-09-17T00:00:00.000Z'),
    returnDate: new Date('2026-11-07T00:00:00.000Z'),
    priceThreshold: 800,
    currency: 'EUR',
    name: 'FCO↔COR RT ≤€800',
    paused: false,
    lastCheckedAt: null,
    ...overrides,
  };
}

function makeFlight(price) {
  return {
    source: 'google_flights',
    origin: 'FCO',
    destination: 'COR',
    price,
    currency: 'EUR',
    tripType: 'roundtrip',
    departureDate: '2026-09-17',
    returnDate: '2026-11-07',
    airline: 'ITA',
    stops: 1,
  };
}

describe('classifyPrice — tabla correcta segun tripType (defecto 2)', () => {
  test('roundtrip usa la tabla de roundtrip, no la de one-way', () => {
    const rt = getThreshold('FCO', 'COR', 'roundtrip');
    const ow = getThreshold('FCO', 'COR', 'oneway');
    // Umbrales pedidos por Emilio el 2026-08-03: ida €480, ida y vuelta €800.
    expect(rt.deal).toBe(800);
    expect(ow.deal).toBe(480);
    expect(rt.deal).not.toBe(ow.deal); // el punto del test: son tablas distintas

    const res = classifyPrice('FCO', 'COR', 780, 'roundtrip');
    expect(res.threshold.typical).toBe(1420);
    expect(res.level).toBe('great');
  });

  test('pasar un booleano (el bug) cae en la tabla de one-way', () => {
    // Reproduce el argumento que pasaba alertEngine: `tripType === 'roundtrip'`.
    const buggy = classifyPrice('FCO', 'COR', 780, true);
    expect(buggy.threshold.typical).toBe(780); // tabla one-way, no la de 1420
    expect(buggy.level).not.toBe('great');     // la oferta real se perdia
  });

  test('devuelve un objeto, no un string (defecto 1)', () => {
    const res = classifyPrice('FCO', 'COR', 780, 'roundtrip');
    expect(typeof res).toBe('object');
    expect(res).toHaveProperty('level');
    expect(res).toHaveProperty('threshold');
  });
});

describe('alertEngine.runOnce — una oferta bajo el umbral se notifica', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    routesRepo.markChecked.mockResolvedValue(undefined);
    notifier.notifyOffer.mockResolvedValue({ sent: true, id: 1 });
  });

  test('roundtrip a €780 con umbral €800 llega a notifyOffer', async () => {
    routesRepo.listAllActive.mockResolvedValue([makeRoute()]);
    hybrid.search.mockResolvedValue({ flights: [makeFlight(780)], warnings: [] });

    const res = await alertEngine.runOnce();

    expect(res.offersSent).toBe(1);
    expect(notifier.notifyOffer).toHaveBeenCalledTimes(1);

    // El dealLevel tiene que ser el string, no el objeto: el notifier lo usa
    // como clave para elegir el emoji y lo persiste en la notificacion.
    const ctx = notifier.notifyOffer.mock.calls[0][1];
    expect(ctx.dealLevel).toBe('great');
  });

  test('roundtrip a €1400 sigue filtrado (no aflojamos el umbral)', async () => {
    routesRepo.listAllActive.mockResolvedValue([makeRoute()]);
    hybrid.search.mockResolvedValue({ flights: [makeFlight(1400)], warnings: [] });

    const res = await alertEngine.runOnce();

    expect(res.offersSent).toBe(0);
    expect(notifier.notifyOffer).not.toHaveBeenCalled();
  });

  test('marca lastCheckedAt aunque no se envie nada (rotacion avanza)', async () => {
    routesRepo.listAllActive.mockResolvedValue([makeRoute()]);
    hybrid.search.mockResolvedValue({ flights: [], warnings: [] });

    await alertEngine.runOnce();

    expect(routesRepo.markChecked).toHaveBeenCalledWith('route-1', null);
  });

  test('guarda el precio visto en EUR para el informe diario', async () => {
    routesRepo.listAllActive.mockResolvedValue([makeRoute()]);
    hybrid.search.mockResolvedValue({ flights: [makeFlight(1400)], warnings: [] });

    await alertEngine.runOnce();

    expect(routesRepo.markChecked).toHaveBeenCalledWith('route-1', 1400);
  });
});
