process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

describe('free Studio trial (integration)', { skip }, () => {
  let grant; let normaliseEmail; let entitlementsFor; let Subscription; let TrialClaim;
  before(async () => {
    await mongoose.connect(URI);
    ({ grantTrialIfEligible: grant, normaliseEmail } = await import('../src/services/orgTrial.service.js'));
    ({ entitlementsFor } = await import('../src/services/entitlements.js'));
    ({ Subscription } = await import('../src/models/Subscription.js'));
    ({ TrialClaim } = await import('../src/models/TrialClaim.js'));
  });
  after(async () => { await mongoose.disconnect(); });

  const id = () => new mongoose.Types.ObjectId();
  const req = (ip, fp) => ({ ip, get: (h) => (h.toLowerCase() === 'x-device-fp' ? fp : undefined), headers: {} });
  const person = (email) => ({ _id: id(), email });

  it('normalises Gmail dots and plus tags', () => {
    assert.equal(normaliseEmail('A.b.c+x@Gmail.com'), 'abc@gmail.com');
    assert.equal(normaliseEmail('a+x@school.edu'), 'a@school.edu');
  });

  it('gives Studio for 14 days, then falls back to Free', async () => {
    const org = { _id: id() };
    const r = await grant({ org, user: person(`a${Date.now()}@t.test`), req: req('1.1.1.1', 'fp-a') });
    assert.equal(r.granted, true);
    const ent = await entitlementsFor(org._id);
    assert.equal(ent.planKey, 'studio');
    assert.equal(ent.trial.active, true);
    assert.ok(ent.trial.daysLeft >= 13 && ent.trial.daysLeft <= 14);
    await Subscription.updateOne({ organization: org._id, isTrial: true }, { $set: { trialEndsAt: new Date(Date.now() - 1000) } });
    const after = await entitlementsFor(org._id);
    assert.equal(after.planKey, 'free');
    assert.equal(after.trial, null);
  });

  it('refuses the same email variant, the same device, and a third account from one address', async () => {
    const base = `x${Date.now()}`;
    const first = await grant({ org: { _id: id() }, user: person(`${base}@gmail.com`), req: req('9.9.9.9', 'fp-b') });
    assert.equal(first.granted, true);
    assert.equal((await grant({ org: { _id: id() }, user: person(`${base}+2@gmail.com`), req: req('8.8.8.8', 'fp-c') })).reason, 'email');
    assert.equal((await grant({ org: { _id: id() }, user: person(`other${base}@t.test`), req: req('7.7.7.7', 'fp-b') })).reason, 'device');
    assert.equal((await grant({ org: { _id: id() }, user: person(`p${base}@t.test`), req: req('9.9.9.9', 'fp-d') })).granted, true);
    assert.equal((await grant({ org: { _id: id() }, user: person(`q${base}@t.test`), req: req('9.9.9.9', 'fp-e') })).reason, 'ip');
    await TrialClaim.deleteMany({ emailKey: { $regex: base } });
  });
});
