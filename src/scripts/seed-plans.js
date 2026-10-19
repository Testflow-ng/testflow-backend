import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../config/db.js';
import { PlanDefinition } from '../models/PlanDefinition.js';
import { logger } from '../utils/logger.js';

const proPriceKobo = 700000; // ₦7,000
const studioPriceKobo = 2000000; // ₦20,000

/** The plan catalogue. Prices are in minor units (kobo). */
export const PLAN_SEED = [
  {
    key: 'pro',
    name: 'Pro',
    priceMinor: proPriceKobo,
    currency: 'NGN',
    interval: 'month',
    available: true,
    entitlements: {
      adsEnabled: true,
      maxStudents: null,
      maxActiveExams: null,
      maxExamsPerMonth: null,
      customDomain: false,
      storageMb: null,
      communityEnabled: false,
    },
    sortOrder: 1,
  },
  {
    key: 'studio',
    name: 'Studio',
    priceMinor: studioPriceKobo,
    currency: 'NGN',
    interval: 'month',
    available: true,
    entitlements: {
      adsEnabled: false,
      maxStudents: 500,
      maxActiveExams: 50,
      maxExamsPerMonth: 100,
      customDomain: true,
      storageMb: 500,
      communityEnabled: true,
    },
    sortOrder: 2,
  },
];

/**
 * Idempotent upsert of the plan catalogue. Exported so the seed script and the subscription
 * integration test share one source of truth for prices and entitlements; the caller owns the
 * connection.
 */
export async function seedPlans() {
  for (const p of PLAN_SEED) {
    await PlanDefinition.findOneAndUpdate(
      { key: p.key },
      { $set: p },
      { upsert: true, new: true },
    );
  }
  return PLAN_SEED.length;
}

// Run only when invoked directly (`node src/scripts/seed-plans.js`). Importing this module for
// PLAN_SEED must never connect or write anything.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const run = async () => {
    await connectDB();
    const count = await seedPlans();
    logger.info(`Seeded ${count} plan definitions.`);
    await disconnectDB();
    process.exit(0);
  };
  run().catch(async (error) => {
    logger.error('Plan seed failed', error);
    await disconnectDB().catch(() => {});
    process.exit(1);
  });
}
