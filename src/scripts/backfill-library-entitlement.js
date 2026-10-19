/**
 * Give the `library` entitlement to passes that were bought before it existed.
 *
 *   node src/scripts/backfill-library-entitlement.js --dry-run
 *   node src/scripts/backfill-library-entitlement.js
 *
 * A pass sold before the Library moved behind the Student Pass has `ad_free` and `live_cbt_host`
 * rows but no `library` row, so its holder would find the shelf locked. `ad_free` marks a pass
 * (every pass grants it), so for each live `ad_free` row this creates the matching `library` row
 * with the same expiry, plan and purchase reference. A refund of that purchase then revokes it
 * like any other key, because it carries the same purchase reference.
 *
 * Idempotent by construction: the write is a `$setOnInsert` upsert on `{ user, key }`, so a second
 * run creates nothing. Passes that have lapsed are left alone; renewing gets the current
 * catalogue's keys at checkout.
 */
import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../config/db.js';
import { StudentEntitlement, isEntitlementLive } from '../models/StudentEntitlement.js';
import { logger } from '../utils/logger.js';

export async function backfillLibraryEntitlements({ dryRun = false, now = new Date() } = {}) {
  const stats = { scanned: 0, live: 0, created: 0, existing: 0, lapsed: 0 };

  for (const row of await StudentEntitlement.find({ key: 'ad_free' }).lean()) {
    stats.scanned += 1;
    if (!isEntitlementLive(row, now)) {
      stats.lapsed += 1;
      continue;
    }
    stats.live += 1;

    if (dryRun) {
      if (await StudentEntitlement.exists({ user: row.user, key: 'library' })) stats.existing += 1;
      else stats.created += 1;
      continue;
    }

    try {
      const res = await StudentEntitlement.updateOne(
        { user: row.user, key: 'library' },
        {
          $setOnInsert: {
            active: true,
            source: row.source,
            planKey: row.planKey ?? null,
            purchase: row.purchase ?? null,
            grantedBy: row.grantedBy ?? null,
            startsAt: row.startsAt ?? now,
            expiresAt: row.expiresAt ?? null,
          },
        },
        { upsert: true },
      );
      if (res.upsertedCount) stats.created += 1;
      else stats.existing += 1;
    } catch (error) {
      // A concurrent run inserted it first. Unique on { user, key }, so that is "already done".
      if (error?.code !== 11000) throw error;
      stats.existing += 1;
    }
  }

  return { dryRun, ...stats };
}

// Run only when invoked directly; importing this module must never connect or write.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const dryRun = process.argv.includes('--dry-run');
  await connectDB();
  const result = await backfillLibraryEntitlements({ dryRun });
  logger.info(`Library entitlement backfill: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
  console.log(dryRun ? '\nDRY RUN: nothing was written.' : '\nBackfill applied.');
  await disconnectDB();
}
