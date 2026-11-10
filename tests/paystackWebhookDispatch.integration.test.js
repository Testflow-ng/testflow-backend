/**
 * Central Paystack webhook dispatch (/api/webhooks/paystack).
 * Covers student (TFS-*) and org (SUB-*) routing, invalid signature, duplicate
 * delivery, unknown references, and payment failures. Uses disposable test DB
 * and mocked Paystack provider only; no live credentials.
 */
process.env.NODE_ENV = 'test';
process.env.TRIAL_DISABLED = 'true';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';
process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_dispatch_integration_only';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

const sign = (raw) => crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');

describe('Central Paystack webhook dispatch (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;
  let fakeState;

  const client = () => {
    const jar = {};
    const call = async (method, path, { body, headers } = {}) => {
      n += 1;
      const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${n % 250}.${Math.floor(n / 250)}`, ...headers };
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
      return { status: res.status, json: text ? JSON.parse(text) : null, text };
    };
    return { call };
  };

  const postWebhook = async (body, signature = sign(JSON.stringify(body))) => {
    const raw = JSON.stringify(body);
    const res = await fetch(`${base}/api/webhooks/paystack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
      body: raw,
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, text };
  };

  const registerLogin = async () => {
    const c = client();
    const email = `o${uniq()}@t.test`;
    await c.call('POST', '/api/auth/register', { body: { fullName: 'Dispatch Tester', email, password: pw, confirmPassword: pw } });
    await c.call('POST', '/api/auth/login', { body: { email, password: pw } });
    const user = await m.User.findOne({ email }).lean();
    return { c, email, userId: user._id };
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
    m = {
      mongoose,
      User: (await import('../src/models/User.js')).User,
      StudentEntitlement: (await import('../src/models/StudentEntitlement.js')).StudentEntitlement,
      StudentPurchase: (await import('../src/models/StudentPurchase.js')).StudentPurchase,
    };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));
    const { seedPlans } = await import('../src/scripts/seed-plans.js');
    await seedPlans();

    fakeState = { org: new Map(), student: new Map() };
    const { setOrgPaystackForTests } = await import('../src/services/orgPaystack.service.js');
    setOrgPaystackForTests({
      initialize: async ({ reference, amountKobo, channels }) => {
        fakeState.org.set(reference, { amountKobo, channels, status: 'success' });
        return Array.isArray(channels) && channels.includes('bank_transfer')
          ? { reference, authorizationUrl: null, transferInstructions: { bankName: 'Test Bank', accountName: 'TF', accountNumber: '0001112223', amountKobo, currency: 'NGN', channel: 'bank_transfer' } }
          : { reference, authorizationUrl: `https://pay.test/${reference}` };
      },
      verify: async (reference) => ({ status: fakeState.org.get(reference)?.status ?? 'success', amountKobo: fakeState.org.get(reference)?.amountKobo ?? 0, currency: 'NGN', transactionId: `tx_${reference}`, paidAt: new Date() }),
      fetch: async (reference) => ({ status: fakeState.org.get(reference)?.status ?? 'success', amountKobo: fakeState.org.get(reference)?.amountKobo ?? 0, currency: 'NGN', transactionId: `tx_${reference}`, paidAt: new Date() }),
      refund: async () => ({ refundId: 'ref_test', status: 'processed' }),
      verifyWebhookSignature: (raw, sig) => sig === sign(raw),
      parseWebhook: (body) => ({ type: body?.event, reference: body?.data?.reference, eventId: body?.data?.id ? String(body.data.id) : null }),
    });

    const { setProviderForTests } = await import('../src/services/ads/payment/index.js');
    setProviderForTests({
      name: 'paystack',
      initialize: async ({ reference, amountKobo, channels }) => {
        fakeState.student.set(reference, { amountKobo, channels, status: 'success' });
        return Array.isArray(channels) && channels.includes('bank_transfer')
          ? { reference, authorizationUrl: null, transferInstructions: { bankName: 'Test Bank', accountName: 'TF Student', accountNumber: '9998887776', amountKobo, currency: 'NGN', channel: 'bank_transfer' } }
          : { reference, authorizationUrl: `https://pay.test/${reference}` };
      },
      verify: async (reference) => ({ status: fakeState.student.get(reference)?.status ?? 'success', amountKobo: fakeState.student.get(reference)?.amountKobo ?? 0, currency: 'NGN', transactionId: `tx_${reference}`, paidAt: new Date() }),
      fetch: async (reference) => ({ status: fakeState.student.get(reference)?.status ?? 'success', amountKobo: fakeState.student.get(reference)?.amountKobo ?? 0, currency: 'NGN', transactionId: `tx_${reference}`, paidAt: new Date() }),
      refund: async () => ({ refundId: 'ref_test', status: 'processed' }),
      verifyWebhookSignature: (raw, sig) => sig === sign(raw),
      parseWebhook: (body) => (body?.event && body?.data?.reference ? { type: body.event, reference: body.data.reference } : null),
    });

    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (m?.mongoose) { await m.mongoose.connection.dropDatabase(); await m.mongoose.disconnect(); }
  });

  it('dispatches SUB-* to org subscription settlement', async () => {
    const { c } = await registerLogin();
    const orgId = await mkOrg(c);
    const sub = await currentSub(c, orgId);
    const upgrade = await c.call('POST', `/api/v1/everybody/subscriptions/${sub.id}/upgrade`, { body: { planKey: 'pro' } });
    assert.equal(upgrade.status, 201, JSON.stringify(upgrade.json));
    const payload = { event: 'charge.success', data: { id: 1001, reference: upgrade.json.reference, amount: upgrade.json.amountKobo, currency: 'NGN' } };
    const res = await postWebhook(payload);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.source, 'org_subscription');
    assert.equal(res.json.status, 'paid');
    const after = await currentSub(c, orgId);
    assert.equal(after.planKey, 'pro');
  });

  it('dispatches TFS-* to student purchase settlement', async () => {
    const { c, userId } = await registerLogin();
    const checkout = await c.call('POST', '/api/billing/ad-free/checkout', { body: { planKey: 'pass_30d' } });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
    const ref = checkout.json.purchase.reference;
    const amount = checkout.json.purchase.amountKobo;
    const payload = { event: 'charge.success', data: { id: 2001, reference: ref, amount, currency: 'NGN' } };
    const res = await postWebhook(payload);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.source, 'student_subscription');
    assert.equal(res.json.applied, true);
    const ent = await m.StudentEntitlement.findOne({ user: userId, key: 'ad_free' }).lean();
    assert.equal(Boolean(ent && (!ent.expiresAt || new Date(ent.expiresAt) > new Date()) && ent.active !== false), true);
  });

  it('rejects invalid signatures', async () => {
    const res = await postWebhook({ event: 'charge.success', data: { reference: 'SUB-DEADBE', amount: 1, currency: 'NGN' } }, 'bad-signature');
    assert.equal(res.status, 401, JSON.stringify(res.json));
  });

  it('handles duplicate events idempotently', async () => {
    const { c } = await registerLogin();
    const orgId = await mkOrg(c);
    const sub = await currentSub(c, orgId);
    const upgrade = await c.call('POST', `/api/v1/everybody/subscriptions/${sub.id}/upgrade`, { body: { planKey: 'studio' } });
    const payload = { event: 'charge.success', data: { id: 3001, reference: upgrade.json.reference, amount: upgrade.json.amountKobo, currency: 'NGN' } };
    const first = await postWebhook(payload);
    assert.equal(first.json.status, 'paid');
    const second = await postWebhook(payload);
    assert.equal(second.status, 200);
    assert.equal(second.json.duplicate, true);
  });

  it('safely ignores unknown references', async () => {
    const res = await postWebhook({ event: 'charge.success', data: { reference: 'UNKNOWN-REF-123', amount: 1, currency: 'NGN' } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.ignored, true);
  });

  it('does not acknowledge failed settlement as success activation', async () => {
    const { c } = await registerLogin();
    const orgId = await mkOrg(c);
    const sub = await currentSub(c, orgId);
    const upgrade = await c.call('POST', `/api/v1/everybody/subscriptions/${sub.id}/upgrade`, { body: { planKey: 'pro' } });
    const payload = { event: 'charge.failed', data: { id: 4001, reference: upgrade.json.reference, amount: upgrade.json.amountKobo, currency: 'NGN' } };
    const res = await postWebhook(payload);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.source, 'org_subscription');
    assert.equal(res.json.status, 'failed');
    const after = await currentSub(c, orgId);
    assert.notEqual(after.planKey, 'pro');
  });
});
