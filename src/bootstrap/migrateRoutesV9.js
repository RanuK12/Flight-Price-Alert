"use strict";

const logger = require('../../utils/logger').child('migrateRoutesV9');
const Route = require('../../database/models/Route');

const TARGET_VERSION = 9;

async function runMigration() {
  logger.info('Starting migration V9: add tier=free to all routes');

  const result = await Route.updateMany(
    { tier: { $exists: false } },
    { $set: { tier: 'free' } }
  );

  logger.info('Migration V9 completed', {
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });
  return true;
}

module.exports = { runMigration, TARGET_VERSION };