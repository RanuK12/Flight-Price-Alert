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

/** Las fechas reales de Emilio. */
const IDA = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18',
  '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'];
const VUELTA = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
  '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'];

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
  test('8 dias consecutivos se cubren con 2 grillas', () => {
    const centers = planCenters(IDA);
    expect(centers).toHaveLength(2);

    const all = new Set(centers.flatMap(covered));
    for (const fecha of IDA) expect(all.has(fecha)).toBe(true);
  });

  test('7 dias o menos entran en una sola grilla', () => {
    expect(planCenters(IDA.slice(0, 7))).toHaveLength(1);
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
  test('512 busquedas de ida y vuelta pasan a 4 cargas por par de aeropuertos', () => {
    const plan = planGridFetches(IDA, VUELTA);
    expect(plan).toHaveLength(4);

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
    scraper.searchDateGrid.mockResolvedValue({
      success: true,
      cells: [
        { departureDate: '2026-09-15', returnDate: '2026-11-03', price: 700, currency: 'EUR' },
        { departureDate: '2026-09-13', returnDate: '2026-11-03', price: 500, currency: 'EUR' }, // fuera
        { departureDate: '2026-09-15', returnDate: '2026-11-01', price: 400, currency: 'EUR' }, // fuera
      ],
    });

    const { cells } = await scanRoute('FCO', 'EZE', IDA, VUELTA, { scraper, delayMs: 0 });

    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ departureDate: '2026-09-15', price: 700 });
  });

  test('ante grillas solapadas se queda con el precio mas barato', async () => {
    scraper.searchDateGrid
      .mockResolvedValueOnce({ success: true, cells: [{ departureDate: '2026-09-18', returnDate: '2026-11-06', price: 900, currency: 'EUR' }] })
      .mockResolvedValue({ success: true, cells: [{ departureDate: '2026-09-18', returnDate: '2026-11-06', price: 850, currency: 'EUR' }] });

    const { cells } = await scanRoute('FCO', 'EZE', IDA, VUELTA, { scraper, delayMs: 0 });

    expect(cells).toHaveLength(1);
    expect(cells[0].price).toBe(850);
  });

  test('una grilla que falla no tumba el barrido', async () => {
    scraper.searchDateGrid
      .mockResolvedValueOnce({ success: false, cells: [], error: 'grid button not found' })
      .mockResolvedValue({ success: true, cells: [{ departureDate: '2026-09-20', returnDate: '2026-11-08', price: 780, currency: 'EUR' }] });

    const { cells, failed } = await scanRoute('FCO', 'EZE', IDA, VUELTA, { scraper, delayMs: 0 });

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
