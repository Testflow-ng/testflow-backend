/**
 * Database-backed tests (authorization, checkout/payment, moderation, expiry,
 * dedupe, retention, concurrency). They only run when MONGODB_URI_TEST points at
 * a DISPOSABLE database — the database is DROPPED at the end. Example:
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/testflow_ads_test npm test
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_integration';

describe('Ads Manager (integration)', { skip }, () => {
  let m;
  let server;
  let base;
  const SECRET = 'sk_test_integration';

  const call = async (method, path, { user, body, headers } = {}) => {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (user) h.Cookie = `tf_access=${m.token.signAccessToken(user)}`;
    const res = await fetch(`${base}/api${path}`, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  const mkUser = (role, n) => m.User.create({
    fullName: `${role} ${n}`, email: `${role}${n}-${crypto.randomBytes(3).toString('hex')}@t.test`, passwordHash: 'Passw0rdTest', role,
  });
  const mkAsset = (owner) => m.AdAsset.create({
    owner: owner._id, storageKey: `ads/test/${crypto.randomUUID()}.webp`, url: 'https://cdn.example.com/a.webp', width: 600, height: 300, bytes: 1000, format: 'webp', sha256: 'x',
  });
  const campaignBody = (asset, over = {}) => ({
    name: 'Promo', title: 'Study smarter', description: 'Short and sweet copy.', assetId: String(asset._id),
    destination: { type: 'url', url: 'https://shop.example.com' }, keywords: ['chemistry'], durationDays: 3, ...over,
  });
  const newCampaign = async (adv, over) => (await call('POST', '/ads/campaigns', { user: adv, body: campaignBody(await mkAsset(adv), over) })).json.campaign;

  // Fake provider: the "bank" ledger decides what verify() returns.
  const ledger = new Map();
  const fakeProvider = {
    name: 'fake',
    initialize: async ({ reference }) => ({ authorizationUrl: `https://pay.example/${reference}` }),
    verify: async (ref) => ledger.get(ref) ?? { status: 'pending' },
    verifyWebhookSignature: (raw, sig) => crypto.createHmac('sha512', SECRET).update(raw).digest('hex') === sig,
    parseWebhook: (b) => (b?.event ? { type: b.event, reference: b.data.reference } : null),
  };
  const webhook = (reference) => {
    const raw = JSON.stringify({ event: 'charge.success', data: { reference } });
    return call('POST', '/ads/payments/webhook', { body: raw, headers: { 'x-paystack-signature': crypto.createHmac('sha512', SECRET).update(raw).digest('hex') } });
  };
  const termsOf = async () => (await m.settingsSvc.getSettings()).termsVersion;
  const pay = async (adv, campaignIds) =>
    call('POST', '/ads/checkout', { user: adv, body: { campaignIds, acceptTerms: true, termsVersion: await termsOf() } });
  const paid = async (adv, campaign) => {
    const r = await pay(adv, [campaign.id]);
    ledger.set(r.json.reference, { status: 'success', amountKobo: r.json.amountKobo, currency: 'NGN', transactionId: '1' });
    await webhook(r.json.reference);
    return r.json;
  };
  const completedSession = (student) => m.ExamSession.create({
    student: student._id, subject: new m.mongoose.Types.ObjectId(), subjectCode: 'CHM101', durationMinutes: 10, expiresAt: new Date(),
    questions: [{ question: new m.mongoose.Types.ObjectId(), stem: 'q', options: ['a', 'b'], correctOption: 0 }], totalQuestions: 1, status: 'submitted',
  });

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = {
      mongoose,
      User: (await import('../src/models/User.js')).User,
      AdAsset: (await import('../src/models/AdAsset.js')).AdAsset,
      Campaign: (await import('../src/models/Campaign.js')).Campaign,
      AdPayment: (await import('../src/models/AdPayment.js')).AdPayment,
      AdEvent: (await import('../src/models/AdEvent.js')).AdEvent,
      AdServe: (await import('../src/models/AdServe.js')).AdServe,
      AdDailyStat: (await import('../src/models/AdDailyStat.js')).AdDailyStat,
      ExamSession: (await import('../src/models/ExamSession.js')).ExamSession,
      CampaignModeration: (await import('../src/models/CampaignModeration.js')).CampaignModeration,
      AuditLog: (await import('../src/models/AuditLog.js')).AuditLog,
      token: await import('../src/services/token.service.js'),
      settingsSvc: await import('../src/services/ads/settings.service.js'),
      payProvider: await import('../src/services/ads/payment/index.js'),
      image: await import('../src/services/ads/image.service.js'),
      lifecycle: await import('../src/jobs/lifecycle.job.js'),
      retention: await import('../src/jobs/retention.job.js'),
    };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));
    m.payProvider.setProviderForTests(fakeProvider);
    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    m.payProvider.setProviderForTests(null);
    await new Promise((r) => server.close(r));
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  });

  it('authorization: roles are enforced and advertisers cannot see each other', async () => {
    const [a, b, student, admin] = await Promise.all([mkUser('advertiser', 1), mkUser('advertiser', 2), mkUser('student', 1), mkUser('admin', 1)]);
    assert.equal((await call('GET', '/ads/campaigns')).status, 401);
    assert.equal((await call('GET', '/ads/campaigns', { user: student })).status, 403);
    assert.equal((await call('GET', '/admin/ads/campaigns', { user: a })).status, 403);
    assert.equal((await call('GET', '/admin/ads/campaigns', { user: admin })).status, 200);

    const c = await newCampaign(a);
    assert.equal((await call('GET', `/ads/campaigns/${c.id}`, { user: b })).status, 404);
    assert.equal((await call('PATCH', `/ads/campaigns/${c.id}`, { user: b, body: { name: 'hacked' } })).status, 404);
    assert.equal((await call('DELETE', `/ads/campaigns/${c.id}`, { user: b })).status, 404);
    assert.equal((await call('GET', `/ads/campaigns/${c.id}/analytics`, { user: b })).status, 404);
    assert.equal((await call('POST', '/ads/checkout/quote', { user: b, body: { campaignIds: [c.id] } })).status, 404);
    assert.equal((await call('GET', '/ads/campaigns', { user: b })).json.total, 0);
  });

  it('validation: word limit, URL, WhatsApp, keywords and terms are enforced', async () => {
    const a = await mkUser('advertiser', 3);
    const asset = await mkAsset(a);
    const post = (over) => call('POST', '/ads/campaigns', { user: a, body: campaignBody(asset, over) });
    assert.equal((await post({ description: 'word '.repeat(501) })).status, 422);
    assert.equal((await post({ description: 'word '.repeat(500) })).status, 201);
    assert.equal((await post({ destination: { type: 'url', url: 'http://insecure.example.com' } })).status, 422);
    assert.equal((await post({ destination: { type: 'whatsapp', whatsapp: '123' } })).status, 422);
    assert.equal((await post({ destination: { type: 'whatsapp', whatsapp: '08012345678' } })).status, 201);
    assert.equal((await post({ keywords: ['a1', 'b2', 'c3', 'd4'] })).status, 422);
    assert.equal((await post({ durationDays: 0 })).status, 422);
    const c = (await post({})).json.campaign;
    const noTerms = await call('POST', '/ads/checkout', { user: a, body: { campaignIds: [c.id], acceptTerms: false, termsVersion: await termsOf() } });
    assert.equal(noTerms.status, 422);
  });

  it('pricing is computed on the server and follows the admin fee', async () => {
    const a = await mkUser('advertiser', 4);
    const admin = await mkUser('admin', 2);
    const c = await newCampaign(a, { durationDays: 4 });
    assert.equal(c.priceKobo, 400000);
    const forged = await call('POST', '/ads/checkout', { user: a, body: { campaignIds: [c.id], acceptTerms: true, termsVersion: await termsOf(), amountKobo: 1 } });
    assert.equal(forged.status, 422); // strict body: a client-supplied price is rejected
    assert.equal((await call('PATCH', '/admin/ads/settings', { user: admin, body: { dailyFeeKobo: 150000 } })).status, 200);
    const q = await call('POST', '/ads/checkout/quote', { user: a, body: { campaignIds: [c.id] } });
    assert.equal(q.json.amountKobo, 600000);
    await call('PATCH', '/admin/ads/settings', { user: admin, body: { dailyFeeKobo: 100000 } });
    assert.equal((await call('PATCH', '/admin/ads/settings', { user: a, body: { dailyFeeKobo: 1 } })).status, 403);
  });

  it('payment: webhook is signed, idempotent, amount-checked; payment never auto-publishes', async () => {
    const a = await mkUser('advertiser', 5);
    const c = await newCampaign(a);
    const r = await pay(a, [c.id]);
    assert.equal(r.status, 201);
    assert.equal(r.json.amountKobo, 300000);

    const bad = await call('POST', '/ads/payments/webhook', { body: '{"event":"charge.success","data":{"reference":"x"}}', headers: { 'x-paystack-signature': 'nope' } });
    assert.equal(bad.status, 401);

    ledger.set(r.json.reference, { status: 'success', amountKobo: 300000, currency: 'NGN', transactionId: '9' });
    await Promise.all([webhook(r.json.reference), webhook(r.json.reference), webhook(r.json.reference)]);
    const after1 = await m.Campaign.findById(c.id);
    assert.equal(after1.status, 'pending_review'); // NOT active
    assert.equal(after1.paymentStatus, 'paid');
    assert.equal(await m.CampaignModeration.countDocuments({ campaign: c.id, action: 'payment_verified' }), 1);
    assert.equal(await m.AdPayment.countDocuments({ reference: r.json.reference, status: 'paid' }), 1);

    const c2 = await newCampaign(a);
    const r2 = await pay(a, [c2.id]);
    ledger.set(r2.json.reference, { status: 'success', amountKobo: 100, currency: 'NGN', transactionId: '10' });
    await webhook(r2.json.reference);
    assert.equal((await m.Campaign.findById(c2.id)).status, 'draft'); // mismatch → not activated, released
    assert.equal((await m.AdPayment.findOne({ reference: r2.json.reference })).failureReason, 'AMOUNT_MISMATCH');
  });

  it('concurrency: parallel checkouts of one campaign — exactly one wins; idempotency key replays', async () => {
    const a = await mkUser('advertiser', 6);
    const c = await newCampaign(a);
    const results = await Promise.all(Array.from({ length: 6 }, () => pay(a, [c.id])));
    assert.equal(results.filter((x) => x.status === 201).length, 1);
    assert.ok(results.every((x) => [201, 409].includes(x.status)));
    assert.equal(await m.AdPayment.countDocuments({ 'items.campaign': c.id }), 1);

    const c2 = await newCampaign(a);
    const body = { campaignIds: [c2.id], acceptTerms: true, termsVersion: await termsOf() };
    const [k1, k2] = await Promise.all([1, 2].map(() => call('POST', '/ads/checkout', { user: a, body, headers: { 'Idempotency-Key': 'key-1' } })));
    assert.equal(k1.json.reference, k2.json.reference);
  });

  it('moderation: unpaid cannot be approved; reason required; approve → active; history & audit recorded', async () => {
    const a = await mkUser('advertiser', 7);
    const admin = await mkUser('admin', 3);
    const unpaid = await newCampaign(a);
    assert.equal((await call('POST', `/admin/ads/campaigns/${unpaid.id}/approve`, { user: admin })).status, 409);

    const c = await newCampaign(a);
    await paid(a, c);
    assert.equal((await call('POST', `/admin/ads/campaigns/${c.id}/reject`, { user: admin, body: {} })).status, 422);
    assert.equal((await call('POST', `/admin/ads/campaigns/${c.id}/approve`, { user: a })).status, 403);
    const ok = await call('POST', `/admin/ads/campaigns/${c.id}/approve`, { user: admin });
    assert.equal(ok.json.campaign.status, 'active');
    assert.equal((await call('POST', `/admin/ads/campaigns/${c.id}/approve`, { user: admin })).status, 409);

    const hist = await call('GET', `/admin/ads/campaigns/${c.id}/history`, { user: admin });
    assert.deepEqual(hist.json.history.map((h) => h.action), ['created', 'checkout_started', 'payment_verified', 'approved']);
    assert.equal(await m.AuditLog.countDocuments({ action: 'AD_APPROVE', targetId: c.id }), 1);

    const c2 = await newCampaign(a);
    await paid(a, c2);
    const rej = await call('POST', `/admin/ads/campaigns/${c2.id}/reject`, { user: admin, body: { reason: 'Misleading claims' } });
    assert.equal(rej.json.campaign.status, 'rejected');
    assert.equal((await call('POST', `/ads/campaigns/${c2.id}/resubmit`, { user: a })).json.campaign.status, 'pending_review');
  });

  it('serving: only approved+active+unexpired ads; expiry enforced at serve time; one ad per session', async () => {
    const a = await mkUser('advertiser', 8);
    const admin = await mkUser('admin', 4);
    const s = await mkUser('student', 2);
    const sess = await completedSession(s);
    const body = { sessionType: 'exam', sessionId: String(sess._id) };
    assert.equal((await call('POST', '/ads/serve', { user: s, body })).json.ad, null);

    const c = await newCampaign(a);
    await paid(a, c);
    const s0 = await mkUser('student', 20);
    const sessUnapproved = await completedSession(s0);
    assert.equal((await call('POST', '/ads/serve', { user: s0, body: { sessionType: 'exam', sessionId: String(sessUnapproved._id) } })).json.ad, null); // paid but unapproved

    await call('POST', `/admin/ads/campaigns/${c.id}/approve`, { user: admin });
    const served = await call('POST', '/ads/serve', { user: s, body });
    assert.equal(served.json.ad.label, 'Sponsored');
    assert.equal(served.json.ad.keywords, undefined);
    assert.equal((await call('POST', '/ads/serve', { user: s, body })).json.ad.serveId, served.json.ad.serveId); // idempotent per session

    const inprog = await m.ExamSession.create({
      student: s._id, subject: new m.mongoose.Types.ObjectId(), subjectCode: 'CHM101', durationMinutes: 10, expiresAt: new Date(),
      questions: [{ question: new m.mongoose.Types.ObjectId(), stem: 'q', options: ['a', 'b'], correctOption: 0 }], totalQuestions: 1, status: 'in_progress',
    });
    assert.equal((await call('POST', '/ads/serve', { user: s, body: { sessionType: 'exam', sessionId: String(inprog._id) } })).status, 409);
    assert.equal((await call('POST', '/ads/serve', { user: await mkUser('student', 3), body })).status, 404); // someone else's session

    // The worker has NOT run, but the paid period is over → must not be served.
    await m.Campaign.updateOne({ _id: c.id }, { $set: { endsAt: new Date(Date.now() - 1000) } });
    const s2 = await mkUser('student', 4);
    const sess2 = await completedSession(s2);
    assert.equal((await call('POST', '/ads/serve', { user: s2, body: { sessionType: 'exam', sessionId: String(sess2._id) } })).json.ad, null);
  });

  it('events: impression criteria, dedupe by eventId & per-serve, concurrent duplicates count once', async () => {
    const a = await mkUser('advertiser', 9);
    const admin = await mkUser('admin', 5);
    const s = await mkUser('student', 5);
    const c = await newCampaign(a);
    await paid(a, c);
    await call('POST', `/admin/ads/campaigns/${c.id}/approve`, { user: admin });
    const sess = await completedSession(s);
    const { serveId } = (await call('POST', '/ads/serve', { user: s, body: { sessionType: 'exam', sessionId: String(sess._id) } })).json.ad;
    const ev = (type, eventId = crypto.randomUUID(), extra = {}) => call('POST', '/ads/events', { user: s, body: { serveId, eventId, type, ...extra } });

    assert.equal((await ev('click')).status, 409); // click needs a prior impression
    assert.equal((await ev('impression', undefined, { visibleMs: 200 })).status, 422); // not visible long enough
    const results = await Promise.all(Array.from({ length: 15 }, () => ev('impression', undefined, { visibleMs: 1500 })));
    assert.equal(results.filter((r) => r.json?.accepted).length, 1);
    const sameId = crypto.randomUUID();
    assert.equal((await ev('click', sameId)).json.accepted, true);
    assert.equal((await ev('click', sameId)).json.duplicate, true);
    assert.equal((await ev('click')).json.duplicate, true);
    assert.equal((await ev('whatsapp_click')).status, 422); // url campaign has no WhatsApp contact
    const other = await mkUser('student', 6);
    assert.equal((await call('POST', '/ads/events', { user: other, body: { serveId, eventId: crypto.randomUUID(), type: 'skip' } })).status, 404);

    const { stats } = await m.Campaign.findById(c.id);
    assert.deepEqual([stats.eligibleRequests, stats.impressions, stats.uniqueViewers, stats.clicks], [1, 1, 1, 1]);
    const analytics = await call('GET', `/ads/campaigns/${c.id}/analytics`, { user: a });
    assert.equal(analytics.json.totals.ctr, 100);
    assert.equal(analytics.json.spend.amountKobo, 300000);
  });

  it('rejected campaigns get a purge date (30d), resubmit clears it; refund is single-shot and guarded', async () => {
    const a = await mkUser('advertiser', 12);
    const admin = await mkUser('admin', 8);
    const refunds = [];
    fakeProvider.refund = async ({ reference }) => { refunds.push(reference); return { refundId: '1' }; };

    const c = await newCampaign(a);
    const p = await paid(a, c);
    const rej = await call('POST', `/admin/ads/campaigns/${c.id}/reject`, { user: admin, body: { reason: 'Not suitable' } });
    const days = Math.round((new Date(rej.json.campaign.purgeAt) - Date.now()) / 864e5);
    assert.equal(days, 30);
    assert.equal((await call('POST', `/ads/campaigns/${c.id}/resubmit`, { user: a })).json.campaign.purgeAt, undefined);

    // not refundable while the campaign is still in play
    const pay1 = await m.AdPayment.findOne({ reference: p.reference });
    assert.equal((await call('POST', `/admin/ads/payments/${pay1.id}/refund`, { user: admin, body: { reason: 'test refund' } })).status, 409);

    const c2 = await newCampaign(a);
    const p2 = await paid(a, c2);
    await call('POST', `/admin/ads/campaigns/${c2.id}/reject`, { user: admin, body: { reason: 'Prohibited content', refund: true } });
    const pay2 = await m.AdPayment.findOne({ reference: p2.reference });
    const results = await Promise.all([1, 2, 3].map(() => call('POST', `/admin/ads/payments/${pay2.id}/refund`, { user: admin, body: { reason: 'Rejected by moderation' } })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.deepEqual(refunds, [p2.reference]);
    assert.equal((await m.AdPayment.findById(pay2.id)).status, 'refunded');
    assert.equal((await m.Campaign.findById(c2.id)).paymentStatus, 'refunded');
    await webhook(p2.reference); // late webhook must not resurrect a refunded payment
    assert.equal((await m.AdPayment.findById(pay2.id)).status, 'refunded');
    delete fakeProvider.refund;
  });

  it('unsafe links: shorteners are refused at campaign creation', async () => {
    const a = await mkUser('advertiser', 13);
    const r = await call('POST', '/ads/campaigns', { user: a, body: campaignBody(await mkAsset(a), { destination: { type: 'url', url: 'https://bit.ly/x' } }) });
    assert.equal(r.status, 422);
  });

  it('lifecycle: worker expires finished campaigns with a 7-day purge deadline; republish needs a new payment', async () => {
    const a = await mkUser('advertiser', 10);
    const admin = await mkUser('admin', 6);
    const c = await newCampaign(a);
    await paid(a, c);
    await call('POST', `/admin/ads/campaigns/${c.id}/approve`, { user: admin });
    const ended = new Date(Date.now() - 60_000);
    await m.Campaign.updateOne({ _id: c.id }, { $set: { startsAt: new Date(ended - 3 * 864e5), endsAt: ended } });
    await m.lifecycle.expireDue({ count() {}, fail() {} });
    const exp = await m.Campaign.findById(c.id);
    assert.equal(exp.status, 'expired');
    assert.equal(Math.round((exp.purgeAt - exp.endsAt) / 864e5), 7);
    assert.equal((await call('GET', `/ads/campaigns/${c.id}`, { user: a })).status, 200); // still visible, with final analytics
    assert.ok((await call('GET', '/ads/campaigns?group=expired', { user: a })).json.total >= 1);

    const re = await call('POST', `/ads/campaigns/${c.id}/republish`, { user: a });
    assert.equal(re.status, 201);
    assert.equal(re.json.campaign.status, 'draft');
    assert.equal(re.json.campaign.paymentStatus, 'unpaid');
    assert.equal((await call('POST', `/ads/campaigns/${c.id}/republish`, { user: a })).json.campaign.id, re.json.campaign.id); // idempotent
  });

  it('retention: after 7 days campaigns vanish; data/events/unreferenced images purged; payments kept; idempotent', async () => {
    const a = await mkUser('advertiser', 11);
    const admin = await mkUser('admin', 7);
    const s = await mkUser('student', 7);
    const deleted = [];
    m.image.setStorageForTests({ deleteObject: async (k) => { deleted.push(k); } });

    const c = await newCampaign(a);
    const payment = await paid(a, c);
    await call('POST', `/admin/ads/campaigns/${c.id}/approve`, { user: admin });
    const sess = await completedSession(s);
    const { serveId } = (await call('POST', '/ads/serve', { user: s, body: { sessionType: 'exam', sessionId: String(sess._id) } })).json.ad;
    await call('POST', '/ads/events', { user: s, body: { serveId, eventId: crypto.randomUUID(), type: 'impression', visibleMs: 2000 } });

    // Expire it, then republish → the clone shares the image, so it must survive the first purge.
    await m.Campaign.updateOne({ _id: c.id }, { $set: { status: 'expired', endsAt: new Date(Date.now() - 9 * 864e5) } });
    const clone = await call('POST', `/ads/campaigns/${c.id}/republish`, { user: a });
    await m.Campaign.updateOne({ _id: c.id }, { $set: { purgeAt: new Date(Date.now() - 864e5) } });

    // Hidden immediately, even before the job runs.
    assert.equal((await call('GET', `/ads/campaigns/${c.id}`, { user: a })).status, 404);
    assert.equal((await call('GET', `/admin/ads/campaigns/${c.id}`, { user: admin })).status, 404);

    const ctx = { count() {}, fail: (e) => assert.fail(e) };
    await m.retention.runPurge(ctx);
    await m.retention.runPurge(ctx); // idempotent
    assert.equal(await m.Campaign.countDocuments({ _id: c.id }), 0);
    assert.equal(await m.AdEvent.countDocuments({ campaign: c.id }), 0);
    assert.equal(await m.AdServe.countDocuments({ campaign: c.id }), 0);
    assert.equal(await m.AdDailyStat.countDocuments({ campaign: c.id }), 0);
    assert.equal(await m.CampaignModeration.countDocuments({ campaign: c.id }), 0);
    assert.equal(deleted.length, 0, 'shared image must not be deleted while another campaign uses it');
    const kept = await m.AdPayment.findOne({ reference: payment.reference });
    assert.equal(kept.status, 'paid');
    assert.equal(kept.amountKobo, 300000); // financial record preserved
    assert.equal(kept.items[0].campaignName, undefined);
    assert.ok(kept.items[0].campaignPurgedAt);

    // Purge the clone (last reference) → object deleted from storage.
    await m.Campaign.updateOne({ _id: clone.json.campaign.id }, { $set: { purgeAt: new Date(Date.now() - 1000) } });
    await m.retention.runPurge(ctx);
    assert.equal(deleted.length, 1);
    assert.equal(await m.AdAsset.countDocuments({ _id: clone.json.campaign.image }), 0);
    m.image.setStorageForTests(null);
  });

  describe('training data foundation', () => {
    let AdDecision; let decisionLog;
    const liveCampaign = async (adv, admin, over) => { const c = await newCampaign(adv, over); await paid(adv, c); await call('POST', `/admin/ads/campaigns/${c.id}/approve`, { user: admin }); return c; };
    const serve = (student, sess) => call('POST', '/ads/serve', { user: student, body: { sessionType: 'exam', sessionId: String(sess._id) } });

    before(async () => {
      AdDecision = (await import('../src/models/AdDecision.js')).AdDecision;
      decisionLog = await import('../src/services/ads/decisionLog.service.js');
      await AdDecision.init();
    });

    it('logs a served decision (candidates, scores, selection) with outcomes linked by serveId and deduped', async () => {
      const a = await mkUser('advertiser', 30); const admin = await mkUser('admin', 30); const s = await mkUser('student', 30);
      await liveCampaign(a, admin);
      const sess = await completedSession(s);
      const { serveId } = (await serve(s, sess)).json.ad;
      const d = await AdDecision.findOne({ serveId }).lean();
      assert.equal(d.outcome, 'served'); assert.equal(d.ranker, 'deterministic-v1');
      assert.ok(d.candidates.length >= 1 && d.candidates[0].selected && d.candidates[0].rank === 1);
      assert.equal(d.selectedKey, d.candidates[0].campaignKey);
      assert.equal(d.context.sessionType, 'exam');
      assert.equal(d.label.impression, false);

      const ev = (type, extra = {}, eventId = crypto.randomUUID()) => call('POST', '/ads/events', { user: s, body: { serveId, eventId, type, ...extra } });
      await ev('impression', { visibleMs: 2500 });
      await ev('impression', { visibleMs: 9999 }); // duplicate (same serve+type) must not overwrite
      const clickId = crypto.randomUUID();
      await ev('click', {}, clickId); await ev('click', {}, clickId);
      await ev('skip');
      const after2 = await AdDecision.findOne({ serveId }).lean();
      assert.deepEqual(after2.label, { impression: true, visibleMs: 2500, click: true, whatsappClick: false, skip: true });
      assert.equal(await AdDecision.countDocuments({ serveId }), 1);
    });

    it('privacy: stored records hold no student/session ids, hashes or campaign content', async () => {
      const a = await mkUser('advertiser', 31); const admin = await mkUser('admin', 31); const s = await mkUser('student', 31);
      const c = await liveCampaign(a, admin, { title: 'ZZ-UNIQUE-TITLE-ZZ' });
      const sess = await completedSession(s);
      const { serveId } = (await serve(s, sess)).json.ad;
      const raw = JSON.stringify(await AdDecision.findOne({ serveId }).lean());
      const { AdServe } = await import('../src/models/AdServe.js');
      const serveRow = await AdServe.findOne({ serveId }).lean();
      for (const bad of [String(s._id), s.email, s.fullName, String(sess._id), String(c.id), serveRow.studentKey, serveRow.sessionKey, 'ZZ-UNIQUE-TITLE-ZZ', 'shop.example.com']) {
        assert.equal(raw.includes(bad), false, `leaked ${bad}`);
      }
    });

    it('logs reasons for showing no ad (no eligible campaign, frequency cap) and respects the disable switch', async () => {
      const admin = await mkUser('admin', 32); const s = await mkUser('student', 32);
      await m.Campaign.updateMany({}, { $set: { status: 'suspended' } }); // nothing eligible
      const r1 = await serve(s, await completedSession(s));
      assert.equal(r1.json.ad, null);
      assert.ok(await AdDecision.findOne({ outcome: 'no_ad', noAdReason: 'no_eligible_campaign' }));

      const a = await mkUser('advertiser', 32); await liveCampaign(a, admin);
      await call('PATCH', '/admin/ads/settings', { user: admin, body: { maxAdsPerStudentPerDay: 1 } });
      const s2 = await mkUser('student', 33);
      assert.ok((await serve(s2, await completedSession(s2))).json.ad);
      assert.equal((await serve(s2, await completedSession(s2))).json.reason, 'frequency_capped');
      assert.ok(await AdDecision.findOne({ outcome: 'no_ad', noAdReason: 'frequency_capped' }));
      await call('PATCH', '/admin/ads/settings', { user: admin, body: { maxAdsPerStudentPerDay: 3 } });

      const before = await AdDecision.countDocuments();
      await call('PATCH', '/admin/ads/settings', { user: admin, body: { trainingLoggingEnabled: false } });
      const s3 = await mkUser('student', 34);
      assert.ok((await serve(s3, await completedSession(s3))).json.ad); // serving unaffected
      assert.equal(await AdDecision.countDocuments(), before);
      await call('PATCH', '/admin/ads/settings', { user: admin, body: { trainingLoggingEnabled: true } });
    });

    it('a logging failure never breaks serving', async () => {
      assert.equal(await decisionLog.logDecision({ outcome: 'bogus', session: {}, ranked: [], now: new Date() }), null);
    });

    it('campaign purge does NOT delete training records', async () => {
      const a = await mkUser('advertiser', 35); const admin = await mkUser('admin', 35); const s = await mkUser('student', 35);
      const c = await liveCampaign(a, admin);
      const { serveId } = (await serve(s, await completedSession(s))).json.ad;
      await m.image.setStorageForTests({ deleteObject: async () => {} });
      await m.Campaign.updateOne({ _id: c.id }, { $set: { status: 'expired', purgeAt: new Date(Date.now() - 1000) } });
      await m.retention.runPurge({ count() {}, fail: (e) => assert.fail(e) });
      assert.equal(await m.Campaign.countDocuments({ _id: c.id }), 0);
      assert.equal(await m.AdServe.countDocuments({ serveId }), 0);
      const d = await AdDecision.findOne({ serveId });
      assert.ok(d, 'training record must survive the campaign purge');
      m.image.setStorageForTests(null);
    });

    it('retention: records older than trainingRetentionDays are swept; newer ones kept; honors a shortened setting', async () => {
      const mk = (id, daysAgo) => AdDecision.create({
        schemaVersion: 1, decisionId: id, ts: new Date(Date.now() - daysAgo * 864e5), day: '2026-01-01', outcome: 'no_ad', noAdReason: 'no_eligible_campaign',
        context: {}, candidateCount: 0, candidates: [], expireAt: new Date(Date.now() + 864e5 * 400),
      });
      await mk('old-1', 400); await mk('mid-1', 100); await mk('new-1', 1);
      assert.ok((await decisionLog.sweepTrainingRecords()) >= 1);
      assert.equal(await AdDecision.countDocuments({ decisionId: 'old-1' }), 0);
      assert.equal(await AdDecision.countDocuments({ decisionId: { $in: ['mid-1', 'new-1'] } }), 2);
      await m.settingsSvc.updateSettings({ trainingRetentionDays: 30 }, { user: { _id: new m.mongoose.Types.ObjectId() }, ip: '127.0.0.1', headers: {} });
      await decisionLog.sweepTrainingRecords();
      assert.equal(await AdDecision.countDocuments({ decisionId: 'mid-1' }), 0);
      assert.equal(await AdDecision.countDocuments({ decisionId: 'new-1' }), 1);
      await m.settingsSvc.updateSettings({ trainingRetentionDays: 365 }, { user: { _id: new m.mongoose.Types.ObjectId() }, ip: '127.0.0.1', headers: {} });
    });

    it('export: JSONL is super-admin only, one valid anonymized record per line; summary is admin-visible', async () => {
      const admin = await mkUser('admin', 40); const root = await mkUser('super_admin', 40); const a = await mkUser('advertiser', 40);
      assert.equal((await call('GET', '/admin/ads/training/export', { user: admin })).status, 403);
      assert.equal((await call('GET', '/admin/ads/training/export', { user: a })).status, 403);
      const res = await fetch(`${base}/api/admin/ads/training/export?includeNoAd=false&limit=1000`, { headers: { Cookie: `tf_access=${m.token.signAccessToken(root)}` } });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /ndjson/);
      const lines = (await res.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      assert.ok(lines.length >= 1);
      for (const rec of lines) {
        assert.equal(rec.outcome, 'served'); assert.ok(rec.label); assert.equal(rec._id, undefined); assert.ok(Array.isArray(rec.candidates));
      }
      assert.ok(await m.AuditLog.findOne({ action: 'AD_TRAINING_EXPORT' }));
      const sum = await call('GET', '/admin/ads/training/summary', { user: admin });
      assert.equal(sum.status, 200); assert.ok(sum.json.totalRecords >= lines.length); assert.equal(sum.json.retentionDays, 365);
    });
  });
});
