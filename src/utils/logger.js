/**
 * Logger estructurado minimalista. Output JSON en producción,
 * legible en desarrollo. Sin dependencias externas.
 *
 * Uso:
 *   const log = require('../utils/logger').child('amadeus:client');
 *   log.info('Token refreshed', { expiresIn: 1799 });
 *
 * @module utils/logger
 */

'use strict';

/** @typedef {'debug'|'info'|'warn'|'error'} LogLevel */

const LEVELS = /** @type {const} */ (['debug', 'info', 'warn', 'error']);
const LEVEL_PRIORITY = { debug: 10, info: 20, warn: 30, error: 40 };

const rootLevel = /** @type {LogLevel} */ (
  LEVELS.includes(/** @type {any} */ (process.env.LOG_LEVEL))
    ? process.env.LOG_LEVEL
    : 'info'
);

const isProd = process.env.NODE_ENV === 'production';
const minPriority = LEVEL_PRIORITY[rootLevel];

/**
 * @param {LogLevel} level
 * @param {string} scope
 * @param {string} msg
 * @param {Record<string, unknown>} [meta]
 */
function emit(level, scope, msg, meta) {
  if (LEVEL_PRIORITY[level] < minPriority) return;

  const timestamp = new Date().toISOString();
  if (isProd) {
    const payload = { t: timestamp, level, scope, msg, ...(meta || {}) };
    // stdout para info/debug, stderr para warn/error — play nice with log shippers.
    const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(payload) + '\n');
    return;
  }

  // Dev: formato humano
  const color = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' }[level];
  const reset = '\x1b[0m';
  const metaStr = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
  const line = `${color}[${level.toUpperCase()}]${reset} ${timestamp} ${scope} — ${msg}${metaStr}`;
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
}

/**
 * Crea un logger con scope fijo (módulo/archivo).
 * @param {string} scope
 */
function child(scope) {
  return {
    /** @param {string} msg @param {Record<string, unknown>} [meta] */
    debug: (msg, meta) => emit('debug', scope, msg, meta),
    /** @param {string} msg @param {Record<string, unknown>} [meta] */
    info: (msg, meta) => emit('info', scope, msg, meta),
    /** @param {string} msg @param {Record<string, unknown>} [meta] */
    warn: (msg, meta) => emit('warn', scope, msg, meta),
    /** @param {string} msg @param {Record<string, unknown>|Error} [metaOrErr] */
    error: (msg, metaOrErr) => {
      if (metaOrErr instanceof Error) {
        emit('error', scope, msg, {
          error: metaOrErr.message,
          stack: metaOrErr.stack,
          name: metaOrErr.name,
        });
      } else {
        emit('error', scope, msg, metaOrErr);
      }
    },
  };
}

module.exports = {
  child,
  root: child('app'),
};
