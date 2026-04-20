/**
 * Contrato común para todos los providers de vuelos (Amadeus, Google Flights,
 * Puppeteer fallback). Exponen el mismo shape → el resto del sistema
 * (bot, alertEngine, DB) no necesita saber qué provider devolvió el dato.
 *
 * @module providers/base
 */

'use strict';

/**
 * Representación normalizada de un segmento de vuelo.
 * @typedef {Object} FlightSegment
 * @property {string} origin          IATA (ej. "EZE")
 * @property {string} destination     IATA
 * @property {string} departureAt     ISO 8601 ("2026-06-15T22:10:00")
 * @property {string} arrivalAt       ISO 8601
 * @property {string} carrierCode     IATA aerolínea ("IB", "AR")
 * @property {string} [flightNumber]  "IB6844"
 * @property {string} [duration]      ISO 8601 duration ("PT12H30M")
 * @property {string} [cabin]         "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST"
 * @property {string} [aircraft]
 */

/**
 * Representación normalizada de UN vuelo (oferta).
 * Ambos providers mapean a esta shape en `normalize()`.
 *
 * @typedef {Object} Flight
 * @property {string} source              'amadeus' | 'google_flights' | 'puppeteer'
 * @property {string} origin              IATA origen del viaje
 * @property {string} destination         IATA destino del viaje
 * @property {number} price               Total por pasajero
 * @property {string} currency            "USD" | "EUR" | ...
 * @property {string} tripType            "oneway" | "roundtrip"
 * @property {string} departureDate       "YYYY-MM-DD"
 * @property {string|null} returnDate     "YYYY-MM-DD" | null
 * @property {string} airline             Carrier principal (o "Multiple" si mixto)
 * @property {string[]} [carrierCodes]    Lista de carriers involucrados
 * @property {number} stops               0 = directo
 * @property {string} [duration]          ISO 8601 ("PT14H30M")
 * @property {FlightSegment[]} [segments] Detalle (outbound)
 * @property {FlightSegment[]} [returnSegments] Detalle (inbound, si roundtrip)
 * @property {string} [bookingUrl]        URL para reservar (deep link)
 * @property {string} [offerId]           ID del provider (ej. Amadeus offer id, para pricing confirm)
 * @property {Object} [raw]               Payload original (debug)
 * @property {string} fetchedAt           ISO 8601 timestamp de la respuesta
 */

/**
 * Parámetros canónicos para buscar vuelos.
 * @typedef {Object} FlightSearchParams
 * @property {string} origin              IATA
 * @property {string} destination         IATA
 * @property {string} departureDate       "YYYY-MM-DD"
 * @property {string} [returnDate]        "YYYY-MM-DD" — roundtrip si presente
 * @property {number} [adults=1]
 * @property {number} [children=0]
 * @property {number} [infants=0]
 * @property {string} [currency]          default del provider
 * @property {number} [max]               Máx. resultados
 * @property {'ECONOMY'|'PREMIUM_ECONOMY'|'BUSINESS'|'FIRST'} [travelClass]
 * @property {boolean} [nonStop=false]
 */

/**
 * @typedef {Object} FlightSearchResult
 * @property {Flight[]} flights
 * @property {string} source
 * @property {boolean} cached
 * @property {string} fetchedAt
 * @property {Object} [meta]             diagnóstico (counts, warnings)
 */

/**
 * Interfaz abstracta. Los providers extienden y deben implementar
 * al menos `search()`.
 *
 * @abstract
 */
class FlightProvider {
  /** @param {string} name */
  constructor(name) {
    if (new.target === FlightProvider) {
      throw new Error('FlightProvider is abstract — subclass it.');
    }
    this.name = name;
  }

  /**
   * Busca vuelos. Debe ser implementado.
   * @param {FlightSearchParams} _params
   * @returns {Promise<FlightSearchResult>}
   */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  async search(_params) {
    throw new Error('not implemented');
  }

  /**
   * Healthcheck del provider. Default: ok.
   * @returns {Promise<{ok: boolean, detail?: string}>}
   */
  // eslint-disable-next-line class-methods-use-this
  async health() {
    return { ok: true };
  }
}

module.exports = { FlightProvider };
