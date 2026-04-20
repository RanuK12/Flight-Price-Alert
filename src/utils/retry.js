/**
 * Retry con backoff exponencial + jitter, configurable por política.
 * No reintenta errores no-retryable (auth, bad request, quota, rate limit).
 *
 * @module utils/retry
 */

'use strict';

const {
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  RateLimitError,
  QuotaExceededError,
  CircuitOpenError,
} = require('./errors');

/**
 * @typedef {Object} RetryOptions
 * @property {number} [maxRetries=3]
 * @property {number} [baseMs=500]
 * @property {number} [maxMs=10000]
 * @property {(err: unknown, attempt: number) => boolean} [shouldRetry]
 * @property {(err: unknown, attempt: number, delayMs: number) => void} [onRetry]
 */

/** Errores donde reintentar sería tirar requests al vacío. */
const NON_RETRYABLE = [
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  RateLimitError,        // el caller debe esperar retryAfterMs, no reintentar acá
  QuotaExceededError,
  CircuitOpenError,
];

/** @param {unknown} err */
function isNonRetryable(err) {
  return NON_RETRYABLE.some((cls) => err instanceof cls);
}

/**
 * Espera `ms` milisegundos.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta `fn` con reintentos exponenciales. Devuelve el último éxito
 * o propaga el último error si se agotaron los intentos.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {RetryOptions} [options]
 * @returns {Promise<T>}
 */
async function withRetry(fn, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const baseMs = options.baseMs ?? 500;
  const maxMs = options.maxMs ?? 10_000;
  const shouldRetry = options.shouldRetry ?? ((err) => !isNonRetryable(err));

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !shouldRetry(err, attempt)) throw err;

      // exp backoff + jitter (full jitter AWS-style)
      const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const delayMs = Math.floor(Math.random() * exp);

      options.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }
}

module.exports = { withRetry, sleep, isNonRetryable };
