/**
 * Tests de los botones "📉 Mejores precios" y "📊 Por aeropuerto".
 *
 * Lo que vale la pena atar: que el botón exista, que su callback llegue al
 * handler correcto, y que cuando todavía no hay datos guardados el bot lo
 * DIGA en vez de mandar un mensaje vacío o un error. Ese último caso es el
 * normal entre un deploy y el primer barrido.
 */

'use strict';

jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
}));
jest.mock('../src/services/dailyReport', () => ({
  buildBestPricesSection: jest.fn(),
  buildGridSection: jest.fn(),
}));

const kb = require('../src/bot/keyboards');
const report = require('../src/services/dailyReport');
const { sendMejoresPrecios, sendGrilla } = require('../src/bot/handlers/precios');

/** Todos los callback_data del menú principal, aplanados. */
const callbacks = kb.mainMenu().inline_keyboard.flat().map(b => b.callback_data);

function fakeBot() {
  return { sendMessage: jest.fn().mockResolvedValue({}) };
}

beforeEach(() => jest.clearAllMocks());

describe('el menú principal', () => {
  test('tiene los dos botones nuevos', () => {
    expect(callbacks).toContain('menu:precios');
    expect(callbacks).toContain('menu:grilla');
  });

  test('no perdió ninguno de los que ya estaban', () => {
    for (const c of ['menu:buscar', 'menu:nueva_alerta', 'menu:mis_alertas',
      'menu:ofertas', 'menu:inspirar', 'menu:informe', 'menu:config']) {
      expect(callbacks).toContain(c);
    }
  });

  test('ningún callback_data pasa de 64 bytes (límite de Telegram)', () => {
    for (const c of callbacks) expect(Buffer.byteLength(c)).toBeLessThanOrEqual(64);
  });
});

describe('cada botón llama a su sección', () => {
  test('precios usa buildBestPricesSection', async () => {
    report.buildBestPricesSection.mockResolvedValue('📉 <b>Mejores precios</b>');
    const bot = fakeBot();

    await sendMejoresPrecios(bot, 42, 7);

    expect(report.buildBestPricesSection).toHaveBeenCalledWith(7);
    expect(report.buildGridSection).not.toHaveBeenCalled();
    const [chatId, texto, opts] = bot.sendMessage.mock.calls[0];
    expect(chatId).toBe(42);
    expect(texto).toContain('Mejores precios');
    expect(opts.parse_mode).toBe('HTML');
  });

  test('grilla usa buildGridSection', async () => {
    report.buildGridSection.mockResolvedValue('📊 <b>Por aeropuerto</b>');
    const bot = fakeBot();

    await sendGrilla(bot, 42, 7);

    expect(report.buildGridSection).toHaveBeenCalledWith(7);
    expect(report.buildBestPricesSection).not.toHaveBeenCalled();
    expect(bot.sendMessage.mock.calls[0][1]).toContain('Por aeropuerto');
  });
});

describe('cuando todavía no hay datos', () => {
  test('avisa que no hay precios guardados, no manda nada vacío', async () => {
    report.buildBestPricesSection.mockResolvedValue(null);
    const bot = fakeBot();

    await sendMejoresPrecios(bot, 42, 7);

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.sendMessage.mock.calls[0][1]).toMatch(/todavía no hay precios/i);
  });

  test('un error de la sección no tumba el bot', async () => {
    report.buildGridSection.mockRejectedValue(new Error('mongo caido'));
    const bot = fakeBot();

    await expect(sendGrilla(bot, 42, 7)).resolves.toBe(true);
    expect(bot.sendMessage.mock.calls[0][1]).toContain('mongo caido');
  });

  test('siempre deja el menú a mano para no dejar al usuario colgado', async () => {
    report.buildBestPricesSection.mockResolvedValue(null);
    const bot = fakeBot();

    await sendMejoresPrecios(bot, 42, 7);

    expect(bot.sendMessage.mock.calls[0][2].reply_markup).toEqual(kb.mainMenu());
  });
});
