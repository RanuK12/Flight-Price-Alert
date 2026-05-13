/**
 * Tests del middleware sanityCheck.
 *
 * Las capas 1 (hard floor) y 2 (threshold) son sincronicas y puras → testables sin Mongo.
 * La capa 3 (historico p25) requiere Mongo → la mockeamos via getRouteStats.
 */

'use strict';

// Mock del modelo Notification ANTES de require sanityCheck.
jest.mock('../src/database/models/Notification', () => ({
  aggregate: jest.fn().mockResolvedValue([]),
}));

// Mock del logger para no contaminar la salida.
jest.mock('../src/utils/logger', () => ({
  child: () => ({
    info: () => {}, warn: () => {}, debug: () => {}, error: () => {},
  }),
}));

const sanity = require('../src/services/sanityCheck');

describe('sanityCheck — capa 1 (hard floor)', () => {
  test('blocks long-haul OW < $250', async () => {
    const v = await sanity.check({
      origin: 'EZE', destination: 'MAD', price: 155, currency: 'USD', tripType: 'oneway',
    });
    expect(v.ok).toBe(false);
    expect(v.severity).toBe('block');
    expect(v.reason).toMatch(/hard floor/);
  });

  test('blocks long-haul RT < $350', async () => {
    const v = await sanity.check({
      origin: 'EZE', destination: 'MAD', price: 200, currency: 'USD', tripType: 'roundtrip',
    });
    expect(v.severity).toBe('block');
  });

  test('allows AR domestic at $30', async () => {
    const v = await sanity.check({
      origin: 'COR', destination: 'MDQ', price: 30, currency: 'USD', tripType: 'oneway',
    });
    // Pasa hard floor ($25); puede pasar o cuarentenarse en capa 2 segun threshold.
    expect(v.severity).not.toBe('block');
  });

  test('blocks AR domestic at $10', async () => {
    const v = await sanity.check({
      origin: 'COR', destination: 'MDQ', price: 10, currency: 'USD', tripType: 'oneway',
    });
    expect(v.severity).toBe('block');
  });

  test('blocks NaN/zero/negative', async () => {
    expect((await sanity.check({ origin: 'EZE', destination: 'MAD', price: 0 })).severity).toBe('block');
    expect((await sanity.check({ origin: 'EZE', destination: 'MAD', price: -50 })).severity).toBe('block');
    expect((await sanity.check({ origin: 'EZE', destination: 'MAD', price: NaN })).severity).toBe('block');
  });
});

describe('sanityCheck — capa 2 (threshold floor)', () => {
  test('quarantines EZE-MAD at €280 (60% of steal=520 → floor 312)', async () => {
    const v = await sanity.check({
      origin: 'EZE', destination: 'MAD', price: 280, currency: 'EUR', tripType: 'oneway',
    });
    expect(v.severity).toBe('quarantine');
    expect(v.reason).toMatch(/steal floor/);
  });

  test('passes EZE-MAD at €600 (above floor)', async () => {
    const v = await sanity.check({
      origin: 'EZE', destination: 'MAD', price: 600, currency: 'EUR', tripType: 'oneway',
    });
    expect(v.ok).toBe(true);
  });

  test('USD priced is converted to EUR before threshold check', async () => {
    // EZE-MAD steal=520 EUR → floor 312 EUR. $300 USD ≈ €276 → cuarentena.
    const v = await sanity.check({
      origin: 'EZE', destination: 'MAD', price: 300, currency: 'USD', tripType: 'oneway',
    });
    expect(v.severity).toBe('quarantine');
  });
});

describe('sanityCheck — capa 3 (historico p25)', () => {
  beforeEach(() => {
    sanity.clearStatsCache();
  });

  test('quarantines when price < 40% of historical p25', async () => {
    const Notification = require('../src/database/models/Notification');
    Notification.aggregate.mockResolvedValueOnce([{
      count: 20,
      prices: [600, 650, 700, 750, 800, 850, 900, 950, 1000, 1050,
               1100, 1150, 1200, 1250, 1300, 1350, 1400, 1450, 1500, 1550],
      avgPrice: 1075,
    }]);

    // Ruta sin threshold definido (no esta en priceThresholds), capa 2 no bloquea
    // → llega a capa 3. p25 ≈ 750 → floor 300. Precio $290 < floor.
    // Pero EZE-NCE pasa por hard-floor (long-haul $250) → 290 PASA capa 1.
    const v = await sanity.check({
      origin: 'EZE', destination: 'NCE', price: 290, currency: 'USD', tripType: 'oneway',
    });
    expect(v.severity).toBe('quarantine');
    expect(v.reason).toMatch(/historical p25/);
  });

  test('passes when sample is < MIN_SAMPLE', async () => {
    const Notification = require('../src/database/models/Notification');
    Notification.aggregate.mockResolvedValueOnce([{
      count: 3,
      prices: [800, 900, 1000],
      avgPrice: 900,
    }]);
    // Pocas muestras → no aplica capa 3 (insuficiente para estadistica)
    const v = await sanity.check({
      origin: 'EZE', destination: 'NCE', price: 280, currency: 'USD', tripType: 'oneway',
    });
    // Cuidado: 280 podria caer en hard-floor (long-haul $250). Si pasa hard-floor
    // y no hay threshold definido para NCE, deberia ser pass.
    expect(v.ok).toBe(true);
  });

  test('skipHistorical=true bypasses capa 3', async () => {
    const Notification = require('../src/database/models/Notification');
    // Si se llama, fallaria el test (skipHistorical NO debe consultar Mongo)
    Notification.aggregate.mockClear();

    const v = await sanity.check({
      origin: 'EZE', destination: 'NCE', price: 600, currency: 'USD', tripType: 'oneway',
    }, { skipHistorical: true });

    expect(v.ok).toBe(true);
    expect(Notification.aggregate).not.toHaveBeenCalled();
  });
});

describe('sanityCheck — isInternational', () => {
  test('AR-AR is domestic', () => {
    expect(sanity.isInternational('COR', 'MDQ')).toBe(false);
    expect(sanity.isInternational('EZE', 'AEP')).toBe(false);
  });
  test('AR→Europe is international', () => {
    expect(sanity.isInternational('EZE', 'MAD')).toBe(true);
    expect(sanity.isInternational('COR', 'FCO')).toBe(true);
  });
  test('Europe→Europe is international', () => {
    expect(sanity.isInternational('MAD', 'FCO')).toBe(true);
  });
});
