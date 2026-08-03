/**
 * GridScan — barre una ventana de fechas usando la "Tabla de fechas" de
 * Google Flights en vez de una búsqueda por combinación.
 *
 * El problema que resuelve: la configuración de Emilio son 8 fechas de ida x
 * 8 de vuelta x 8 pares de aeropuertos = 512 búsquedas de ida y vuelta. A ~25s
 * cada una son más de 3 horas de scraping, y el alertEngine sólo alcanza a
 * mirar 40 rutas por hora.
 *
 * Google ya calcula la grilla entera de una: una carga de página devuelve 7
 * fechas de ida x 7 de vuelta con el precio de cada combinación. Cubrir 8x8
 * necesita 4 grillas (ver `planCenters`), o sea 4 cargas por par de
 * aeropuertos en lugar de 64. Medido: 5 pares completos en ~65 segundos.
 *
 * Esto NO reemplaza al alertEngine: lo alimenta. La grilla dice qué
 * combinaciones valen la pena; la búsqueda normal confirma precio, aerolínea
 * y link de compra antes de alertar.
 *
 * @module services/gridScan
 */

'use strict';

const logger = require('../utils/logger').child('gridScan');

/**
 * Radio de la grilla: Google muestra la fecha pedida y 3 días para cada lado.
 * Verificado contra el DOM real (pedir 17 sep devuelve 14..20 sep).
 */
const GRID_RADIUS = 3;

