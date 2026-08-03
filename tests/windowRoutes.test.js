/**
 * Tests de las rutas VENTANA.
 *
 * El riesgo concreto: una ruta ventana 15-22 sep tiene `outboundDate` = 15,
 * que es apenas el arranque del rango. Si el motor la trata como una fecha
 * suelta, la pausa el día 15 y busca siempre el 15 aunque la oferta esté el 18.
 */

'use strict';

jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
}));
jest.mock('../src/database/repositories/routesRepo', () => ({
  listAllActive: jest.fn(),
  markChecked: jest.fn().mockResolvedValue(undefined),
  markWindowBest: jest.fn().mockResolvedValue(undefined),
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
jest.mock('../src/services/gridScan', () => ({ scanRoute: jest.fn() }));
jest.mock('../src/providers/travelpayouts', () => ({ isEnabled: () => false }));
jest.mock('../src/bot/notifier', () => ({
  notifyOffer: jest.fn().mockResolvedValue({ sent: true, id: 1 }),
  notifyBatchHeader: jest.fn().mockResolvedValue(undefined),
}));

const routesRepo = require('../src/database/repositories/routesRepo');
const hybrid = require('../src/services/hybridSearch');
const gridScan = require('../src/services/gridScan');
const alertEngine = require('../src/services/alertEngine');
const gridSweep = require('../src/services/gridSweep');

/** Ruta ventana como las que crea V11. */
function ventana(extra = {}) {
  return {
    _id: 'rt-1',
    telegramUserId: 1, telegramChatId: 1,
    origin: 'LIS', destination: 'EZE',
    tripType: 'roundtrip',
    outboundDate: new Date('2026-09-15T00:00:00.000Z'),
    outboundDateEnd: new Date('2026-09-22T00:00:00.000Z'),
    returnDate: new Date('2026-11-03T00:00:00.000Z'),
    returnDateEnd: new Date('2026-11-10T00:00:00.000Z'),
    priceThreshold: 800, currency: 'EUR', paused: false,
    lastCheckedAt: null, lastPriceEur: null,
    bestOutboundDate: null, bestReturnDate: null,
    ...extra,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('alertEngine con rutas ventana', () => {
  test('confirma la combinacion que encontro la grilla, no el arranque del rango', async () => {
    routesRepo.listAllActive.mockResolvedValue([ventana({
      bestOutboundDate: new Date('2026-11-03T00:00:00.000Z'), // se pisa abajo
      bestReturnDate: new Date('2026-11-07T00:00:00.000Z'),
    })]);
    routesRepo.listAllActive.mockResolvedValue([ventana({
      bestOutboundDate: new Date('2026-09-18T00:00:00.000Z'),
      bestReturnDate: new Date('2026-11-07T00:00:00.000Z'),
    })]);
    hybrid.search.mockResolvedValue({ flights: [], warnings: [] });

    await alertEngine.runOnce();

    const params = hybrid.search.mock.calls[0][0];
    expect(params.departureDate).toEqual(new Date('2026-09-18T00:00:00.000Z'));
    expect(params.returnDate).toEqual(new Date('2026-11-07T00:00:00.000Z'));
  });

  test('sin barrido previo cae al arranque de la ventana, que es una fecha valida', async () => {
    routesRepo.listAllActive.mockResolvedValue([ventana()]);
    hybrid.search.mockResolvedValue({ flights: [], warnings: [] });

    await alertEngine.runOnce();

    const params = hybrid.search.mock.calls[0][0];
    expect(params.departureDate).toEqual(new Date('2026-09-15T00:00:00.000Z'));
  });

  test('una ruta normal sigue usando su fecha propia', async () => {
    routesRepo.listAllActive.mockResolvedValue([{
      ...ventana(),
      tripType: 'oneway',
      outboundDate: new Date('2026-09-20T00:00:00.000Z'),
      outboundDateEnd: null, returnDate: null, returnDateEnd: null,
      bestOutboundDate: new Date('2026-09-18T00:00:00.000Z'), // debe ignorarse
    }]);
    hybrid.search.mockResolvedValue({ flights: [], warnings: [] });

    await alertEngine.runOnce();

    const params = hybrid.search.mock.calls[0][0];
    expect(params.departureDate).toEqual(new Date('2026-09-20T00:00:00.000Z'));
    expect(params.returnDate).toBeUndefined();
  });
});

describe('gridSweep con rutas ventana', () => {
  test('expande la ventana a todas las fechas y guarda la mejor combinacion', async () => {
    routesRepo.listAllActive.mockResolvedValue([ventana()]);
    gridScan.scanRoute.mockResolvedValue({
      cells: [
        { departureDate: '2026-09-18', returnDate: '2026-11-07', price: 780, currency: 'EUR' },
        { departureDate: '2026-09-15', returnDate: '2026-11-03', price: 950, currency: 'EUR' },
      ],
      fetches: 4, failed: 0,
    });

    const res = await gridSweep.runSweep();

    // La ventana se abre en las 8 + 8 fechas que hay que barrer.
    const [, , outDates, retDates] = gridScan.scanRoute.mock.calls[0];
    expect(outDates).toHaveLength(8);
    expect(retDates).toHaveLength(8);

    // Se guarda el mínimo de TODA la ventana con las fechas que lo producen.
    expect(routesRepo.markWindowBest)
      .toHaveBeenCalledWith('rt-1', 780, '2026-09-18', '2026-11-07');
    expect(routesRepo.markChecked).not.toHaveBeenCalled();
    expect(res.belowThreshold).toBe(1); // 780 <= 800
  });

  test('cuenta como fuera de umbral si el minimo de la ventana no llega', async () => {
    routesRepo.listAllActive.mockResolvedValue([ventana()]);
    gridScan.scanRoute.mockResolvedValue({
      cells: [{ departureDate: '2026-09-18', returnDate: '2026-11-07', price: 929, currency: 'EUR' }],
      fetches: 4, failed: 0,
    });

    const res = await gridSweep.runSweep();
    expect(res.belowThreshold).toBe(0);
    expect(routesRepo.markWindowBest).toHaveBeenCalledWith('rt-1', 929, '2026-09-18', '2026-11-07');
  });

  test('una grilla sin celdas no escribe nada', async () => {
    routesRepo.listAllActive.mockResolvedValue([ventana()]);
    gridScan.scanRoute.mockResolvedValue({ cells: [], fetches: 4, failed: 4 });

    await gridSweep.runSweep();
    expect(routesRepo.markWindowBest).not.toHaveBeenCalled();
  });
});

describe('vencimiento de la ventana', () => {
  const { groupRoundtripRoutes } = gridSweep;

  test('una ventana que todavia no termino sigue viva', () => {
    const futuro = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const arranqueViejo = new Date(Date.now() - 5 * 24 * 3600 * 1000);

    const groups = groupRoundtripRoutes([ventana({
      outboundDate: arranqueViejo,   // el arranque ya pasó
      outboundDateEnd: futuro,       // pero el rango sigue abierto
      returnDate: futuro, returnDateEnd: futuro,
    })]);

    expect(groups.size).toBe(1);
  });

  test('una ventana totalmente vencida se descarta', () => {
    const pasado = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const groups = groupRoundtripRoutes([ventana({
      outboundDate: pasado, outboundDateEnd: pasado,
      returnDate: pasado, returnDateEnd: pasado,
    })]);

    expect(groups.size).toBe(0);
  });
});
