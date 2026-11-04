/**
 * Provider-aware advertising over HTTP, with Google AdSense configured.
 * Run only when MONGODB_URI_TEST points at a DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/testflow_advertising_test node --test tests/advertising.integration.test.js
 *
 * The rules this file protects:
 *  - Google and Testflow are offered, suppressed and switched off independently.
 *  - A paid ad-free pass suppresses both; a live-CBT-only grant suppresses neither.
 *  - Eligibility is permission, never a claim that Google has an ad to show.
 *  - A broken Google reporting integration cannot break ad eligibility or Testflow Ads.
 */
process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';
process.env.GOOGLE_ADSENSE_ENABLED = 'true';
process.env.GOOGLE_ADSENSE_PUBLISHER_ID = 'ca-pub-1234567890123456';
process.env.GOOGLE_ADSENSE_AD_UNITS = 'content_feed:1234567890,desktop_sidebar:2345678901';
// GOOGLE_ADSENSE_REQUIRE_CONSENT left at its default (false): this file covers the deployment
// that does not need an affirmative consent signal, while still honouring a refusal.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

describe('Provider-aware advertising (integration)', { skip }, () => {
  let m; let server; let base; let fetchPublisherReport;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  const client = () => {
    const jar = {};
    const call = async (method, path, { body } = {}) => {
      const h = { 'X-Forwarded-For': `10.8.${(n += 1) % 250}.${Math.floor(n / 250)}` };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.Cookie = cookie;
      if (jar.tf_csrf) h['X-CSRF-Token'] = jar.tf_csrf;
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetch(`${base}/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
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

  const account = async (role = 'student') => {
    const email = `a${uniq()}@t.test`;
    const c = client();
    const reg = await c.call('POST', '/auth/register', {
      body: { fullName: 'Ad Tester', email, password: pw, confirmPassword: pw, product: 'student' },
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    if (role !== 'student') await m.User.updateOne({ email }, { $set: { role } });
    assert.equal((await c.call('POST', '/auth/login', { body: { email, password: pw } })).status, 200);
    const user = await m.User.findOne({ email }).lean();
    return { c, email, userId: String(user._id) };
  };

  const eligibility = async (c, query) => {
    const res = await c.call('GET', `/advertising/eligibility?${query}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.eligibility;
  };

  const grant = (userId, key) => m.StudentEntitlement.create({ user: userId, key, source: 'admin' });

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = {
      mongoose,
      User: (await import('../src/models/User.js')).User,
      StudentEntitlement: (await import('../src/models/StudentEntitlement.js')).StudentEntitlement,
    };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));
    ({ fetchPublisherReport } = await import('../src/services/advertising/reporting.service.js'));

    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (m?.mongoose) {
      await m.mongoose.connection.dropDatabase();
      await m.mongoose.disconnect();
    }
  });

  it('publishes the provider configuration the client needs to render', async () => {
    const res = await client().call('GET', '/advertising/config');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const { providers, placements } = res.json.advertising;
    assert.equal(providers.google_adsense.enabled, true);
    assert.equal(providers.google_adsense.publisherId, 'ca-pub-1234567890123456');
    assert.equal(providers.google_adsense.requireConsent, false);
    assert.equal(providers.google_adsense.adUnits.content_feed, '1234567890');
    assert.equal(providers.testflow.enabled, true, 'Testflow Ads stay on unless they are switched off');

    const enabled = placements.filter((p) => p.enabled).map((p) => p.id).sort();
    assert.deepEqual(enabled, ['content_feed', 'desktop_sidebar', 'post_activity']);
  });

  it('exposes the registry, including the placements that may never serve', async () => {
    const all = await client().call('GET', '/advertising/placements');
    assert.equal(all.status, 200);
    assert.equal(all.json.placements.length, 7);

    const sensitive = await client().call('GET', '/advertising/placements/exam_session');
    assert.equal(sensitive.status, 200);
    assert.equal(sensitive.json.placement.sensitive, true);
    assert.equal(sensitive.json.placement.enabled, false);

    const missing = await client().call('GET', '/advertising/placements/not_a_placement');
    assert.equal(missing.status, 404, JSON.stringify(missing.json));
  });

  it('serves Google to a guest on a content placement, and nothing to Testflow', async () => {
    const result = await eligibility(client(), 'placement=content_feed');
    assert.equal(result.authenticated, false);
    assert.equal(result.providers.google_adsense.eligible, true);
    assert.equal(result.providers.testflow.eligible, false);
    assert.equal(result.providers.testflow.reason, 'AUTH_REQUIRED');
    assert.equal(result.adsEnabled, true);
  });

  it('offers both providers to a signed-in student with no paid plan', async () => {
    const student = await account();
    const result = await eligibility(student.c, 'placement=content_feed');
    assert.equal(result.authenticated, true);
    assert.equal(result.adFree, false);
    assert.equal(result.providers.testflow.eligible, true);
    assert.equal(result.providers.google_adsense.eligible, true);
    assert.equal(result.adsEnabled, true);
    assert.equal(result.reason, null);
  });

  it('takes both providers away from a student who paid to remove ads', async () => {
    const student = await account();
    await grant(student.userId, 'ad_free');
    const result = await eligibility(student.c, 'placement=content_feed');
    assert.equal(result.adFree, true);
    assert.equal(result.entitlementStatus, 'active');
    assert.equal(result.providers.testflow.eligible, false);
    assert.equal(result.providers.testflow.reason, 'AD_FREE_ENTITLEMENT');
    assert.equal(result.providers.google_adsense.eligible, false);
    assert.equal(result.providers.google_adsense.reason, 'AD_FREE_ENTITLEMENT');
    assert.equal(result.adsEnabled, false);
    assert.equal(result.reason, 'AD_FREE_ENTITLEMENT');
  });

  it('does not treat a live-CBT plan as an ad-free plan', async () => {
    const student = await account();
    await grant(student.userId, 'live_cbt_host');
    const result = await eligibility(student.c, 'placement=content_feed');
    assert.equal(result.adFree, false);
    assert.equal(result.providers.google_adsense.eligible, true);
    assert.equal(result.adsEnabled, true);
  });

  it('never serves on a sensitive placement, whatever the user holds', async () => {
    const student = await account();
    for (const placement of ['exam_session', 'live_cbt', 'payment_checkout', 'auth']) {
      const result = await eligibility(student.c, `placement=${placement}`);
      assert.equal(result.adsEnabled, false, `${placement} must stay ad-free`);
      assert.equal(result.reason, 'PLACEMENT_RESTRICTED');
    }
  });

  it('honours a refusal even where no consent is required', async () => {
    const student = await account();
    const result = await eligibility(student.c, 'placement=content_feed&consent=denied');
    assert.equal(result.consent, 'denied');
    assert.equal(result.adsEnabled, false);
    assert.equal(result.reason, 'CONSENT_WITHHELD');
  });

  it('rejects a malformed query, and 404s an unregistered placement', async () => {
    const c = client();
    assert.equal((await c.call('GET', '/advertising/eligibility?placement=content_feed&consent=maybe')).status, 422);
    assert.equal((await c.call('GET', '/advertising/eligibility')).status, 422);
    const unknown = await c.call('GET', '/advertising/eligibility?placement=unknown_spot');
    assert.equal(unknown.status, 404, JSON.stringify(unknown.json));
    assert.equal(unknown.json.error.code, 'PLACEMENT_NOT_FOUND');
  });

  it('keeps administrative advertising data behind an administrator', async () => {
    const student = await account();
    assert.equal((await client().call('GET', '/advertising/admin/health')).status, 401);
    assert.equal((await student.c.call('GET', '/advertising/admin/health')).status, 403);
    assert.equal((await student.c.call('GET', '/advertising/admin/reporting')).status, 403);
  });

  it('reports health and integration status to an administrator, with no invented metrics', async () => {
    const admin = await account('admin');
    const student = await account();
    await grant(student.userId, 'ad_free');

    const res = await admin.c.call('GET', '/advertising/admin/health');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const { health } = res.json;
    assert.deepEqual(health.providers.testflow, { enabled: true });
    assert.equal(health.providers.google_adsense.enabled, true);
    assert.deepEqual(health.placements, { registered: 7, enabled: 3, enabledIds: ['content_feed', 'desktop_sidebar', 'post_activity'] });
    // Counts must agree with the rows that are actually live, whatever order these tests ran in.
    const live = { active: true, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
    assert.equal(health.entitlements.adFree, await m.StudentEntitlement.countDocuments({ key: 'ad_free', ...live }));
    assert.ok(health.entitlements.adFree >= 1);
    assert.equal(health.entitlements.liveCbtHost, await m.StudentEntitlement.countDocuments({ key: 'live_cbt_host', ...live }));
    assert.equal(health.reporting.configured, false);
    assert.equal(health.reporting.status, 'disabled');
    assert.deepEqual(health.issues, []);
  });

  it('refuses to report publisher revenue rather than returning zero', async () => {
    const admin = await account('admin');
    const res = await admin.c.call('GET', '/advertising/admin/reporting');
    assert.equal(res.status, 200);
    assert.equal(res.json.reporting.provider, 'adsense_management_api');

    await assert.rejects(
      () => fetchPublisherReport(),
      (err) => err.statusCode === 501 && err.code === 'REPORTING_NOT_CONFIGURED',
    );
  });

  it('keeps ad eligibility working when the Google reporting integration fails', async () => {
    const student = await account();
    await assert.rejects(() => fetchPublisherReport());
    const result = await eligibility(student.c, 'placement=content_feed');
    assert.equal(result.adsEnabled, true);
    assert.equal(result.providers.google_adsense.eligible, true);
    assert.equal(result.providers.testflow.eligible, true);
  });
});
