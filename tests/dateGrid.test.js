/**
 * Tests de la resolución posicional del date grid.
 *
 * `resolveGridCells` convierte coordenadas de pantalla en combinaciones de
 * fechas. Es pura, así que se testea sin navegador. Los datos de entrada son
 * una captura real del DOM de Google Flights (FCO→EZE, grilla centrada en
 * 17 sep / 7 nov), no números inventados.
 */

'use strict';

const { resolveGridCells, yearResolver } = require('../server/scrapers/playwrightScraper');

/** Cabeceras reales: ida en la fila y=300.5, vuelta en la columna x=1037.5. */
const HEADS = [
  { day: 14, month: 9, x: 211.5, y: 300.5 },
  { day: 15, month: 9, x: 329.5, y: 300.5 },
  { day: 16, month: 9, x: 447.5, y: 300.5 },
  { day: 17, month: 9, x: 565.5, y: 300.5 },
  { day: 18, month: 9, x: 683.5, y: 300.5 },
  { day: 19, month: 9, x: 801.5, y: 300.5 },
  { day: 20, month: 9, x: 919.5, y: 300.5 },
  { day: 4, month: 11, x: 1037.5, y: 347.5 },
  { day: 5, month: 11, x: 1037.5, y: 394.5 },
  { day: 6, month: 11, x: 1037.5, y: 441.5 },
  { day: 7, month: 11, x: 1037.5, y: 488.5 },
  { day: 8, month: 11, x: 1037.5, y: 535.5 },
  { day: 9, month: 11, x: 1037.5, y: 582.5 },
  { day: 10, month: 11, x: 1037.5, y: 629.5 },
];

/** Precios reales de la misma captura (subconjunto representativo). */
const PRICES = [
  { price: 1147, x: 211.5, y: 337.5 }, // 14 sep -> 4 nov
  { price: 1245, x: 683.5, y: 337.5 }, // 18 sep -> 4 nov
  { price: 1137, x: 447.5, y: 431.5 }, // 16 sep -> 6 nov
  { price: 1107, x: 565.5, y: 478.5 }, // 17 sep -> 7 nov (el más barato)
  { price: 1394, x: 919.5, y: 478.5 }, // 20 sep -> 7 nov
  { price: 1157, x: 329.5, y: 619.5 }, // 15 sep -> 10 nov
];

const RAW = { heads: HEADS, prices: PRICES };

describe('resolveGridCells — mapeo de coordenadas a fechas', () => {
  test('cruza cada precio con su columna (ida) y su fila (vuelta)', () => {
    const cells = resolveGridCells(RAW, '2026-09-17', '2026-11-07');

    expect(cells).toHaveLength(6);
    const find = (dep, ret) => cells.find(c => c.departureDate === dep && c.returnDate === ret);

    expect(find('2026-09-17', '2026-11-07').price).toBe(1107);
    expect(find('2026-09-14', '2026-11-04').price).toBe(1147);
    expect(find('2026-09-20', '2026-11-07').price).toBe(1394);
    expect(find('2026-09-15', '2026-11-10').price).toBe(1157);
  });

  test('devuelve ordenado de más barato a más caro', () => {
    const cells = resolveGridCells(RAW, '2026-09-17', '2026-11-07');
    const precios = cells.map(c => c.price);
    expect(precios).toEqual([...precios].sort((a, b) => a - b));
    expect(cells[0].price).toBe(1107);
  });

  test('marca la moneda como EUR (la URL fuerza curr=EUR)', () => {
    const cells = resolveGridCells(RAW, '2026-09-17', '2026-11-07');
    expect(cells.every(c => c.currency === 'EUR')).toBe(true);
  });

  test('descarta precios fuera de la grilla', () => {
    // Un precio a mitad de camino entre dos columnas no pertenece a ninguna.
    const raw = { heads: HEADS, prices: [{ price: 999, x: 270, y: 337.5 }] };
    expect(resolveGridCells(raw, '2026-09-17', '2026-11-07')).toHaveLength(0);
  });

  test('descarta combinaciones con vuelta anterior a la ida', () => {
    const heads = [
      { day: 10, month: 9, x: 200, y: 300 },
      { day: 20, month: 9, x: 400, y: 300 },
      { day: 5, month: 9, x: 900, y: 350 },  // vuelta ANTES de las idas
      { day: 25, month: 9, x: 900, y: 400 },
    ];
    const prices = [
      { price: 500, x: 200, y: 350 }, // 10 sep -> 5 sep: imposible
      { price: 600, x: 200, y: 400 }, // 10 sep -> 25 sep: válido
    ];
    const cells = resolveGridCells({ heads, prices }, '2026-09-10', '2026-09-25');
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ departureDate: '2026-09-10', returnDate: '2026-09-25' });
  });

  test('sin precios o sin cabeceras devuelve vacío en vez de romper', () => {
    expect(resolveGridCells({ heads: HEADS, prices: [] }, '2026-09-17', '2026-11-07')).toEqual([]);
    expect(resolveGridCells({ heads: [], prices: PRICES }, '2026-09-17', '2026-11-07')).toEqual([]);
    expect(resolveGridCells(null, '2026-09-17', '2026-11-07')).toEqual([]);
  });
});

describe('yearResolver — el DOM no trae el año', () => {
  test('usa el año de la fecha pedida', () => {
    const r = yearResolver('2026-09-17');
    expect(r({ day: 20, month: 9 })).toBe('2026-09-20');
    expect(r({ day: 3, month: 11 })).toBe('2026-11-03');
  });

  test('diciembre → enero cruza al año siguiente', () => {
    const r = yearResolver('2026-12-28');
    expect(r({ day: 2, month: 1 })).toBe('2027-01-02');
    expect(r({ day: 30, month: 12 })).toBe('2026-12-30');
  });

  test('enero → diciembre vuelve al año anterior', () => {
    const r = yearResolver('2027-01-03');
    expect(r({ day: 29, month: 12 })).toBe('2026-12-29');
    expect(r({ day: 5, month: 1 })).toBe('2027-01-05');
  });
});
