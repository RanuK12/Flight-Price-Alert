/**
 * Tests de la espera de resultados.
 *
 * Google falla al renderizar cada tanto y deja su propia pantalla de error
 * ("No se han devuelto resultados / Vaya, se ha producido un error") con un
 * botón "Volver a cargar". Medido el 23/08/2026 sobre BCN→EZE 17/09 - 04/11,
 * el caso que venía fallando en producción: la primera carga queda vacía y la
 * recarga trae los resultados. Sin la recarga, el barrido lo reportaba como
 * "grid button not found".
 *
 * Se prueba con una página falsa: lo que importa es cuántas veces recarga y
 * qué devuelve, no el navegador.
 */

'use strict';

jest.mock('playwright', () => ({ chromium: { launch: async () => ({}) } }));

const { waitForResults } = require('../server/scrapers/playwrightScraper');

/** Página falsa: `rinde` decide, por intento, si aparece el selector. */
function fakePage(rinde) {
  const page = {
    intentos: 0,
    recargas: 0,
    async waitForSelector() {
      const ok = rinde[page.intentos];
      page.intentos += 1;
      if (!ok) throw new Error('Timeout exceeded');
      return {};
    },
    async reload() { page.recargas += 1; },
  };
  return page;
}

describe('waitForResults', () => {
  test('sin recargar cuando Google rinde a la primera', async () => {
    const page = fakePage([true]);
    await expect(waitForResults(page, { timeoutMs: 1 })).resolves.toBe(true);
    expect(page.recargas).toBe(0);
  });

  test('recarga una vez y se recupera (el caso medido en producción)', async () => {
    const page = fakePage([false, true]);
    await expect(waitForResults(page, { timeoutMs: 1 })).resolves.toBe(true);
    expect(page.recargas).toBe(1);
  });

  test('devuelve false si tampoco rinde tras la recarga', async () => {
    const page = fakePage([false, false]);
    await expect(waitForResults(page, { timeoutMs: 1 })).resolves.toBe(false);
    // No insiste de más: una recarga y se rinde.
    expect(page.recargas).toBe(1);
    expect(page.intentos).toBe(2);
  });
});
