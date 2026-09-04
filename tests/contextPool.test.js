/**
 * Tests del pool de contextos del scraper.
 *
 * Lo que importa verificar: que reciclar el contexto NO mate las páginas que
 * otro cron tiene en vuelo. alertEngine y gridSweep comparten el locale es-ES
 * y se solapan; con el reciclado viejo el uso 25 de uno cerraba el contexto y
 * la búsqueda del otro moría con "Target page, context or browser has been
 * closed" (logs 08-23).
 *
 * Se mockea playwright: lo que se prueba es la contabilidad del pool, no el
 * navegador.
 */

'use strict';

/** Contexto falso que registra si lo cerraron y cuántas páginas tiene vivas. */
function makeFakeBrowser() {
  const contexts = [];
  const browser = {
    isConnected: () => true,
    async newContext() {
      const context = {
        closed: false,
        livePages: 0,
        addCookies: async () => {},
        addInitScript: async () => {},
        async newPage() {
          if (context.closed) throw new Error('Target page, context or browser has been closed');
          context.livePages += 1;
          return {
            close: async () => { context.livePages -= 1; },
            /** Falla igual que Playwright si el contexto se cerró debajo. */
            assertUsable: () => {
              if (context.closed) throw new Error('Target page, context or browser has been closed');
            },
          };
        },
        close: async () => { context.closed = true; },
      };
      contexts.push(context);
      return context;
    },
  };
  return { browser, contexts };
}

const mockFake = makeFakeBrowser();
jest.mock('playwright', () => ({
  chromium: { launch: async () => mockFake.browser },
}));

const scraper = require('../server/scrapers/playwrightScraper');
const { newPageFor, closePage, RECYCLE_AFTER } = scraper;

afterEach(async () => {
  await scraper.closeContexts();
});

describe('pool de contextos', () => {
  test('reutiliza el mismo contexto por locale', async () => {
    const a = await newPageFor('MAD');
    const b = await newPageFor('BCN');
    expect(mockFake.contexts.filter(c => !c.closed).length).toBe(1);
    await closePage(a);
    await closePage(b);
  });

  test('reciclar no cierra el contexto mientras haya una página en vuelo', async () => {
    // Una búsqueda larga arranca y se queda abierta (como searchDateGrid).
    const enVuelo = await newPageFor('MAD');
    const viejo = mockFake.contexts[mockFake.contexts.length - 1];

    // Otro cron consume los usos que faltan y dispara el reciclado.
    for (let i = 0; i < RECYCLE_AFTER; i++) {
      const p = await newPageFor('BCN');
      await closePage(p);
    }

    // El contexto viejo salió del pool pero sigue vivo: la página no murió.
    expect(() => enVuelo.assertUsable()).not.toThrow();

    // Recién al soltarla se cierra.
    expect(viejo.closed).toBe(false);
    await closePage(enVuelo);
    expect(viejo.closed).toBe(true);
  });

  test('dos llamadas simultáneas no crean dos contextos', async () => {
    const antes = mockFake.contexts.length;
    const [a, b] = await Promise.all([newPageFor('MAD'), newPageFor('BCN')]);
    expect(mockFake.contexts.length - antes).toBe(1);
    await closePage(a);
    await closePage(b);
  });
});
