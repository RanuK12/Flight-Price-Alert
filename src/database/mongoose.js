/**
 * Conexión MongoDB Atlas + graceful shutdown.
 *
 * @module database/mongoose
 */

'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger').child('db');
const { config } = require('../config');

const MONGODB_URI = process.env.MONGODB_URI || '';

/**
 * Conecta a MongoDB Atlas.
 * @returns {Promise<typeof mongoose>}
 */
async function connect() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI no está configurado en las variables de entorno.');
  }
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  await mongoose.connect(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  const dbName = mongoose.connection.name || 'unknown';
  logger.info('MongoDB connected', { db: dbName });
  return mongoose;
}

/**
 * Cierra la conexión limpiamente.
 * @returns {Promise<void>}
 */
async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await disconnect();
  process.exit(0);
});

module.exports = { connect, disconnect, mongoose };
