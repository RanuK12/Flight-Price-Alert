/**
 * Regresión: la pantalla de error de Google no puede contarse como "ruta sin
 * vuelos".
 *
 * Google devuelve HTTP 200 con "No se han devuelto resultados / Vaya, se ha
 * producido un error" en vez de la lista. Eso llegaba al motor como cero
 * vuelos, igual que una ruta que de verdad no tiene ninguno, así que ningún
 * freno se enteraba: la pasada del 08-23 recorrió las 40 rutas para cerrar con
 * 33 sin vuelos, 0 errores, 0 freno y 0 ofertas, golpeando a Google todo el
 * rato mientras no rendía nada.
 *
 * El umbral se baja por env para no pagar el pacing real (3,5s por ruta).
 */

'use strict';

process.env.RENDER_ERRORS_TO_STOP = '2';

jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
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

const routesRepo = require('../src/database/repositories/routesRepo');
const hybrid = require('../src/services/hybridSearch');
const alertEngine = require('../src/services/alertEngine');

function makeRoute(i) {
  return {
    _id: `route-${i}`,
    telegramUserId: 111,
    telegramChatId: 111,
    origin: 'FCO',
    destination: 'COR',
    tripType: 'roundtrip',
    outboundDate: new Date('2026-09-17T00:00:00.000Z'),
    returnDate: new Date('2026-11-07T00:00:00.000Z'),
    priceThreshold: 800,
    currency: 'EUR',
    paused: false,
    lastCheckedAt: null,
  };
}

describe('pantalla de error de Google', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    routesRepo.markChecked.mockResolvedValue(undefined);
  });

  test('se cuenta aparte y corta la pasada en vez de recorrer todas las rutas', async () => {
    routesRepo.listAllActive.mockResolvedValue([0, 1, 2, 3, 4].map(makeRoute));
    hybrid.search.mockResolvedValue({ flights: [], warnings: ['google-render-error'] });

    const res = await alertEngine.runOnce();

    expect(res.renderErrors).toBe(2);
    // Frenó: las rutas que faltaban quedaron sin consultar.
    expect(res.skippedByCircuitBreaker).toBeGreaterThan(0);
    expect(hybrid.search).toHaveBeenCalledTimes(2);
  }, 30000);

  test('una ruta que de verdad no tiene vuelos no cuenta como error de Google', async () => {
    routesRepo.listAllActive.mockResolvedValue([makeRoute(0)]);
    hybrid.search.mockResolvedValue({ flights: [], warnings: [] });

    const res = await alertEngine.runOnce();

    expect(res.renderErrors).toBe(0);
    expect(res.skippedNoFlights).toBe(1);
    expect(res.skippedByCircuitBreaker).toBe(0);
  }, 30000);
});
