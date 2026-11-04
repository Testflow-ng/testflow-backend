/**
 * Plan checkout: upgrade, renew, verify and the provider webhook.
 *
 * Run only when MONGODB_URI_TEST points at a DISPOSABLE database (it is dropped at the end).
 *
 * The rules this file protects:
 *  - An upgrade charges only the prorated difference; a downgrade is scheduled and charges nothing.
 *  - A price comes from the plan catalogue, never the request.
 *  - A plan only activates after the provider confirms it, and re-verifying does not extend it twice.
 *  - The webhook is signature-checked over the exact bytes and checks the amount before activating.
 */
process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_subscription_secret';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

describe('Everybody step 3 — plan checkout and renewals (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;
  let fakeState;

  const client = () => {
    const jar = {};
    const call = async (method, path, { body, headers } = {}) => {
      n += 1;
      const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.6.${n % 250}.${Math.floor(n / 250)}`, ...headers };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.Cookie = cookie;
      if (jar.tf_csrf) h['X-CSRF-Token'] = jar.tf_csrf;
      const res = await fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (!value || /expires=Thu, 01 Jan 1970/i.test(c)) delete jar[name]; else jar[name] = value;
      }
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null };
    };
    return { call, jar };
  };

  const registerLogin = async () => {
    const c = client();
    const email = `o${uniq()}@t.test`;
    await c.call('POST', '/api/auth/register', { body: { fullName: 'Org Owner', email, password: pw, confirmPassword: pw } });
    await c.call('POST', '/api/auth/login', { body: { email, password: pw } });
    return { c, email };
  };

  const mkOrg = async (c) => {
    const created = await c.call('POST', '/api/v1/everybody/organizations', { body: { name: `Academy ${uniq()}` } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    return created.json.organization.id;
  };

  const currentSub = async (c, orgId) => {
    const res = await c.call('GET', `/api/v1/everybody/subscription?organizationId=${orgId}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.subscription;
  };

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = { mongoose };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));
    const { seedPlans } = await import('../src/scripts/seed-plans.js');
    await seedPlans();
    fakeState = { amounts: new Map() };
    const { setOrgPaystackForTests } = await import('../src/services/orgPaystack.service.js');
    setOrgPaystackForTests({
      initialize: async ({ reference, amountKobo }) => {
        fakeState.amounts.set(reference, amountKobo);
        return { authorizationUrl: `https://pay.test/${reference}` };
      },
      verify: async (reference) => ({
        status: 'success',
        amountKobo: fakeState.amounts.get(reference) ?? 0,
        currency: 'NGN',
        transactionId: `tx_${reference}`,
        paidAt: new Date(),
      }),
      refund: async () => ({ refundId: 'ref_test', status: 'processed' }),
      verifyWebhookSignature: () => true,
      parseWebhook: (body) => ({ type: body?.event, reference: body?.data?.reference, eventId: null, refundReference: null }),
    });
    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  });

  it('an upgrade starts a checkout priced from the catalogue, and verifying activates the plan', async () => {
    const { c } = await registerLogin();
    const orgId = await mkOrg(c);
    const free = await currentSub(c, orgId);
    assert.equal(free.planKey, 'free');

    const upgrade = await c.call('POST', `/api/v1/everybody/subscriptions/${free.id}/upgrade`, {
      body: { planKey: 'pro' },
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    assert.equal(upgrade.status, 201, JSON.stringify(upgrade.json));
    assert.ok(upgrade.json.reference);
    assert.ok(upgrade.json.authorizationUrl);
    assert.ok(upgrade.json.amountKobo > 0);

    const verify = await c.call('GET', `/api/v1/everybody/payments/verify?reference=${upgrade.json.reference}`);
    assert.equal(verify.status, 200, JSON.stringify(verify.json));
    assert.equal(verify.json.status, 'paid', JSON.stringify(verify.json));
    assert.equal(verify.json.subscription.planKey, 'pro', JSON.stringify(verify.json));
    assert.equal(verify.json.subscription.status, 'active', JSON.stringify(verify.json));
    assert.equal(verify.json.entitlements.questionBanks, true, JSON.stringify(verify.json));
    assert.equal(verify.json.entitlements.paidExams, false, JSON.stringify(verify.json));

    // Re-verifying is a duplicate and does not change anything.
    const again = await c.call('GET', `/api/v1/everybody/payments/verify?reference=${upgrade.json.reference}`);
    assert.equal(again.json.status, 'paid');
    assert.equal(again.json.duplicate, true);
  });

  it('a downgrade is scheduled for the period end and charges nothing', async () => {
    const { c } = await registerLogin();
    const orgId = await mkOrg(c);
    const free = await currentSub(c, orgId);

    const toStudio = await c.call('POST', `/api/v1/everybody/subscriptions/${free.id}/upgrade`, { body: { planKey: 'studio' } });
    await c.call('GET', `/api/v1/everybody/payments/verify?reference=${toStudio.json.reference}`);
    const studio = await currentSub(c, orgId);
    assert.equal(studio.planKey, 'studio');

    const down = await c.call('POST', `/api/v1/everybody/subscriptions/${studio.id}/upgrade`, { body: { planKey: 'pro' } });
    assert.equal(down.status, 200);
    assert.deepEqual(down.json, {});

    const after = await currentSub(c, orgId);
    assert.equal(after.planKey, 'studio');
    assert.equal(after.pendingPlanKey, 'pro');
  });

  it('Free has nothing to renew', async () => {
    const { c } = await registerLogin();
    const orgId = await mkOrg(c);
    const free = await currentSub(c, orgId);
    const renew = await c.call('POST', `/api/v1/everybody/subscriptions/${free.id}/renew`, { body: {} });
    assert.equal(renew.status, 422);
    assert.equal(renew.json.error.code, 'PLAN_UNAVAILABLE');
  });

  it('the webhook verifies its signature and settles the plan once', async () => {
    const { c } = await registerLogin();
    const orgId = await mkOrg(c);
    const free = await currentSub(c, orgId);
    const upgrade = await c.call('POST', `/api/v1/everybody/subscriptions/${free.id}/upgrade`, { body: { planKey: 'studio' } });
    assert.equal(upgrade.status, 201, JSON.stringify(upgrade.json));

    const payload = JSON.stringify({
      event: 'charge.success',
      data: { reference: upgrade.json.reference, amount: upgrade.json.amountKobo, currency: 'NGN' },
    });
    const sign = (body) => crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(body).digest('hex');

    const bad = await fetch(`${base}/api/v1/everybody/subscriptions/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'nope' },
      body: payload,
    });
    assert.equal(bad.status, 401);

    const ok = await fetch(`${base}/api/v1/everybody/subscriptions/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sign(payload) },
      body: payload,
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).status, 'paid');

    const after = await currentSub(c, orgId);
    assert.equal(after.planKey, 'studio');
    assert.equal(after.status, 'active');

    const duplicate = await fetch(`${base}/api/v1/everybody/subscriptions/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sign(payload) },
      body: payload,
    });
    assert.equal((await duplicate.json()).duplicate, true);
  });

  it('a downgrade applies at the period end and unpublishes exams the new plan forbids', async () => {
    const { c } = await registerLogin();
    const orgId = await mkOrg(c);
    const free = await currentSub(c, orgId);
    const toStudio = await c.call('POST', `/api/v1/everybody/subscriptions/${free.id}/upgrade`, { body: { planKey: 'studio' } });
    await c.call('GET', `/api/v1/everybody/payments/verify?reference=${toStudio.json.reference}`);
    const studio = await currentSub(c, orgId);
    assert.equal(studio.planKey, 'studio');

    // A payout account so a priced exam may be published.
    const { Organization } = await import('../src/models/Organization.js');
    await Organization.updateOne(
      { _id: orgId },
      { $set: { 'payout.status': 'active', 'payout.subaccountCode': 'ACCT_test', 'payout.accountName': 'Test Org' } },
    );

    const publishWithQuestion = async (body, stem) => {
      const exam = await c.call('POST', `/api/v1/everybody/organizations/${orgId}/exams`, { body });
      assert.equal(exam.status, 201, JSON.stringify(exam.json));
      await c.call('POST', `/api/v1/everybody/organizations/${orgId}/questions`, {
        body: { stem, options: ['a', 'b'], correctIndex: 0, examId: exam.json.exam.id },
      });
      const published = await c.call('POST', `/api/v1/everybody/organizations/${orgId}/exams/${exam.json.exam.id}/publish`);
      assert.equal(published.status, 200, JSON.stringify(published.json));
      return exam.json.exam.id;
    };

    const liveId = await publishWithQuestion(
      { title: 'Scheduled live', durationMinutes: 30, mode: 'live', startsAt: new Date(Date.now() + 3_600_000).toISOString() },
      'Live question?',
    );
    const paidId = await publishWithQuestion({ title: 'Paid paper', durationMinutes: 20, priceMinor: 20_000 }, 'Paid question?');

    // Schedule the downgrade and let its period end pass.
    const { Subscription } = await import('../src/models/Subscription.js');
    await Subscription.updateOne(
      { _id: studio.id },
      { $set: { pendingPlanKey: 'pro', currentPeriodEnd: new Date(Date.now() - 1_000) } },
    );
    const { applyScheduledDowngrades, enforcePlanForOrgs } = await import('../src/services/orgSubscription.service.js');
    const touched = await applyScheduledDowngrades();
    assert.ok(touched.includes(String(orgId)));
    assert.equal((await currentSub(c, orgId)).planKey, 'pro');

    const enforced = await enforcePlanForOrgs([orgId]);
    assert.equal(enforced.liveUnpublished, 1);
    assert.equal(enforced.paidUnpublished, 1);

    const liveNow = await c.call('GET', `/api/v1/everybody/organizations/${orgId}/exams/${liveId}`);
    assert.equal(liveNow.json.exam.status, 'draft');
    const paidNow = await c.call('GET', `/api/v1/everybody/organizations/${orgId}/exams/${paidId}`);
    assert.equal(paidNow.json.exam.status, 'draft');
  });
});
