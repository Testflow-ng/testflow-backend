/** Regression: paid, invoice successful, but the plan still showed Free. Needs MONGODB_URI_TEST. */
process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

describe('paid but showing Free (integration)', { skip }, () => {
  let PlanDefinition; let Subscription; let SubscriptionPayment; let entitlementsFor; let ensureFreeSubscription;
  before(async () => {
    await mongoose.connect(URI);
    ({ Subscription } = await import('../src/models/Subscription.js'));
    ({ SubscriptionPayment } = await import('../src/models/SubscriptionPayment.js'));
    ({ PlanDefinition } = await import('../src/models/PlanDefinition.js'));
    await PlanDefinition.updateOne({ key: 'pro' }, { $setOnInsert: { key: 'pro', name: 'Pro', priceMinor: 500000, currency: 'NGN', available: true, entitlements: {} } }, { upsert: true });
    ({ entitlementsFor, ensureFreeSubscription } = await import('../src/services/entitlements.js'));
  });
  after(async () => { await mongoose.disconnect(); });

  const newOrgId = () => new mongoose.Types.ObjectId();

  it('a paid payment whose subscription never activated is repaired on the next read', async () => {
    const org = newOrgId();
    const free = await ensureFreeSubscription(org);
    await SubscriptionPayment.create({
      organization: org, subscription: free._id, planKey: 'pro', kind: 'upgrade',
      reference: `SUB-T${Date.now()}`, amountKobo: 500000, currency: 'NGN', status: 'paid', paidAt: new Date(),
    });
    const ent = await entitlementsFor(org);
    assert.equal(ent.planKey, 'pro');
    const again = await entitlementsFor(org);
    assert.equal(again.planKey, 'pro');
  });

  it('a newer Free row never outranks an active paid plan', async () => {
    const org = newOrgId();
    await Subscription.create({ organization: org, planKey: 'studio', status: 'active', planSnapshot: { priceMinor: 1, currency: 'NGN', entitlements: {} }, provider: 'paystack' });
    await Subscription.create({ organization: org, planKey: 'free', status: 'active', planSnapshot: { priceMinor: 0, currency: 'NGN', entitlements: {} }, provider: 'none' });
    assert.equal((await entitlementsFor(org)).planKey, 'studio');
  });
});
