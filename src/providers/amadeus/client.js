/**
 * Amadeus HTTP client — OAuth2 client credentials + axios con interceptors.
 * Encapsula: obtención y refresh de token, enrutamiento de errores a
 * clases tipadas, integración con el rate limiter y el budget mensual.
 *
 * No expone endpoints específicos — eso lo hacen los módulos hermanos
 * (flightOffers, flightPriceConfirm, inspirationSearch) que usan
 * `client.request()`.
 *
 * @module providers/amadeus/client
 */

'use strict';

const axios = require('axios');

const { config } = require('../../config');
const {
  AMADEUS_ENDPOINTS,
  AMADEUS_LIMITS,
  AMADEUS_NON_RETRYABLE,
} = require('../../config/constants');
const {
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  RateLimitError,
  QuotaExceededError,
  UpstreamError,
} = require('../../utils/errors');
const { withRetry } = require('../../utils/retry');
const logger = require('../../utils/logger').child('amadeus:client');
const { AmadeusRateLimiter } = require('./rateLimiter');

/**
 * Singleton ligero. Exportamos `getClient()` en vez de instancia suelta
 * para poder reemplazar en tests.
 */
let _instance = null;

/** Devuelve el cliente singleton. */
function getClient() {
  if (!_instance) _instance = new AmadeusClient();
  return _instance;
}

class AmadeusClient {
  constructor() {
    this.baseUrl = config.amadeus.baseUrl;
    this.apiKey = config.amadeus.apiKey;
    this.apiSecret = config.amadeus.apiSecret;

    this.limiter = new AmadeusRateLimiter({
      rps: config.amadeus.rateLimitRps || AMADEUS_LIMITS.DEFAULT_RPS,
      burst: AMADEUS_LIMITS.BURST_CAPACITY,
    });

    /** @type {string|null} */
    this.accessToken = null;
    /** @type {number|null} */
    this.tokenExpiryMs = null;

    /** Deduplica peticiones concurrentes de token. */
    /** @type {Promise<string>|null} */
    this._tokenInFlight = null;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: AMADEUS_LIMITS.DEFAULT_TIMEOUT_MS,
    });
  }

  /**
   * Obtiene un bearer token válido. Reutiliza el cacheado hasta el margen
   * de expiración; si varias llamadas lo requieren simultáneamente,
   * esperan la misma promesa (sin duplicar llamadas a /oauth2/token).
   *
   * @returns {Promise<string>}
   */
  async getToken() {
    const now = Date.now();
    if (this.accessToken && this.tokenExpiryMs && now < this.tokenExpiryMs) {
      return this.accessToken;
    }
    if (this._tokenInFlight) return this._tokenInFlight;

    this._tokenInFlight = (async () => {
      try {
        logger.debug('Requesting OAuth token');
        const response = await this.http.post(
          AMADEUS_ENDPOINTS.TOKEN,
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.apiKey,
            client_secret: this.apiSecret,
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        );

        const { access_token: token, expires_in: expiresIn } = response.data;
        if (!token) {
          throw new AuthenticationError('Amadeus token response missing access_token');
        }

        this.accessToken = token;
        this.tokenExpiryMs =
          Date.now() + Math.max(60, expiresIn - AMADEUS_LIMITS.TOKEN_REFRESH_MARGIN_S) * 1000;

        logger.info('Amadeus token acquired', { expiresIn });
        return token;
      } catch (err) {
        const mapped = mapAxiosError(err);
        logger.error('Failed to acquire Amadeus token', mapped);
        throw mapped;
      } finally {
        this._tokenInFlight = null;
      }
    })();

    return this._tokenInFlight;
  }

  /**
   * Invalida el token cacheado (p. ej. tras 401).
   */
  invalidateToken() {
    this.accessToken = null;
    this.tokenExpiryMs = null;
  }

  /**
   * Ejecuta una petición autenticada con:
   *  - rate limiting (token bucket)
   *  - retry automático para 5xx/timeouts
   *  - refresh y 1 reintento ante 401
   *  - mapeo de errores a clases tipadas
   *
   * @template T
   * @param {import('axios').AxiosRequestConfig} cfg
   * @returns {Promise<T>}
   */
  async request(cfg) {
    const doCall = async () => {
      await this.limiter.acquire();

      const token = await this.getToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(cfg.headers || {}),
      };

      try {
        const response = await this.http.request({ ...cfg, headers });
        this.limiter.recordSuccess();
        return /** @type {T} */ (response.data);
      } catch (err) {
        const mapped = mapAxiosError(err);

        // 401: intentar refresh una vez antes de propagar
        if (mapped instanceof AuthenticationError) {
          logger.warn('Got 401, invalidating token and retrying once');
          this.invalidateToken();
          const fresh = await this.getToken();
          try {
            const response = await this.http.request({
              ...cfg,
              headers: { ...headers, Authorization: `Bearer ${fresh}` },
            });
            this.limiter.recordSuccess();
            return /** @type {T} */ (response.data);
          } catch (err2) {
            throw mapAxiosError(err2);
          }
        }

        if (mapped instanceof RateLimitError) {
          this.limiter.recordRateLimit(mapped.retryAfterMs);
        } else if (mapped instanceof UpstreamError) {
          this.limiter.recordFailure();
        }

        throw mapped;
      }
    };

    return withRetry(doCall, {
      maxRetries: AMADEUS_LIMITS.MAX_RETRIES,
      baseMs: AMADEUS_LIMITS.RETRY_BASE_MS,
      maxMs: AMADEUS_LIMITS.RETRY_MAX_MS,
      onRetry: (err, attempt, delayMs) => {
        logger.warn('Retrying Amadeus request', {
          attempt,
          delayMs,
          error: /** @type {Error} */ (err).message,
        });
      },
    });
  }

  /** Snapshot del estado del cliente (tokens, breaker). */
  stats() {
    return {
      hasToken: Boolean(this.accessToken),
      tokenExpiresInMs: this.tokenExpiryMs ? Math.max(0, this.tokenExpiryMs - Date.now()) : 0,
      limiter: this.limiter.stats(),
    };
  }
}

