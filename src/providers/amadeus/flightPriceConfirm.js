/**
 * Amadeus Flight Offers Price — confirmación de precio y disponibilidad
 * real antes de alertar al usuario. Evita falsos positivos del scraper.
 *
 * Flujo típico:
 *   1. Búsqueda (scraper o Amadeus offers) devuelve un precio candidato.
 *   2. Si parece una oferta → llamar a `confirmOffer(amadeusOffer)`
 *      con el payload completo de la oferta para revalidar.
 *   3. Si Amadeus confirma un precio igual o menor → disparar alerta.
 *      Si el precio subió o la oferta ya no existe → descartar.
 *
 * @module providers/amadeus/flightPriceConfirm
 */

'use strict';

const { AMADEUS_ENDPOINTS } = require('../../config/constants');
const { NoResultsError } = require('../../utils/errors');
const logger = require('../../utils/logger').child('amadeus:pricing');
const { getClient } = require('./client');

/**
 * @typedef {Object} PricingResult
 * @property {boolean} confirmed          El precio sigue vigente.
 * @property {number|null} confirmedPrice Precio re-cotizado (total).
 * @property {number|null} originalPrice  Precio que se mandó a confirmar.
 * @property {number|null} priceDeltaPct  % de variación (+ = subió).
 * @property {string} currency
 * @property {string[]} warnings          Texto de warnings de Amadeus.
 * @property {Object} [raw]               Payload crudo (debug).
 */

/**
 * Confirma precio y disponibilidad de una oferta previa.
 *
 * Amadeus requiere el payload completo de la oferta tal como vino de
 * flight-offers. No se puede pasar sólo un ID — hay que enviar la
 * estructura `flightOffers: [offer]`.
 *
 * @param {Record<string, any>} amadeusOffer  Oferta cruda (la guardada en `raw` o la que vino).
 * @returns {Promise<PricingResult>}
 */
async function confirmOffer(amadeusOffer) {
  if (!amadeusOffer || typeof amadeusOffer !== 'object') {
    throw new Error('confirmOffer: amadeusOffer payload is required');
  }

  const client = getClient();
  const originalPrice = Number.parseFloat(
    amadeusOffer?.price?.total ?? amadeusOffer?.price?.grandTotal ?? 'NaN',
  );
  const currency = amadeusOffer?.price?.currency || 'USD';

  const body = {
    data: {
      type: 'flight-offers-pricing',
      flightOffers: [amadeusOffer],
    },
  };

  logger.info('Confirming Amadeus offer', {
    offerId: amadeusOffer.id,
    originalPrice,
  });

  const response = await client.request({
    method: 'POST',
    url: AMADEUS_ENDPOINTS.FLIGHT_OFFERS_PRICING,
    data: body,
    headers: { 'Content-Type': 'application/vnd.amadeus+json' },
  });

  const offer = response?.data?.flightOffers?.[0];
  if (!offer) {
    throw new NoResultsError('Pricing response did not include a flight offer', {
      meta: { offerId: amadeusOffer.id },
    });
  }

  const confirmedPrice = Number.parseFloat(
    offer?.price?.total ?? offer?.price?.grandTotal ?? 'NaN',
  );
  const confirmed = Number.isFinite(confirmedPrice);
  const priceDeltaPct = confirmed && Number.isFinite(originalPrice) && originalPrice > 0
    ? ((confirmedPrice - originalPrice) / originalPrice) * 100
    : null;

  const warnings = Array.isArray(response?.warnings)
    ? response.warnings.map((w) => /** @type {string} */ (w.title || w.detail || '')).filter(Boolean)
    : [];

  logger.info('Amadeus pricing confirmed', {
    offerId: amadeusOffer.id,
    originalPrice,
    confirmedPrice,
    priceDeltaPct: priceDeltaPct?.toFixed(2),
  });

  return {
    confirmed,
    confirmedPrice: confirmed ? confirmedPrice : null,
    originalPrice: Number.isFinite(originalPrice) ? originalPrice : null,
    priceDeltaPct,
    currency: offer?.price?.currency || currency,
    warnings,
  };
}

module.exports = { confirmOffer };
