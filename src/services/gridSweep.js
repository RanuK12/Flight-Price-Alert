/**
 * GridSweep — pasada barata sobre TODAS las rutas de ida y vuelta usando la
 * "Tabla de fechas" de Google Flights.
 *
 * Complementa al alertEngine, no lo reemplaza:
 *
 *   · gridSweep (esto)  → ~30 cargas de página cubren las 512 combinaciones.
 *                         Da precio y nada más. Actualiza `lastPriceEur` de
 *                         cada ruta y marca cuál merece mirarse en detalle.
 *   · alertEngine       → busca en detalle (aerolínea, escalas, link de
 *                         compra) y es el único que notifica.
 *
 * La división existe porque la grilla no trae ni aerolínea ni link: sirve para
 * saber DÓNDE mirar, no para alertar. Sin esto el alertEngine tarda 2,7 días
 * en dar una vuelta completa y las ofertas duran horas.
 *
 * @module services/gridSweep
 */

'use strict';

const routesRepo = require('../database/repositories/routesRepo');
const gridScan = require('./gridScan');
const radar = require('../providers/travelpayouts');
const logger = require('../utils/logger').child('gridSweep');

/**
 * Si la caché de Aviasales dice que el mínimo histórico de una ruta está más
 * de 2x por encima del umbral, no gastamos 4 cargas de Playwright ahí.
 *
 * El múltiplo es generoso a propósito: los precios de la caché son viejos y
 * pueden no reflejar una oferta nueva. Sólo descarta lo que es claramente
 * imposible, no lo que es caro.
 */
const RADAR_SKIP_MULTIPLIER = 2;

/** Evita solapar dos barridos si uno tarda más que el intervalo del cron. */
let sweepInFlight = false;

/** "YYYY-MM-DD" en UTC (las fechas de Mongo vienen a medianoche UTC). */
function isoOf(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

/**
 * Agrupa las rutas de ida y vuelta activas por par de aeropuertos.
 * Cada grupo es un barrido de grilla.
 *
 * @param {any[]} routes
 * @returns {Map<string, {origin: string, destination: string, outboundDates: Set<string>, returnDates: Set<string>, routes: any[]}>}
 */
function groupRoundtripRoutes(routes) {
  const groups = new Map();
  const today = new Date().toISOString().split('T')[0];

  for (const route of routes) {
    if (route.tripType !== 'roundtrip' || !route.returnDate) continue;
    const out = isoOf(route.outboundDate);
    const ret = isoOf(route.returnDate);
    if (!out || !ret || out < today) continue;

    const key = `${route.origin}-${route.destination}`;
    if (!groups.has(key)) {
      groups.set(key, {
        origin: route.origin,
        destination: route.destination,
        outboundDates: new Set(),
        returnDates: new Set(),
        routes: [],
      });
    }
    const g = groups.get(key);
    g.outboundDates.add(out);
    g.returnDates.add(ret);
    g.routes.push({ ...route, _outIso: out, _retIso: ret });
  }
  return groups;
}

/**
 * ¿Esta ruta está tan lejos del umbral que no vale gastar Playwright?
 *
 * Consulta el radar gratis (caché de Aviasales). Ante la duda devuelve false:
 * sin token, sin datos o con error se barre igual. El radar sólo puede
 * ahorrar trabajo, nunca hacer que se pierda una oferta por sí solo.
 *
 * @param {{origin: string, destination: string, outboundDates: Set<string>, routes: any[]}} group
 * @returns {Promise<boolean>}
 */
async function isHopeless(group) {
  if (!radar.isEnabled()) return false;

  const threshold = group.routes.find(r => r.priceThreshold)?.priceThreshold;
  if (!threshold) return false;

  const { minPrice, samples } = await radar.radarMinPrice(
    group.origin, group.destination, [...group.outboundDates],
  );
  // Pocas muestras = la caché no sabe. No decidimos con eso.
  if (minPrice == null || samples < 3) return false;

  const hopeless = minPrice > threshold * RADAR_SKIP_MULTIPLIER;
  if (hopeless) {
    logger.info('Ruta salteada por radar (muy lejos del umbral)', {
      route: `${group.origin}-${group.destination}`,
      radarMin: minPrice, threshold, samples,
    });
  }
  return hopeless;
}

/**
 * Corre un barrido completo: una grilla por par de aeropuertos, y vuelca los
 * precios encontrados en cada ruta.
 *
 * No notifica nada. Deja el terreno listo para que el alertEngine mire primero
 * las combinaciones que la grilla marcó como baratas.
 *
 * @returns {Promise<{pairs: number, fetches: number, updated: number, belowThreshold: number}>}
 */
async function runSweep() {
  if (sweepInFlight) {
    logger.warn('Barrido anterior todavía en curso, se saltea este tick');
    return { pairs: 0, fetches: 0, updated: 0, belowThreshold: 0 };
  }
  sweepInFlight = true;
  const started = Date.now();

  try {
    const routes = await routesRepo.listAllActive();
    const groups = groupRoundtripRoutes(routes);

    logger.info('Barrido iniciado', {
      rutasActivas: routes.length,
      paresDeAeropuertos: groups.size,
    });

    let fetches = 0;
    let updated = 0;
    let belowThreshold = 0;
    let skippedByRadar = 0;

    for (const group of groups.values()) {
      // Radar previo (gratis, milisegundos): si la caché de Aviasales dice que
      // esta ruta nunca estuvo ni cerca del umbral, no gastamos Playwright.
      if (await isHopeless(group)) {
        skippedByRadar += 1;
        continue;
      }

      const { cells, fetches: n } = await gridScan.scanRoute(
        group.origin,
        group.destination,
        [...group.outboundDates],
        [...group.returnDates],
      );
      fetches += n;

      // Índice precio por combinación para volcarlo en cada ruta.
      const byCombo = new Map(cells.map(c => [`${c.departureDate}|${c.returnDate}`, c.price]));

      for (const route of group.routes) {
        const price = byCombo.get(`${route._outIso}|${route._retIso}`);
        if (price === undefined) continue;

        await routesRepo.markChecked(route._id, price).catch((err) => {
          logger.debug('markChecked falló', { err: err.message });
        });
        updated += 1;
        if (route.priceThreshold && price <= route.priceThreshold) belowThreshold += 1;
      }
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    logger.info('Barrido terminado', {
      pairs: groups.size, fetches, updated, belowThreshold,
      skippedByRadar, elapsedSec: elapsed,
    });

    return { pairs: groups.size, fetches, updated, belowThreshold, skippedByRadar };
  } finally {
    sweepInFlight = false;
  }
}

module.exports = { runSweep, groupRoundtripRoutes };
