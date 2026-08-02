/**
 * Scraper Worker — wrapper con timeout para ejecutar el scraper de
 * Google Flights sin bloquear el event loop del bot.
 *
 * Si el scraper tarda más de SCRAPER_TIMEOUT_MS (default 30s),
 * se fuerza un error controlado y el caller puede hacer fallback
 * a Amadeus.
 *
 * @module services/scraperWorker
 */

'use strict';

const { config } = require('../config');
const logger = require('../utils/logger').child('scraperWorker');

const SCRAPER_TIMEOUT_MS = Number(process.env.SCRAPER_TIMEOUT_MS) || 45000;

/**
 * Multiplicador para roundtrips. Cuando Google no devuelve un roundtrip
 * parseable, googleFlightsApi cae a buscar las dos piernas por separado:
 * son dos búsquedas completas más, secuenciales. Con un presupuesto único
 * la carrera rechazaba antes de que terminaran y el resultado ya calculado
 * se tiraba a la basura (logs 08-02: "Scraper timeout" seguido de
 * "✅ API (RT combinado)").
 */
const ROUNDTRIP_TIMEOUT_FACTOR = 2.5;

/**
 * Ejecuta searchFlightsApi con timeout hard.
 * @param {string} origin
 * @param {string} destination
 * @param {string} departureDate
 * @param {string|null} returnDate
 * @returns {Promise<any>}
 */
async function search(origin, destination, departureDate, returnDate) {
  // eslint-disable-next-line global-require
  const { searchFlightsApi } = require('../../server/scrapers/googleFlightsApi');

  const budgetMs = returnDate
    ? Math.round(SCRAPER_TIMEOUT_MS * ROUNDTRIP_TIMEOUT_FACTOR)
    : SCRAPER_TIMEOUT_MS;

  let timer;
  try {
    return await Promise.race([
      searchFlightsApi(origin, destination, departureDate, returnDate),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('scraper-timeout')), budgetMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { search };