/** Pausa entre grillas. Sin pausa Google deja de renderizar la tabla. */
const INTER_GRID_DELAY_MS = Number(process.env.GRID_SCAN_DELAY_MS) || 5000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** "YYYY-MM-DD" → Date en UTC (evita corrimientos por huso). */
function toUtc(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Date → "YYYY-MM-DD". */
function toIso(date) {
  return date.toISOString().split('T')[0];
}

/** Suma días a una fecha ISO. */
function addDays(iso, days) {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/**
 * Elige las fechas-centro mínimas para cubrir todas las pedidas.
 *
 * Cada grilla centrada en C cubre [C-3, C+3]. Greedy: se centra en la primera
 * fecha sin cubrir más el radio, se marcan las que entraron, y se repite.
 * Para 8 días consecutivos da 2 centros.
 *
 * @param {string[]} dates - fechas ISO, en cualquier orden
 * @returns {string[]} fechas-centro ISO, ordenadas
 */
function planCenters(dates) {
  const sorted = [...new Set(dates)].sort();
  if (!sorted.length) return [];

  const lastWanted = sorted[sorted.length - 1];
  const centers = [];
  let i = 0;

  while (i < sorted.length) {
    // El centro natural es "primera sin cubrir + radio", pero se topea en la
    // última fecha que interesa: sin el tope, cubrir el día 22 de una ventana
    // 15-22 centraba la grilla en el 25 y gastaba 4 de las 7 columnas en
    // fechas que no se piden. Con tope queda centrada en el 22 (cubre 19-25) y
    // 4 columnas caen dentro de la ventana.
    const center = minIso(addDays(sorted[i], GRID_RADIUS), lastWanted);
    centers.push(center);
    const last = addDays(center, GRID_RADIUS);
    while (i < sorted.length && sorted[i] <= last) i += 1;
  }
  return centers;
}

/** La menor de dos fechas ISO (comparables como texto). */
function minIso(a, b) {
  return a <= b ? a : b;
}

/**
 * Cuántas cargas de página hace falta para cubrir una ventana.
 * Los dos ejes son independientes dentro de la misma grilla, así que es el
 * producto de los centros de cada eje.
 *
 * @param {string[]} outboundDates
 * @param {string[]} returnDates
 * @returns {Array<{departureDate: string, returnDate: string}>}
 */
function planGridFetches(outboundDates, returnDates) {
  const depCenters = planCenters(outboundDates);
  const retCenters = planCenters(returnDates);
  const plan = [];
  for (const departureDate of depCenters) {
    for (const returnDate of retCenters) {
      plan.push({ departureDate, returnDate });
    }
  }
  return plan;
}

/**
 * Pide una grilla, y si falla la reintenta una vez.
 *
 * El fallo es transitorio y está medido: en una tanda de 6 aeropuertos
 * seguidos, 2 devolvieron vacío en 3-5 segundos, y los mismos 2 funcionaron
 * perfecto al pedirlos de a uno. Google a veces no llega a renderizar la barra
 * con "Tabla de fechas". Un reintento tapa el caso sin inventar complejidad:
 * si falla dos veces, es un problema de verdad y se loguea como tal.
 *
 * @param {object} scraper
 * @param {string} origin @param {string} destination
 * @param {string} departureDate @param {string} returnDate
 * @param {number} delayMs - pausa antes de reintentar
 * @returns {Promise<{success: boolean, cells: Array, error?: string}>}
 */
async function fetchWithRetry(scraper, origin, destination, departureDate, returnDate, delayMs) {
  const attempt = () => scraper
    .searchDateGrid(origin, destination, departureDate, returnDate)
    .catch((err) => ({ success: false, cells: [], error: err.message }));

  const first = await attempt();
  if (first.success) return first;

  logger.debug('Grilla vacía, reintentando', {
    route: `${origin}-${destination}`, departureDate, err: first.error,
  });
  if (delayMs > 0) await sleep(delayMs);
  return attempt();
}

/**
 * Barre un par de aeropuertos y devuelve el precio de cada combinación
 * pedida.
 *
 * Las grillas se solapan a propósito (el plan cubre de más), así que una misma
 * combinación puede venir de dos grillas: nos quedamos con la más barata.
 *
 * @param {string} origin
 * @param {string} destination
 * @param {string[]} outboundDates - fechas ISO de ida que interesan
 * @param {string[]} returnDates - fechas ISO de vuelta que interesan
 * @param {{scraper?: object, delayMs?: number}} [deps] - inyectable para tests
 * @returns {Promise<{cells: Array<{departureDate:string, returnDate:string, price:number, currency:string}>, fetches: number, failed: number}>}
 */
async function scanRoute(origin, destination, outboundDates, returnDates, deps = {}) {
  // eslint-disable-next-line global-require
  const scraper = deps.scraper || require('../../server/scrapers/playwrightScraper');
  const delayMs = deps.delayMs ?? INTER_GRID_DELAY_MS;

  if (!scraper.isAvailable()) {
    logger.warn('Playwright no disponible, no se puede usar el date grid');
    return { cells: [], fetches: 0, failed: 0 };
  }

  const wantedOut = new Set(outboundDates);
  const wantedRet = new Set(returnDates);
  const plan = planGridFetches(outboundDates, returnDates);

  /** @type {Map<string, {departureDate:string, returnDate:string, price:number, currency:string}>} */
  const best = new Map();
  let failed = 0;

  for (let i = 0; i < plan.length; i++) {
    const { departureDate, returnDate } = plan[i];
    const result = await fetchWithRetry(scraper, origin, destination, departureDate, returnDate, delayMs);

    if (!result.success) {
      failed += 1;
      logger.warn('Grilla sin resultado tras reintentar', {
        route: `${origin}-${destination}`, departureDate, returnDate, err: result.error,
      });
    }

    for (const cell of result.cells || []) {
      // La grilla trae 7x7: descartamos lo que quede fuera de la ventana.
      if (!wantedOut.has(cell.departureDate) || !wantedRet.has(cell.returnDate)) continue;
      const key = `${cell.departureDate}|${cell.returnDate}`;
      const prev = best.get(key);
      if (!prev || cell.price < prev.price) best.set(key, cell);
    }

    if (i + 1 < plan.length && delayMs > 0) await sleep(delayMs);
  }

  const cells = [...best.values()].sort((a, b) => a.price - b.price);
  logger.info('Barrido de grilla terminado', {
    route: `${origin}-${destination}`,
    fetches: plan.length, failed,
    combinaciones: cells.length,
    esperadas: wantedOut.size * wantedRet.size,
    minPrice: cells[0]?.price ?? null,
  });

  return { cells, fetches: plan.length, failed };
}

module.exports = {
  scanRoute,
  planGridFetches,
  planCenters,
  GRID_RADIUS,
};
