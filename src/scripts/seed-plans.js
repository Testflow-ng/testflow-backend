import { PlanDefinition } from '../models/PlanDefinition.js';

const proPriceKobo = 700000; // ₦7,000
const studioPriceKobo = 2000000; // ₦20,000

const plans = [
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

async function seed() {
  for (const p of plans) {
    await PlanDefinition.findOneAndUpdate(
      { key: p.key },
      { $set: p },
      { upsert: true, new: true },
    );
    console.log(`Seeded plan: ${p.key} - ${p.name} ($${(p.priceMinor / 100).toFixed(2)} per ${p.interval})`);
  }
  console.log('Done.');
}

seed().catch((e) => { console.error(e); process.exit(1); });