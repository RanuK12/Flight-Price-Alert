/**
 * Tests de la tabla de precios ida x vuelta para Telegram.
 */

'use strict';

const fmt = require('../src/bot/formatters');

/** Grilla chica y controlada: 3 idas x 3 vueltas. */
function celdas(precios) {
  const ida = ['2026-09-15', '2026-09-16', '2026-09-17'];
  const vuelta = ['2026-11-03', '2026-11-04', '2026-11-05'];
  const out = [];
  let i = 0;
  for (const d of ida) for (const r of vuelta) out.push({ departureDate: d, returnDate: r, price: precios[i++] });
  return out;
}

describe('priceGrid', () => {
  test('marca la celda mas barata con «', () => {
    const html = fmt.priceGrid(celdas([1200, 1100, 1300, 1400, 950, 1500, 1600, 1700, 1800]));
    expect(html).toContain('«950');
    expect((html.match(/«/g) || [])).toHaveLength(1);
  });

  test('usa <pre> para que Telegram lo muestre monoespaciado', () => {
    const html = fmt.priceGrid(celdas([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => n * 100)));
    expect(html).toContain('<pre>');
    expect(html).toContain('</pre>');
  });

  test('las cabeceras son los dias del mes', () => {
    const html = fmt.priceGrid(celdas(Array(9).fill(1000)));
    const encabezado = html.split('<pre>')[1].split('\n')[0];
    expect(encabezado).toMatch(/\s+3\s+4\s+5\s*$/);
  });

  test('compara contra el umbral y dice cuanto falta', () => {
    const html = fmt.priceGrid(celdas(Array(9).fill(1000)), { threshold: 800 });
    expect(html).toContain('€800');
    expect(html).toMatch(/faltan €200/);
  });

  test('marca con ✅ cuando el precio cumple el umbral', () => {
    const html = fmt.priceGrid(celdas([700, ...Array(8).fill(1000)]), { threshold: 800 });
    expect(html).toContain('✅');
    expect(html).not.toMatch(/faltan/);
  });

  test('recorta a las filas de ida mas baratas', () => {
    const ida = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
    const cells = ida.map((d, i) => ({ departureDate: d, returnDate: '2026-11-03', price: 1000 + i * 100 }));

    const html = fmt.priceGrid(cells, { maxRows: 2 });
    const filas = html.split('<pre>')[1].split('</pre>')[0].trim().split('\n');
    expect(filas).toHaveLength(3); // cabecera + 2 filas
    expect(html).toContain('«1000');
    expect(html).not.toContain('1400'); // la mas cara queda afuera
  });

  test('las combinaciones sin precio se muestran como ·', () => {
    const cells = [
      { departureDate: '2026-09-15', returnDate: '2026-11-03', price: 900 },
      { departureDate: '2026-09-15', returnDate: '2026-11-05', price: 950 },
      { departureDate: '2026-09-16', returnDate: '2026-11-03', price: 990 },
    ];
    const html = fmt.priceGrid(cells);
    expect(html).toContain('·'); // 16/09 -> 05/11 no existe
  });

  test('sin datos devuelve vacio en vez de una tabla rota', () => {
    expect(fmt.priceGrid([])).toBe('');
    expect(fmt.priceGrid(null)).toBe('');
    expect(fmt.priceGrid([{ departureDate: 'x', returnDate: 'y', price: NaN }])).toBe('');
  });

  test('escapa el titulo (viene de datos, no de codigo)', () => {
    const html = fmt.priceGrid(celdas(Array(9).fill(1000)), { title: '<script>x</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
