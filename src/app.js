/**
 * App entry — bot interactivo + health HTTP + crons.
 * Reemplaza `bot.js` / `server/app.js` legacy.
 *
 * @module app
 */

'use strict';

const express = require('express');
const http = require('http');
const https = require('https');
const cron = require('node-cron');

const { config } = require('./config');
const logger = require('./utils/logger').child('app');
const { runMigrations } = require('./database/migrations');
const { seedIfEmpty } = require('./bootstrap/seedDefaultRoutes');
const { startBot } = require('./bot');
const cacheRepo = require('./database/repositories/cacheRepo');
const sessions = require('./bot/sessions');
const { connect: connectMongo } = require('./database/mongoose');

async function main() {
  logger.info('Booting Flight Deal Bot v5.0', {
    env: config.env, port: config.port,
  });

  // 0. MongoDB Atlas (persistencia principal en Render)
  let useMongo = Boolean(config.mongodb.uri);
  if (useMongo) {
    const maskedUri = config.mongodb.uri.replace(/\/\/[^:]+:[^@]+@/, '/***@');
    logger.info('MongoDB URI configured', { uri: maskedUri });
    try {
      await connectMongo();
      logger.info('MongoDB connected (primary storage)');
    } catch (err) {
      logger.error('MongoDB connection failed — falling back to SQLite', /** @type {Error} */(err));
      useMongo = false;
    }
  }

  // 1. Migrations + seed por defecto (solo si no usamos Mongo o como fallback).
  if (!useMongo) {
    await runMigrations();
    await seedIfEmpty().catch((err) => {
      logger.error('seedIfEmpty failed (continuando)', /** @type {Error} */ (err));
    });
  } else {
    // seed si la colección de rutas está vacía
    const Route = require('./database/models/Route');
    const count = await Route.countDocuments();
    if (count === 0) {
      await seedIfEmpty().catch((err) => {
        logger.error('seedIfEmpty failed (continuando)', /** @type {Error} */ (err));
      });
    }
  }

  // 2. Health / debug HTTP
  const app = express();
  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
  app.get('/debug', (_req, res) => res.json({
    env: config.env,
    mongo: useMongo,
    telegram: { hasToken: !!config.telegram.botToken, polling: config.telegram.polling },
    amadeus: { budget: config.amadeus.monthlyBudget },
    uptime: Math.floor(process.uptime()),
  }));
  app.listen(config.port, () => logger.info(`HTTP listening on :${config.port}`));

  // 3. Bot
  startBot();

  // 4. Crons
  if (config.scheduler.autoMonitor) {
    cron.schedule(config.scheduler.monitor, async () => {
      try {
        logger.info('Alert engine tick');
        // eslint-disable-next-line global-require
        const { runOnce } = require('./services/alertEngine');
        await runOnce();
      } catch (err) {
        logger.error('Alert engine cron failed', /** @type {Error} */ (err));
      }
    }, { timezone: config.tz });
    logger.info(`Alert engine cron scheduled: ${config.scheduler.monitor}`);

    cron.schedule(config.scheduler.dailyReport, async () => {
      try {
        logger.info('Daily report cron tick');
        // eslint-disable-next-line global-require
        const { runDaily } = require('./services/dailyReport');
        await runDaily();
      } catch (err) {
        logger.error('Daily report cron failed', /** @type {Error} */ (err));
      }
    }, { timezone: config.tz });
    logger.info(`Daily report cron scheduled: ${config.scheduler.dailyReport}`);

    // Primera pasada del alert engine 30s después del boot (para notificar
    // pronto si hay ofertones vigentes en el seed).
    setTimeout(async () => {
      try {
        logger.info('Primera pasada del alert engine (post-boot)');
        // eslint-disable-next-line global-require
        const { runOnce } = require('./services/alertEngine');
        await runOnce();
      } catch (err) {
        logger.warn('Primera pasada falló (continuando)', { err: /** @type {Error} */ (err).message });
      }
    }, 30 * 1000);
  }

  // Housekeeping (cada hora): cache expirado + sesiones expiradas.
  cron.schedule('0 * * * *', async () => {
    try {
      const [c, s] = await Promise.all([
        cacheRepo.purgeExpired(),
        sessions.purgeExpired(),
      ]);
      logger.info('Housekeeping', { cacheRemoved: c, sessionsRemoved: s });
    } catch (err) {
      logger.error('Housekeeping failed', /** @type {Error} */ (err));
    }
  });

  // 5. Keep-alive self-ping (Render Free duerme a los 15 min de inactividad).
  //    Pingeamos cada 10 min al propio /health. Si no hay URL pública, al
  //    localhost (igualmente mantiene el loop activo).
  const selfUrl = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/health`
    : `http://localhost:${config.port}/health`;
  const pingMs = 10 * 60 * 1000;
  setInterval(() => {
    const agent = selfUrl.startsWith('https') ? https : http;
    const req = agent.get(selfUrl, (res) => res.resume());
    req.on('error', (err) => logger.warn('keep-alive ping failed', { err: err.message }));
    req.setTimeout(5000, () => req.destroy());
  }, pingMs);
  logger.info(`Keep-alive self-ping: ${selfUrl} cada ${pingMs / 60000} min`);

  logger.info('✅ App ready');
}

// Mantener vivo ante errores no capturados (cron + bot no deben caer).
process.on('uncaughtException', (err) => logger.error('uncaughtException', err));
process.on('unhandledRejection', (reason) => logger.error('unhandledRejection', /** @type {any} */ (reason)));

main().catch((err) => {
  logger.error('Fatal boot error', err);
  process.exit(1);
});
