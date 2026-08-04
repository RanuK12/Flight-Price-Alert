/**
 * Tests de las dos secciones que alimentan los botones "📉 Mejores precios"
 * y "📊 Por aeropuerto".
 *
 * El riesgo concreto: en una ruta VENTANA `outboundDate` es el arranque del
 * rango (14/09), no el día del precio. Mostrarlo como si fuera la fecha de la
 * oferta manda a Emilio a comprar el día equivocado, que es peor que no
 * mostrar nada.
 */

'use strict';

jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
}));
jest.mock('../src/bot', () => ({ getBot: () => null }));
jest.mock('../src/database/repositories/notificationsRepo', () => ({}));
jest.mock('../src/services/hybridSearch', () => ({}));
jest.mock('../src/database/repositories/routesRepo', () => ({
  listCheapestChecked: jest.fn(),
}));

const routesRepo = require('../src/database/repositories/routesRepo');
const { buildBestPricesSection, buildGridSection } = require('../src/services/dailyReport');

/** Ruta ventana 14-20 sep / 1-7 nov, con las fechas buenas ya calculadas. */
function ventana(origin, lastPriceEur, bestOut, bestRet) {
  return {
    origin, destination: 'EZE', tripType: 'roundtrip', priceThreshold: 900,
    lastPriceEur, lastCheckedAt: new Date('2026-08-04T10:00:00Z'),
    outboundDate: new Date('2026-09-14'), outboundDateEnd: new Date('2026-09-20'),
    returnDate: new Date('2026-11-01'), returnDateEnd: new Date('2026-11-07'),
    bestOutboundDate: new Date(bestOut), bestReturnDate: new Date(bestRet),
  };
}

/** Precios reales medidos contra Google el 2026-08-03. */
const MEDIDAS = [
  ventana('MXP', 868, '2026-09-14', '2026-11-07'),
  ventana('LIS', 939, '2026-09-15', '2026-11-01'),
  ventana('MAD', 967, '2026-09-18', '2026-11-01'),
];

beforeEach(() => {
  jest.clearAllMocks();
  routesRepo.listCheapestChecked.mockResolvedValue(MEDIDAS);
});

describe('📉 Mejores precios', () => {
  test('muestra las fechas que DAN el precio, no el arranque de la ventana', async () => {
    const html = await buildBestPricesSection(1);

    // MXP cuesta €868 el 14/09 → 07/11. El arranque de la ventana es 01/11.
    expect(html).toContain('14/09-07/11');
    expect(html).not.toContain('14/09-01/11');
  });

  test('marca con ✅ lo que cumple el umbral y cuantifica lo que no', async () => {
    const html = await buildBestPricesSection(1);

    expect(html).toMatch(/€868.*✅/);
    expect(html).toContain('+€39 sobre tu umbral'); // LIS 939 - 900
    expect(html).toContain('+€67 sobre tu umbral'); // MAD 967 - 900
  });

  test('sin rutas revisadas devuelve null en vez de una sección vacía', async () => {
    routesRepo.listCheapestChecked.mockResolvedValue([]);
    expect(await buildBestPricesSection(1)).toBeNull();
  });

  test('una ruta de solo ida muestra una sola fecha', async () => {
    routesRepo.listCheapestChecked.mockResolvedValue([{
      origin: 'MXP', destination: 'EZE', tripType: 'oneway', priceThreshold: 480,
      lastPriceEur: 420, outboundDate: new Date('2026-09-17'), returnDate: null,
      lastCheckedAt: new Date('2026-08-04T10:00:00Z'),
    }]);

    const html = await buildBestPricesSection(1);
    expect(html).toContain('MXP→EZE</b> 17/09 — €420');
    // Sin vuelta no hay rango: "17/09" a secas, nunca "17/09-algo".
    expect(html).not.toMatch(/\d{2}\/\d{2}-\d{2}\/\d{2}/);
  });
});

describe('📊 Por aeropuerto', () => {
  test('ordena por precio y corona el más barato', async () => {
    const html = await buildGridSection(1);

    expect(html.indexOf('MXP')).toBeLessThan(html.indexOf('LIS'));
    expect(html.indexOf('LIS')).toBeLessThan(html.indexOf('MAD'));
    expect(html).toMatch(/🥇.*MXP/);
  });

  test('dice que el umbral se cumple cuando el mejor precio lo cumple', async () => {
    const html = await buildGridSection(1);
    expect(html).toContain('Cumple tu umbral de €900');
  });

  test('si el mejor precio no llega, dice cuánto falta', async () => {
    routesRepo.listCheapestChecked.mockResolvedValue(
      MEDIDAS.map(r => ({ ...r, priceThreshold: 800 })),
    );

    const html = await buildGridSection(1);
    expect(html).toContain('faltan');
    expect(html).toContain('€68'); // 868 - 800
  });

  test('con una sola ruta no hay ranking que mostrar', async () => {
    routesRepo.listCheapestChecked.mockResolvedValue([MEDIDAS[0]]);
    expect(await buildGridSection(1)).toBeNull();
  });
});
