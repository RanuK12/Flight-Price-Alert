/**
 * Tests del barrido por grilla.
 *
 * Lo que importa verificar: que el plan CUBRA toda la ventana pedida (si deja
 * un hueco, esa combinación no se mira nunca) y que use la menor cantidad de
 * cargas de página posible (cada carga son ~15s contra Google).
 */

'use strict';

jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
}));

const { planCenters, planGridFetches, scanRoute, GRID_RADIUS } = require('../src/services/gridScan');

/** Las fechas reales de Emilio: 14-20 sep ida, 1-7 nov vuelta. Son 7 y 7. */
const IDA = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17',
  '2026-09-18', '2026-09-19', '2026-09-20'];
const VUELTA = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04',
  '2026-11-05', '2026-11-06', '2026-11-07'];

/** Ventana de 8 dias, para probar el caso que NO entra en una sola grilla. */
const OCHO_DIAS = [...IDA, '2026-09-21'];

/** Fechas que cubre una grilla centrada en `center`. */
function covered(center) {
  const out = [];
  const [y, m, d] = center.split('-').map(Number);
  for (let i = -GRID_RADIUS; i <= GRID_RADIUS; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    out.push(dt.toISOString().split('T')[0]);
  }
  return out;
}

describe('planCenters — cobertura de la ventana', () => {
  test('la ventana de Emilio (7 dias) entra en UNA sola grilla', () => {
    // La grilla de Google es de 7x7: 7 dias es exactamente lo que cubre.
    expect(planCenters(IDA)).toHaveLength(1);
    expect(planCenters(VUELTA)).toHaveLength(1);

    const all = new Set(planCenters(IDA).flatMap(covered));
    for (const fecha of IDA) expect(all.has(fecha)).toBe(true);
  });

  test('8 dias ya necesitan 2 grillas, sin dejar huecos', () => {
    const centers = planCenters(OCHO_DIAS);
    expect(centers).toHaveLength(2);

    const all = new Set(centers.flatMap(covered));
    for (const fecha of OCHO_DIAS) expect(all.has(fecha)).toBe(true);
  });

  test('un solo dia es una grilla', () => {
    expect(planCenters(['2026-09-15'])).toHaveLength(1);
  });

  test('no deja huecos con fechas salteadas', () => {
    const salteadas = ['2026-09-15', '2026-09-22', '2026-10-05'];
    const centers = planCenters(salteadas);
    const all = new Set(centers.flatMap(covered));
    for (const fecha of salteadas) expect(all.has(fecha)).toBe(true);
  });

  test('tolera fechas desordenadas y repetidas', () => {
    const desorden = ['2026-09-18', '2026-09-15', '2026-09-18', '2026-09-21'];
    const all = new Set(planCenters(desorden).flatMap(covered));
    for (const fecha of desorden) expect(all.has(fecha)).toBe(true);
  });
});

describe('planGridFetches — la ventana completa de Emilio', () => {
  test('49 combinaciones de ida y vuelta en UNA carga por par de aeropuertos', () => {
    const plan = planGridFetches(IDA, VUELTA);
    expect(plan).toHaveLength(1);

    // Toda combinación pedida cae dentro de alguna grilla del plan.
    for (const ida of IDA) {
      for (const vuelta of VUELTA) {
        const alcanzada = plan.some(p =>
          covered(p.departureDate).includes(ida) && covered(p.returnDate).includes(vuelta));
        expect(alcanzada).toBe(true);
      }
    }
  });
});