/**
 * Convierte un AxiosError a una clase de error tipada del dominio.
 * @param {unknown} err
 * @returns {Error}
 */
function mapAxiosError(err) {
  if (!axios.isAxiosError(err)) {
    return err instanceof Error ? err : new Error(String(err));
  }

  const status = err.response?.status;
  const data = /** @type {Record<string, unknown>} */ (err.response?.data || {});
  // Amadeus devuelve { errors: [{ code, title, detail, status }] }
  const errors = /** @type {Array<Record<string, unknown>>} */ (
    Array.isArray(data.errors) ? data.errors : []
  );
  const firstError = errors[0] || {};
  const detail =
    /** @type {string|undefined} */ (firstError.detail) ||
    /** @type {string|undefined} */ (firstError.title) ||
    err.message;
  const meta = { status, amadeusErrors: errors, url: err.config?.url };

  // Timeout / network: siempre retryable
  if (!err.response) {
    return new UpstreamError(`Amadeus network error: ${err.message}`, {
      cause: err,
      meta,
    });
  }

  if (status === 401) return new AuthenticationError(`Amadeus 401: ${detail}`, { cause: err, meta });
  if (status === 403) {
    // 403 a veces indica quota exceeded en Amadeus
    const isQuota = /quota|limit/i.test(String(detail));
    return isQuota
      ? new QuotaExceededError(`Amadeus quota exceeded: ${detail}`, { cause: err, meta })
      : new AuthenticationError(`Amadeus 403: ${detail}`, { cause: err, meta });
  }
  if (status === 404) return new NotFoundError(`Amadeus 404: ${detail}`, { cause: err, meta });
  if (status === 429) {
    const retryAfter = Number(err.response.headers?.['retry-after']);
    return new RateLimitError(`Amadeus 429: ${detail}`, {
      cause: err,
      meta,
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 60_000,
    });
  }
  if (status && AMADEUS_NON_RETRYABLE.has(status)) {
    return new BadRequestError(`Amadeus ${status}: ${detail}`, { cause: err, meta });
  }
  // 5xx y desconocidos: upstream retryable
  return new UpstreamError(`Amadeus ${status || 'unknown'}: ${detail}`, {
    cause: err,
    meta,
    statusCode: status,
  });
}

module.exports = { getClient, AmadeusClient, mapAxiosError };
