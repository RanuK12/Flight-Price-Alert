/**
 * Token bucket + circuit breaker para Amadeus.
 *
 * Token bucket:
 *   - Capacidad = burst (default 10)
 *   - Refill = `rps` tokens/segundo
 *   - `acquire()` espera hasta haber un token disponible
 *
 * Circuit breaker:
 *   - Si vemos N errores 5xx seguidos, abrimos el circuito por `openMs`
 *   - Mientras esté abierto, `acquire()` lanza CircuitOpenError
 *   - Tras `openMs`, pasa a "half-open" → deja pasar 1 request de prueba
 *
 * @module providers/amadeus/rateLimiter
 */

'use strict';

const { CircuitOpenError, RateLimitError } = require('../../utils/errors');
const { sleep } = require('../../utils/retry');

/** Estados del breaker. */
const STATE = Object.freeze({
  CLOSED: 'closed',       // operación normal
  OPEN: 'open',           // fallando — bloqueamos requests
  HALF_OPEN: 'half_open', // test period — 1 request pasa
});

class AmadeusRateLimiter {
  /**
   * @param {Object} [options]
   * @param {number} [options.rps=8]            Requests/segundo sostenido.
   * @param {number} [options.burst=10]         Tokens máx. en el bucket.
   * @param {number} [options.failureThreshold=5]  Errores seguidos para abrir breaker.
   * @param {number} [options.openMs=30000]     Duración del estado OPEN.
   */
  constructor(options = {}) {
    this.rps = options.rps ?? 8;
    this.capacity = options.burst ?? 10;
    this.tokens = this.capacity;
    this.lastRefillAt = Date.now();

    this.failureThreshold = options.failureThreshold ?? 5;
    this.openMs = options.openMs ?? 30_000;

    this.state = STATE.CLOSED;
    this.consecutiveFailures = 0;
    this.openedAt = 0;

    /** Instante hasta el cual NO se debe lanzar ninguna request (por 429). */
    this.blockedUntil = 0;
  }

  /** Recalcula tokens en base al tiempo transcurrido. */
  _refill() {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillAt) / 1000;
    if (elapsedSec <= 0) return;
    const added = elapsedSec * this.rps;
    this.tokens = Math.min(this.capacity, this.tokens + added);
    this.lastRefillAt = now;
  }

  /** Transiciona OPEN → HALF_OPEN si pasó el tiempo. */
  _maybeTransitionFromOpen() {
    if (this.state === STATE.OPEN && Date.now() - this.openedAt >= this.openMs) {
      this.state = STATE.HALF_OPEN;
    }
  }

  /**
   * Adquiere un token. Espera si el bucket está vacío.
   * Lanza CircuitOpenError si el breaker está abierto.
   * Lanza RateLimitError si estamos bloqueados por 429 reciente.
   * @returns {Promise<void>}
   */
  async acquire() {
    this._maybeTransitionFromOpen();

    if (this.state === STATE.OPEN) {
      const remaining = Math.max(0, this.openMs - (Date.now() - this.openedAt));
      throw new CircuitOpenError('Amadeus circuit breaker is OPEN', {
        meta: { remainingMs: remaining },
      });
    }

    const wait = this.blockedUntil - Date.now();
    if (wait > 0) {
      throw new RateLimitError('Amadeus rate-limited, waiting', {
        retryAfterMs: wait,
      });
    }

    this._refill();

    if (this.tokens < 1) {
      // Esperar a que se genere al menos 1 token
      const needed = 1 - this.tokens;
      const waitMs = Math.ceil((needed / this.rps) * 1000);
      await sleep(waitMs);
      this._refill();
    }

    this.tokens -= 1;
  }

  /**
   * Notifica éxito — cierra breaker si estaba en HALF_OPEN.
   */
  recordSuccess() {
    this.consecutiveFailures = 0;
    if (this.state === STATE.HALF_OPEN) {
      this.state = STATE.CLOSED;
    }
  }

  /**
   * Notifica fallo transitorio (5xx/timeout). Puede abrir el breaker.
   */
  recordFailure() {
    this.consecutiveFailures += 1;
    if (this.state === STATE.HALF_OPEN || this.consecutiveFailures >= this.failureThreshold) {
      this.state = STATE.OPEN;
      this.openedAt = Date.now();
    }
  }

  /**
   * Bloquea toda actividad por `retryAfterMs` ms (respuesta a 429).
   * @param {number} retryAfterMs
   */
  recordRateLimit(retryAfterMs) {
    this.blockedUntil = Date.now() + Math.max(1000, retryAfterMs);
  }

  /** Snapshot para logs/debug. */
  stats() {
    return {
      state: this.state,
      tokens: Number(this.tokens.toFixed(2)),
      capacity: this.capacity,
      rps: this.rps,
      consecutiveFailures: this.consecutiveFailures,
      blockedForMs: Math.max(0, this.blockedUntil - Date.now()),
    };
  }
}

module.exports = { AmadeusRateLimiter, STATE };
