/**
 * Config loader — lee `process.env`, valida tipos/presencia y expone
 * un objeto inmutable tipado. Falla temprano si falta algo crítico.
 *
 * Uso:
 *   const { config } = require('./config');
 *   config.amadeus.apiKey
 *
 * @module config
 */

'use strict';

require('dotenv').config();

/**
 * @typedef {Object} AmadeusConfig
 * @property {string} apiKey
 * @property {string} apiSecret
 * @property {string} baseUrl
 * @property {number} rateLimitRps
 * @property {number} monthlyBudget
 * @property {number} dailyBudget
 * @property {boolean} confirmStealsWithAmadeus
 */

/**
 * @typedef {Object} TelegramConfig
 * @property {string} botToken
 * @property {string[]} chatIds
 * @property {boolean} polling
 */

/**
 * @typedef {Object} AppConfig
 * @property {'development'|'production'|'test'} env
 * @property {number} port
 * @property {'debug'|'info'|'warn'|'error'} logLevel
 * @property {string} tz
 * @property {TelegramConfig} telegram
 * @property {AmadeusConfig} amadeus
 * @property {{monitor:string, dailyReport:string, autoMonitor:boolean}} scheduler
 * @property {{amadeusTtlMs:number, gfTtlMs:number}} cache
 * @property {{puppeteerExecutablePath:string, sqlitePath:string}} paths
 */

/**
 * Lee una var de entorno requerida. Lanza si falta.
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`[config] Missing required env var: ${name}`);
  }
  return String(value).trim();
}

/**
 * Lee una var opcional con valor por defecto.
 * @param {string} name
 * @param {string} defaultValue
 * @returns {string}
 */
function optionalEnv(name, defaultValue) {
  const value = process.env[name];
  return value === undefined || value === '' ? defaultValue : String(value).trim();
}

/**
 * Convierte una string a entero validando.
 * @param {string} raw
 * @param {string} name
 * @returns {number}
 */
function parseInteger(raw, name) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`[config] Invalid integer for ${name}: "${raw}"`);
  }
  return n;
}

/**
 * Convierte una string a booleano ("true"/"false"/"1"/"0").
 * @param {string} raw
 * @returns {boolean}
 */
function parseBool(raw) {
  const v = String(raw).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * Parsea una lista de chat IDs separados por coma.
 * @param {string} raw
 * @returns {string[]}
 */
function parseChatIds(raw) {
  return String(raw)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/** @type {AppConfig} */
const config = Object.freeze({
  env: /** @type {'development'|'production'|'test'} */ (
    optionalEnv('NODE_ENV', 'development')
  ),
  port: parseInteger(optionalEnv('PORT', '4000'), 'PORT'),
  logLevel: /** @type {'debug'|'info'|'warn'|'error'} */ (
    optionalEnv('LOG_LEVEL', 'info')
  ),
  tz: optionalEnv('TZ', 'America/Argentina/Buenos_Aires'),

  telegram: Object.freeze({
    botToken: optionalEnv('TELEGRAM_BOT_TOKEN', ''),
    chatIds: parseChatIds(optionalEnv('TELEGRAM_CHAT_ID', '')),
    polling: parseBool(optionalEnv('TELEGRAM_POLLING', 'true')),
  }),

  amadeus: Object.freeze({
    apiKey: requireEnv('AMADEUS_API_KEY'),
    apiSecret: requireEnv('AMADEUS_API_SECRET'),
    baseUrl: optionalEnv('AMADEUS_BASE_URL', 'https://api.amadeus.com').replace(/\/$/, ''),
    rateLimitRps: parseInteger(optionalEnv('AMADEUS_RATE_LIMIT_RPS', '8'), 'AMADEUS_RATE_LIMIT_RPS'),
    monthlyBudget: parseInteger(optionalEnv('AMADEUS_MONTHLY_BUDGET', '2000'), 'AMADEUS_MONTHLY_BUDGET'),
    // Tope diario para no quemar el mes en 2 días. Default = monthly/30.
    dailyBudget: parseInteger(
      optionalEnv('AMADEUS_DAILY_BUDGET',
        String(Math.max(20, Math.floor(
          parseInteger(optionalEnv('AMADEUS_MONTHLY_BUDGET', '2000'), 'AMADEUS_MONTHLY_BUDGET') / 30,
        )))),
      'AMADEUS_DAILY_BUDGET',
    ),
    // Si true, cuando el scraper encuentra un steal, se confirma con
    // Amadeus pricing para obtener precio exacto y booking URL oficial.
    // Cuesta 1 call Amadeus extra por ofertón. Default false para ahorrar.
    confirmStealsWithAmadeus: parseBool(optionalEnv('AMADEUS_CONFIRM_STEALS', 'false')),
  }),

  scheduler: Object.freeze({
    monitor: optionalEnv('MONITOR_SCHEDULE', '0 */2 * * *'),
    dailyReport: optionalEnv('DAILY_REPORT_SCHEDULE', '0 21 * * *'),
    autoMonitor: parseBool(optionalEnv('AUTO_MONITOR', 'true')),
  }),

  cache: Object.freeze({
    amadeusTtlMs: parseInteger(optionalEnv('CACHE_TTL_MS', '21600000'), 'CACHE_TTL_MS'),
    gfTtlMs: parseInteger(optionalEnv('CACHE_TTL_GF_MS', '3600000'), 'CACHE_TTL_GF_MS'),
  }),

  paths: Object.freeze({
    puppeteerExecutablePath: optionalEnv('PUPPETEER_EXECUTABLE_PATH', ''),
    sqlitePath: optionalEnv('SQLITE_PATH', './data/flights.db'),
  }),
});

/**
 * Imprime un resumen saneado del config (sin secretos).
 * Útil para loguear en boot.
 * @returns {Record<string, unknown>}
 */
function summary() {
  return {
    env: config.env,
    port: config.port,
    logLevel: config.logLevel,
    tz: config.tz,
    telegram: {
      hasToken: Boolean(config.telegram.botToken),
      chatIdsCount: config.telegram.chatIds.length,
      polling: config.telegram.polling,
    },
    amadeus: {
      baseUrl: config.amadeus.baseUrl,
      rateLimitRps: config.amadeus.rateLimitRps,
      monthlyBudget: config.amadeus.monthlyBudget,
      dailyBudget: config.amadeus.dailyBudget,
      confirmStealsWithAmadeus: config.amadeus.confirmStealsWithAmadeus,
      hasCredentials: Boolean(config.amadeus.apiKey && config.amadeus.apiSecret),
    },
    scheduler: config.scheduler,
    cache: config.cache,
  };
}

module.exports = { config, summary };
