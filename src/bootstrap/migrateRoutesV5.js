/**
 * migrateRoutesV5 — Force-upgrade alertMinLevel from 'steal' to 'good'.
 *
 * Context: migrateRoutesV3 attempted this upgrade but was gated by
 * routesMigrationVersion < 3. If the user's document was already at
 * version 3 (from an earlier partial run or manual intervention), the
 * upgrade was skipped silently.
 *
 * This migration uses a direct `updateMany` without checking
 * routesMigrationVersion, ensuring ALL users stuck on 'steal' get
 * upgraded. It's idempotent: if alertMinLevel is already 'good',
 * 'great', or 'all', it does nothing.
 *
 * Why 'good' and not 'great'?
 *   - 'good' (rank 2) captures steal + great + good level offers.
 *   - 'steal' (rank 0) was the old default that caused users to NEVER
 *     receive alerts (the market rarely hits steal-level prices).
 *   - We don't force 'all' because that would spam with every single
 *     price check regardless of level.
 *
 * @module bootstrap/migrateRoutesV5
 */

'use strict';

const User = require('../database/models/User');
const logger = require('../utils/logger').child('migrateV5');

async function runMigration() {
  const result = await User.updateMany(
    { alertMinLevel: 'steal' },
    { $set: { alertMinLevel: 'good' } },
  );

  const affected = result.modifiedCount || 0;
  if (affected > 0) {
    logger.info('alertMinLevel force-upgrade steal→good', { affected });
  } else {
    logger.info('No users with alertMinLevel=steal (already migrated or manual)');
  }

  return { affected };
}

module.exports = { runMigration };
