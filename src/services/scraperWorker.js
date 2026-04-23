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

const SCRAPER_TIMEOUT_MS = Number(process.env.SCRAPER_TIMEOUT_MS) || 30000;

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

  return Promise.race([
    searchFlightsApi(origin, destination, departureDate, returnDate),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('scraper-timeout')), SCRAPER_TIMEOUT_MS);
    }),
  ]);
}

module.exports = { search };