describe('scanRoute — mezcla de grillas', () => {
  const scraper = { isAvailable: () => true, searchDateGrid: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  test('descarta las celdas fuera de la ventana pedida', async () => {
    // La grilla es de 7x7 y se centra sola: siempre trae fechas de más.
    scraper.searchDateGrid.mockResolvedValue({
      success: true,
      cells: [
        { departureDate: '2026-09-14', returnDate: '2026-11-01', price: 700, currency: 'EUR' },
        { departureDate: '2026-09-13', returnDate: '2026-11-01', price: 500, currency: 'EUR' }, // ida anterior
        { departureDate: '2026-09-14', returnDate: '2026-10-31', price: 400, currency: 'EUR' }, // vuelta anterior
        { departureDate: '2026-09-21', returnDate: '2026-11-01', price: 450, currency: 'EUR' }, // ida posterior
      ],
    });

    const { cells } = await scanRoute('FCO', 'EZE', IDA, VUELTA, { scraper, delayMs: 0 });

    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ departureDate: '2026-09-14', price: 700 });
  });

  test('ante grillas solapadas se queda con el precio mas barato', async () => {
    // Con 8 dias hacen falta 2 grillas, y se solapan.
    scraper.searchDateGrid
      .mockResolvedValueOnce({ success: true, cells: [{ departureDate: '2026-09-18', returnDate: '2026-11-06', price: 900, currency: 'EUR' }] })
      .mockResolvedValue({ success: true, cells: [{ departureDate: '2026-09-18', returnDate: '2026-11-06', price: 850, currency: 'EUR' }] });

    const { cells } = await scanRoute('FCO', 'EZE', OCHO_DIAS, VUELTA, { scraper, delayMs: 0 });

    expect(cells).toHaveLength(1);
    expect(cells[0].price).toBe(850);
  });

  test('una grilla que falla no tumba el barrido', async () => {
    // Dos grillas: la primera falla las dos veces (fallo real), la segunda anda.
    scraper.searchDateGrid
      .mockResolvedValueOnce({ success: false, cells: [], error: 'grid button not found' })
      .mockResolvedValueOnce({ success: false, cells: [], error: 'grid button not found' })
      .mockResolvedValue({ success: true, cells: [{ departureDate: '2026-09-20', returnDate: '2026-11-06', price: 780, currency: 'EUR' }] });

    const { cells, failed } = await scanRoute('FCO', 'EZE', OCHO_DIAS, VUELTA, { scraper, delayMs: 0 });

    expect(failed).toBe(1);
    expect(cells).toHaveLength(1);
    expect(cells[0].price).toBe(780);
  });

  test('sin Playwright devuelve vacio en vez de romper', async () => {
    const sinPw = { isAvailable: () => false, searchDateGrid: jest.fn() };
    const res = await scanRoute('FCO', 'EZE', IDA, VUELTA, { scraper: sinPw, delayMs: 0 });

    expect(res.cells).toEqual([]);
    expect(sinPw.searchDateGrid).not.toHaveBeenCalled();
  });
});

describe('scanRoute — reintento ante grilla vacia', () => {
  const scraper = { isAvailable: () => true, searchDateGrid: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  test('reintenta una vez y se queda con el resultado bueno', async () => {
    scraper.searchDateGrid
      .mockResolvedValueOnce({ success: false, cells: [], error: 'grid button not found' })
      .mockResolvedValueOnce({
        success: true,
        cells: [{ departureDate: '2026-09-18', returnDate: '2026-11-06', price: 868, currency: 'EUR' }],
      });

    const { cells, failed } = await scanRoute('MXP', 'EZE', IDA, VUELTA, { scraper, delayMs: 0 });

    expect(scraper.searchDateGrid).toHaveBeenCalledTimes(2);
    expect(failed).toBe(0);
    expect(cells[0].price).toBe(868);
  });

  test('si falla dos veces lo cuenta como fallo real', async () => {
    scraper.searchDateGrid.mockResolvedValue({ success: false, cells: [], error: 'grid button not found' });

    const { cells, failed } = await scanRoute('MXP', 'EZE', IDA, VUELTA, { scraper, delayMs: 0 });

    expect(scraper.searchDateGrid).toHaveBeenCalledTimes(2);
    expect(failed).toBe(1);
    expect(cells).toEqual([]);
  });

  test('si la primera anda no reintenta', async () => {
    scraper.searchDateGrid.mockResolvedValue({
      success: true,
      cells: [{ departureDate: '2026-09-18', returnDate: '2026-11-06', price: 900, currency: 'EUR' }],
    });

    await scanRoute('MXP', 'EZE', IDA, VUELTA, { scraper, delayMs: 0 });
    expect(scraper.searchDateGrid).toHaveBeenCalledTimes(1);
  });
});
