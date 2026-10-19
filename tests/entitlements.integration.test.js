/**
 * Student plans, the ad-free / live-CBT entitlement, and the purchase that grants it.
 * Run only when MONGODB_URI_TEST points at a DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/testflow_entitlements_test node --test tests/entitlements.integration.test.js
 *
 * The rules this file protects:
 *  - Hosting a live session needs a plan; joining one does not.
 *  - A price is never taken from the request, and nothing is granted until the provider has
 *    verified the payment.
 *  - One verified payment grants once, however many times the webhook is delivered.
 */
process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';
// Google AdSense left at its default (off) on purpose: this file also proves that a disabled
// ad provider does not disturb anything else.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';

describe('Student plans, entitlements and ad-free purchases (integration)', { skip }, () => {
  let m; let server; let base; let setProviderForTests;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  /** Every purchase the fake provider knows about: reference -> verify() answer. */
  const payments = new Map();
  const fakeProvider = {
    name: 'paystack',
    async initialize({ reference }) {
      return { authorizationUrl: `https://pay.example.test/${reference}` };
    },
    async verify(reference) {
      return payments.get(reference) ?? { status: 'pending' };
    },
    async refund({ reference }) {
      return { refundId: `rf_${reference}`, status: 'processed' };
    },
    verifyWebhookSignature(rawBody, signature) {
      if (!rawBody || !signature) return false;
      const expected = crypto.createHmac('sha512', WEBHOOK_SECRET).update(rawBody).digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(String(signature));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
    parseWebhook(body) {
      if (!body?.event || !body?.data?.reference) return null;
      return { type: body.event, reference: body.data.reference };
    },
  };

  const client = () => {
    const jar = {};
    const absorb = (res) => {
      for (const cookie of res.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (!value || /expires=Thu, 01 Jan 1970/i.test(cookie)) delete jar[name]; else jar[name] = value;
      }
    };
    const headers = (extra = {}) => {
      const h = { 'X-Forwarded-For': `10.7.${(n += 1) % 250}.${Math.floor(n / 250)}`, ...extra };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.Cookie = cookie;
      if (jar.tf_csrf) h['X-CSRF-Token'] = jar.tf_csrf;
      return h;
    };
    const parse = async (res) => {
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null };
    };
    return {
      jar,
      call: async (method, path, { body, headers: extra, csrf = true } = {}) => {
        const h = headers(extra);
        if (!csrf) delete h['X-CSRF-Token'];
        if (body !== undefined) h['Content-Type'] = 'application/json';
        const res = await fetch(`${base}/api${path}`, {
          method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
        });
        absorb(res);
        return parse(res);
      },
      /** Posts an exact string body so the webhook signature covers byte-for-byte what arrives. */
      rawPost: async (path, rawBody, extraHeaders = {}) => {
        const res = await fetch(`${base}/api${path}`, {
          method: 'POST', headers: headers({ 'Content-Type': 'application/json', ...extraHeaders }), body: rawBody,
        });
        absorb(res);
        return parse(res);
      },
    };
  };

  const account = async (role = 'student') => {
    const email = `e${uniq()}@t.test`;
    const c = client();
    const reg = await c.call('POST', '/auth/register', {
      body: { fullName: 'Entitlement Tester', email, password: pw, confirmPassword: pw, product: 'student' },
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    if (role !== 'student') {
      await m.User.updateOne({ email }, { $set: { role } });
    }
    const login = await c.call('POST', '/auth/login', { body: { email, password: pw } });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    const user = await m.User.findOne({ email }).lean();
    return { c, email, userId: String(user._id) };
  };

  const checkout = async (accountRef, planKey = 'pass_30d', idempotencyKey) => {
    const res = await accountRef.c.call('POST', '/billing/ad-free/checkout', {
      body: { planKey, ...(idempotencyKey ? { idempotencyKey } : {}) },
    });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.json.purchase;
  };

  const webhook = async (event, reference) => {
    const raw = JSON.stringify({ event, data: { reference, amount: payments.get(reference)?.amountKobo ?? null } });
    const signature = crypto.createHmac('sha512', WEBHOOK_SECRET).update(raw).digest('hex');
    return { raw, signature, res: await client().rawPost('/billing/ad-free/webhook', raw, { 'x-paystack-signature': signature }) };
  };

  const entitlementOf = async (accountRef) => {
    const res = await accountRef.c.call('GET', '/billing/entitlement');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.entitlement;
  };

  const hostAttempt = (accountRef, title = `Plan ${uniq()}`) =>
    accountRef.c.call('POST', '/live-cbt', { body: { title, subject: 'PL101', numQuestions: 5, durationMinutes: 10 } });

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = {
      mongoose,
      User: (await import('../src/models/User.js')).User,
      Subject: (await import('../src/models/Subject.js')).Subject,
      Question: (await import('../src/models/Question.js')).Question,
      StudentPurchase: (await import('../src/models/StudentPurchase.js')).StudentPurchase,
      StudentEntitlement: (await import('../src/models/StudentEntitlement.js')).StudentEntitlement,
      AuditLog: (await import('../src/models/AuditLog.js')).AuditLog,
    };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));

    const subject = await m.Subject.create({ code: 'PL101', title: 'Plan Test Subject', level: '100' });
    await m.Question.create(
      Array.from({ length: 8 }, (_, i) => ({
        subject: subject._id,
        stem: `Plan question ${i}: pick the right one.`,
        options: ['alpha', 'bravo', 'charlie', 'delta'],
        correctIndex: i % 4,
      })),
    );

    ({ setProviderForTests } = await import('../src/services/ads/payment/index.js'));
    setProviderForTests(fakeProvider);

    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    setProviderForTests?.(null);
    if (server) await new Promise((r) => server.close(r));
    if (m?.mongoose) {
      await m.mongoose.connection.dropDatabase();
      await m.mongoose.disconnect();
    }
  });

  // --- Catalogue and the free baseline ---

  it('lists the products with server-side prices and no way to send one', async () => {
    const res = await client().call('GET', '/billing/ad-free/products');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const keys = res.json.products.map((p) => p.key).sort();
    assert.deepEqual(keys, ['pass_30d', 'pass_90d']);
    for (const product of res.json.products) {
      assert.ok(product.priceMinor > 0);
      assert.equal(product.currency, 'NGN');
      assert.equal(product.removesAds, true);
      assert.equal(product.entitlements.liveCbtHost, true);
    }

    const sneaky = await account();
    const res2 = await sneaky.c.call('POST', '/billing/ad-free/checkout', {
      body: { planKey: 'pass_30d', priceMinor: 1 },
    });
    assert.equal(res2.status, 422, 'a client-supplied price is rejected outright');
  });

  it('starts a free student with nothing, and refuses an unknown plan', async () => {
    const student = await account();
    const entitlement = await entitlementOf(student);
    assert.equal(entitlement.status, 'free');
    assert.equal(entitlement.adFree, false);
    assert.equal(entitlement.liveCbtHost, false);
    assert.equal(entitlement.expiresAt, null);

    const res = await student.c.call('POST', '/billing/ad-free/checkout', { body: { planKey: 'free_forever' } });
    assert.equal(res.status, 422, 'unknown plan keys never reach the service');
  });

  it('requires a session for anything that reads or moves money', async () => {
    const guest = client();
    assert.equal((await guest.call('GET', '/billing/entitlement')).status, 401);
    assert.equal((await guest.call('POST', '/billing/ad-free/checkout', { body: { planKey: 'pass_30d' } })).status, 401);
    assert.equal((await guest.call('GET', '/billing/ad-free/status')).status, 401);
  });

  // --- The live CBT gate ---

  it('blocks hosting without a plan and lets the same student host once they hold one', async () => {
    const student = await account();

    const blocked = await hostAttempt(student);
    assert.equal(blocked.status, 402, JSON.stringify(blocked.json));
    assert.equal(blocked.json.error.code, 'PLAN_REQUIRED');

    const purchase = await checkout(student);
    payments.set(purchase.reference, { status: 'success', amountKobo: purchase.amountKobo, currency: 'NGN', transactionId: 'tx_1' });
    const { res } = await webhook('charge.success', purchase.reference);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.applied, true);

    const allowed = await hostAttempt(student);
    assert.equal(allowed.status, 201, JSON.stringify(allowed.json));

    // Joining is free: the participant never buys anything.
    const friend = await account();
    const joined = await friend.c.call('POST', `/live-cbt/${allowed.json.exam.shareCode}/join`);
    assert.equal(joined.status, 201, JSON.stringify(joined.json));
  });

  // --- Checkout ---

  it('prices the purchase from the catalogue and does not charge twice for one idempotency key', async () => {
    const student = await account();
    const key = `idem-${uniq()}-${uniq()}`;

    const first = await checkout(student, 'pass_90d', key);
    assert.equal(first.amountKobo, 600000);
    assert.equal(first.currency, 'NGN');
    assert.equal(first.status, 'initialized');
    assert.ok(first.authorizationUrl);

    const replay = await student.c.call('POST', '/billing/ad-free/checkout', {
      body: { planKey: 'pass_90d', idempotencyKey: key },
    });
    assert.equal(replay.status, 200, 'a replay is not a new charge');
    assert.equal(replay.json.purchase.reference, first.reference);
    assert.equal(await m.StudentPurchase.countDocuments({ user: student.userId }), 1);
  });

  // --- Verification, idempotency and granting ---

  it('activates both entitlements only after a verified successful payment', async () => {
    const student = await account();
    const purchase = await checkout(student);
    const before = await entitlementOf(student);
    assert.equal(before.adFree, false);

    payments.set(purchase.reference, { status: 'success', amountKobo: purchase.amountKobo, currency: 'NGN', transactionId: 'tx_ok' });
    const { res } = await webhook('charge.success', purchase.reference);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.applied, true);

    const after = await entitlementOf(student);
    assert.equal(after.status, 'active');
    assert.equal(after.adFree, true);
    assert.equal(after.liveCbtHost, true);
    assert.equal(after.planKey, 'pass_30d');
    const days = (new Date(after.expiresAt).getTime() - Date.now()) / 86400000;
    assert.ok(days > 29 && days <= 30, `expected about 30 days, got ${days}`);

    const stored = await m.StudentPurchase.findOne({ reference: purchase.reference }).lean();
    assert.equal(stored.status, 'paid');
    assert.equal(stored.amountKobo, 250000);
    assert.equal(stored.providerTransactionId, 'tx_ok');

    const audit = await m.AuditLog.findOne({ action: 'AD_FREE_PURCHASE_VERIFIED', targetId: stored._id }).lean();
    assert.ok(audit, 'the verified payment is auditable');
  });

  it('does not grant twice when the provider redelivers the webhook', async () => {
    const student = await account();
    const purchase = await checkout(student);
    payments.set(purchase.reference, { status: 'success', amountKobo: purchase.amountKobo, currency: 'NGN' });
    assert.equal((await webhook('charge.success', purchase.reference)).res.json.applied, true);

    const firstExpiry = (await entitlementOf(student)).expiresAt;
    const again = await webhook('charge.success', purchase.reference);
    assert.equal(again.res.status, 200);
    assert.equal(again.res.json.duplicate, true);
    assert.equal((await entitlementOf(student)).expiresAt, firstExpiry, 'a redelivery must not extend the pass');
  });

  it('ignores a webhook that belongs to another dispatcher', async () => {
    const reference = `SUB-${uniq()}${uniq()}`;
    const { res } = await webhook('charge.success', reference);
    assert.equal(res.status, 200);
    assert.equal(res.json.ignored, true);
  });

  it('rejects a webhook whose signature does not match the raw body', async () => {
    const student = await account();
    const purchase = await checkout(student);
    const raw = JSON.stringify({ event: 'charge.success', data: { reference: purchase.reference } });

    const bad = await client().rawPost('/billing/ad-free/webhook', raw, { 'x-paystack-signature': 'deadbeef' });
    assert.equal(bad.status, 401, JSON.stringify(bad.json));
    assert.equal(bad.json.error.code, 'INVALID_SIGNATURE');

    const none = await client().rawPost('/billing/ad-free/webhook', raw);
    assert.equal(none.status, 401);

    assert.equal((await entitlementOf(student)).adFree, false, 'a forged webhook grants nothing');
  });

  it('leaves a pending payment unactivated and can be re-verified on demand', async () => {
    const student = await account();
    const purchase = await checkout(student);
    payments.set(purchase.reference, { status: 'pending' });

    const { res } = await webhook('charge.success', purchase.reference);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((await entitlementOf(student)).adFree, false);

    // The provider settles later; the client polls status with the reference.
    payments.set(purchase.reference, { status: 'success', amountKobo: purchase.amountKobo, currency: 'NGN' });
    const status = await student.c.call('GET', `/billing/ad-free/status?reference=${purchase.reference}`);
    assert.equal(status.status, 200, JSON.stringify(status.json));
    assert.equal(status.json.purchase.status, 'paid');
    assert.equal(status.json.entitlement.adFree, true);
  });

  it('never activates a failed payment', async () => {
    const student = await account();
    const purchase = await checkout(student);
    payments.set(purchase.reference, { status: 'failed' });

    const { res } = await webhook('charge.failed', purchase.reference);
    assert.equal(res.status, 200, JSON.stringify(res.json));

    const stored = await m.StudentPurchase.findOne({ reference: purchase.reference }).lean();
    assert.equal(stored.status, 'failed');
    assert.equal((await entitlementOf(student)).adFree, false);
  });

  it('rejects an amount or currency that does not match the purchase', async () => {
    const student = await account();
    const purchase = await checkout(student);
    payments.set(purchase.reference, { status: 'success', amountKobo: 1, currency: 'NGN' });

    const { res } = await webhook('charge.success', purchase.reference);
    assert.equal(res.status, 409, JSON.stringify(res.json));
    assert.equal(res.json.error.code, 'PAYMENT_MISMATCH');

    const stored = await m.StudentPurchase.findOne({ reference: purchase.reference }).lean();
    assert.equal(stored.status, 'failed');
    assert.equal(stored.mismatch.actualAmountKobo, 1);
    assert.equal((await entitlementOf(student)).adFree, false);
  });

  it('scopes a purchase to its owner: someone else sees a 404, never a 403', async () => {
    const owner = await account();
    const purchase = await checkout(owner);
    const stranger = await account();

    const res = await stranger.c.call('GET', `/billing/ad-free/status?reference=${purchase.reference}`);
    assert.equal(res.status, 404, JSON.stringify(res.json));
    assert.equal(res.json.error.code, 'PURCHASE_NOT_FOUND');
  });

  it('lets a student abandon their own pending purchase', async () => {
    const student = await account();
    const purchase = await checkout(student);
    const res = await student.c.call('POST', '/billing/ad-free/cancel', { body: { reference: purchase.reference } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.purchase.status, 'abandoned');
    assert.equal((await entitlementOf(student)).adFree, false);
  });

  // --- Expiry, revocation and refunds ---

  it('restores ad eligibility when the pass lapses, without a job having to run', async () => {
    const student = await account();
    const purchase = await checkout(student);
    payments.set(purchase.reference, { status: 'success', amountKobo: purchase.amountKobo, currency: 'NGN' });
    await webhook('charge.success', purchase.reference);
    assert.equal((await entitlementOf(student)).adFree, true);

    await m.StudentEntitlement.updateMany({ user: student.userId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const lapsed = await entitlementOf(student);
    assert.equal(lapsed.status, 'expired');
    assert.equal(lapsed.adFree, false);
    assert.equal(lapsed.liveCbtHost, false);

    const blocked = await hostAttempt(student);
    assert.equal(blocked.status, 402, JSON.stringify(blocked.json));
  });

  it('refunds with the provider and revokes only what that purchase granted', async () => {
    const admin = await account('admin');
    const student = await account();
    const purchase = await checkout(student);
    payments.set(purchase.reference, { status: 'success', amountKobo: purchase.amountKobo, currency: 'NGN' });
    await webhook('charge.success', purchase.reference);

    // A student cannot refund themselves.
    const denied = await student.c.call('POST', '/billing/ad-free/refund', { body: { reference: purchase.reference } });
    assert.equal(denied.status, 403, JSON.stringify(denied.json));

    const res = await admin.c.call('POST', '/billing/ad-free/refund', { body: { reference: purchase.reference, reason: 'requested' } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.purchase.status, 'refunded');

    const after = await entitlementOf(student);
    assert.equal(after.adFree, false);
    assert.equal(after.liveCbtHost, false);
    assert.equal((await hostAttempt(student)).status, 402);

    const row = await m.StudentEntitlement.findOne({ user: student.userId, key: 'ad_free' }).lean();
    assert.equal(row.revokedReason, 'requested');
    assert.ok(await m.AuditLog.findOne({ action: 'AD_FREE_REFUND' }));
  });

  it('keeps an unrefundable purchase from being refunded twice', async () => {
    const admin = await account('admin');
    const student = await account();
    const purchase = await checkout(student);
    const res = await admin.c.call('POST', '/billing/ad-free/refund', { body: { reference: purchase.reference } });
    assert.equal(res.status, 409, JSON.stringify(res.json));
    assert.equal(res.json.error.code, 'PURCHASE_NOT_REFUNDABLE');
  });

  // --- Administrator tooling ---

  it('grants and revokes an entitlement by hand, admin only', async () => {
    const admin = await account('admin');
    const student = await account();

    const asStudent = await student.c.call('POST', `/billing/ad-free/entitlements/${student.userId}/grant`, {
      body: { key: 'live_cbt_host' },
    });
    assert.equal(asStudent.status, 403, JSON.stringify(asStudent.json));

    const granted = await admin.c.call('POST', `/billing/ad-free/entitlements/${student.userId}/grant`, {
      body: { key: 'live_cbt_host' },
    });
    assert.equal(granted.status, 201, JSON.stringify(granted.json));
    assert.equal(granted.json.entitlement.expiresAt, null, 'an administrator grant does not expire');
    assert.equal((await hostAttempt(student)).status, 201);

    const badKey = await admin.c.call('POST', `/billing/ad-free/entitlements/${student.userId}/grant`, {
      body: { key: 'everything_forever' },
    });
    assert.equal(badKey.status, 422);

    const revoked = await admin.c.call('POST', `/billing/ad-free/entitlements/${student.userId}/revoke`, {
      body: { key: 'live_cbt_host', reason: 'chargeback' },
    });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
    assert.equal((await hostAttempt(student)).status, 402);

    const missingUser = await admin.c.call('POST', '/billing/ad-free/entitlements/000000000000000000000000/revoke', {
      body: { key: 'live_cbt_host' },
    });
    assert.equal(missingUser.status, 404);
  });

  it('rate limits checkout per account', async () => {
    const student = await account();
    let last = null;
    for (let i = 0; i < 21; i += 1) {
      last = await student.c.call('POST', '/billing/ad-free/checkout', {
        body: { planKey: 'pass_30d', idempotencyKey: `rl-${uniq()}-${uniq()}` },
      });
      if (i < 20) assert.equal(last.status, 201, `call ${i + 1}: ${JSON.stringify(last.json)}`);
    }
    assert.equal(last.status, 429, JSON.stringify(last.json));
    assert.equal(last.json.error.code, 'RATE_LIMITED');
  });
});
