/**
 * Barrel export del provider Amadeus.
 *
 * Uso preferido:
 *   const amadeus = require('./providers/amadeus');
 *   const result = await amadeus.offers.searchFlights({ origin: 'EZE', ... });
 *   const pricing = await amadeus.pricing.confirmOffer(offer.raw);
 *   const dests  = await amadeus.inspiration.searchDestinations({ origin: 'EZE', maxPrice: 500 });
 *
 * @module providers/amadeus
 */

'use strict';

const { getClient } = require('./client');
const offers = require('./flightOffers');
const pricing = require('./flightPriceConfirm');
const inspiration = require('./inspirationSearch');

module.exports = {
  getClient,
  offers,
  pricing,
  inspiration,
  // Provider que cumple el contrato FlightProvider para uso vía router:
  FlightOffersProvider: offers.AmadeusFlightOffersProvider,
};
