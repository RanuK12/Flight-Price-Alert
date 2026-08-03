/**
 * Tests del radar Travelpayouts.
 *
 * Lo importante: que sin token quede completamente inerte y que un fallo de
 * red devuelva vacío en vez de propagar. Es un proveedor auxiliar; si tumba
 * una pasada de alertas hace más daño del que evita.
 */

'use strict';

jest.mock('axios');
jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
}));

const axios = require('axios');
const tp = require('../src/providers/travelpayouts');

const TOKEN_ORIGINAL = process.env.TRAVELPAYOUTS_TOKEN;

afterEach(() => {
  if (TOKEN_ORIGINAL === undefined) delete process.env.TRAVELPAYOUTS_TOKEN;
  else process.env.TRAVELPAYOUTS_TOKEN = TOKEN_ORIGINAL;
  jest.clearAllMocks();
});

describe('sin token configurado', () => {
  beforeEach(() => { delete process.env.TRAVELPAYOUTS_TOKEN; });

  test('queda apagado', () => {
    expect(tp.isEnabled()).toBe(false);
  });

  test('no hace ni una request', async () => {
    await tp.monthMatrix('LIS', 'EZE', '2026-09-01');
    await tp.radarMinPrice('LIS', 'EZE', ['2026-09-15']);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('radarMinPrice devuelve nulo sin romper', async () => {
    await expect(tp.radarMinPrice('LIS', 'EZE', ['2026-09-15']))
      .resolves.toEqual({ minPrice: null, samples: 0, cheapestDate: null });
  });
});

describe('con token', () => {
  beforeEach(() => { process.env.TRAVELPAYOUTS_TOKEN = 'token-de-prueba'; });

  test('normaliza la respuesta de la API', async () => {
    axios.get.mockResolvedValue({
      data: {
        success: true,
        data: [
          { origin: 'LIS', destination: 'EZE', depart_date: '2026-09-15', return_date: '', value: 940.5, number_of_changes: 1, actual: true },
          { origin: 'LIS', destination: 'EZE', depart_date: '2026-09-16', return_date: '2026-11-06', value: 880, number_of_changes: 0, actual: true },
        ],
      },
    });

    const rows = await tp.monthMatrix('LIS', 'EZE', '2026-09-01');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      departureDate: '2026-09-16', returnDate: '2026-11-06',
      price: 880, currency: 'EUR', stops: 0, actual: true,
    });
    expect(rows[1].price).toBe(941); // redondeado
    expect(rows[1].returnDate).toBeNull(); // "" → null
  });

  test('pide precios en EUR (los umbrales estan en EUR)', async () => {
    axios.get.mockResolvedValue({ data: { success: true, data: [] } });
    await tp.monthMatrix('LIS', 'EZE', '2026-09-01');

    expect(axios.get.mock.calls[0][1].params).toMatchObject({ currency: 'eur' });
  });

  test('un fallo de red devuelve vacio, no propaga', async () => {
    axios.get.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(tp.monthMatrix('LIS', 'EZE', '2026-09-01')).resolves.toEqual([]);
    await expect(tp.radarMinPrice('LIS', 'EZE', ['2026-09-15']))
      .resolves.toMatchObject({ minPrice: null });
  });

  test('descarta precios marcados como no vigentes', async () => {
    axios.get.mockResolvedValue({
      data: {
        success: true,
        data: [
          { depart_date: '2026-09-15', value: 400, actual: false }, // fosil
          { depart_date: '2026-09-15', value: 950, actual: true },
        ],
      },
    });

    const res = await tp.radarMinPrice('LIS', 'EZE', ['2026-09-15']);
    expect(res.minPrice).toBe(950);
  });

  test('ignora fechas fuera de la ventana pedida', async () => {
    axios.get.mockResolvedValue({
      data: {
        success: true,
        data: [
          { depart_date: '2026-09-01', value: 300, actual: true }, // fuera
          { depart_date: '2026-09-15', value: 900, actual: true },
        ],
      },
    });

    const res = await tp.radarMinPrice('LIS', 'EZE', ['2026-09-15', '2026-09-16']);
    expect(res.minPrice).toBe(900);
    expect(res.cheapestDate).toBe('2026-09-15');
    expect(res.samples).toBe(1);
  });

  test('agrupa por mes: no pide el mismo mes dos veces', async () => {
    axios.get.mockResolvedValue({ data: { success: true, data: [] } });
    await tp.radarMinPrice('LIS', 'EZE', ['2026-09-15', '2026-09-20', '2026-11-03']);

    expect(axios.get).toHaveBeenCalledTimes(2); // septiembre y noviembre
  });
});
