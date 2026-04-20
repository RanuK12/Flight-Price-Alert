/**
 * Clases de error tipadas para distinguir fallos por categoría
 * en callers (retry logic, alertas, fallback a otro provider).
 *
 * @module utils/errors
 */

'use strict';

class AppError extends Error {
  /**
   * @param {string} message
   * @param {{cause?: Error, meta?: Record<string, unknown>}} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    if (options.cause) this.cause = options.cause;
    this.meta = options.meta || {};
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** Credenciales inválidas o no provistas. NO reintentar. */
class AuthenticationError extends AppError {}

/** Request inválido del lado nuestro (400/422). NO reintentar. */
class BadRequestError extends AppError {}

/** Recurso no encontrado (404). NO reintentar. */
class NotFoundError extends AppError {}

/**
 * Rate limit alcanzado (429). Respetar `retryAfterMs` si viene.
 * Los callers deberían bloquear nuevas requests hasta que pase.
 */
class RateLimitError extends AppError {
  /**
   * @param {string} message
   * @param {{retryAfterMs?: number, cause?: Error, meta?: Record<string, unknown>}} [options]
   */
  constructor(message, options = {}) {
    super(message, options);
    this.retryAfterMs = options.retryAfterMs ?? 60_000;
  }
}

/**
 * Cuota mensual del provider agotada. Stop total hasta próximo ciclo.
 */
class QuotaExceededError extends AppError {}

/** Fallo transitorio del upstream (5xx, timeout, network). Reintentable. */
class UpstreamError extends AppError {
  /**
   * @param {string} message
   * @param {{statusCode?: number, cause?: Error, meta?: Record<string, unknown>}} [options]
   */
  constructor(message, options = {}) {
    super(message, options);
    this.statusCode = options.statusCode;
  }
}

/** Circuit breaker abierto — saltar intento hasta que cierre. */
class CircuitOpenError extends AppError {}

/** El provider reconoce la query pero no hay resultados. No es error fatal. */
class NoResultsError extends AppError {}

module.exports = {
  AppError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  RateLimitError,
  QuotaExceededError,
  UpstreamError,
  CircuitOpenError,
  NoResultsError,
};
