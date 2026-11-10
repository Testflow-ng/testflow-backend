/**
 * Everybody — the Student Pass perk: an organisation whose owner holds a live Plus pass may run
 * two live CBTs without the Studio plan.
 *
 * Run only when MONGODB_URI_TEST points at a DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/tf_org_perks_test node --test tests/orgPerks.integration.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.TRIAL_DISABLED = 'true';
process.env.RESEND_API_KEY = ''; // tests never send real email
process.env.SMTP_HOST = '';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';

describe('Everybody — Student Pass live CBT perk (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  const client = () => {
    const jar = {};
    const call = async (method, path, body) => {
      n += 1;
      const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${n % 250}.${Math.floor(n / 250)}` };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.Cookie = cookie;
      if ((jar.tfo_csrf || jar.tf_csrf)) h['X-CSRF-Token'] = (jar.tfo_csrf || jar.tf_csrf);
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
    return { call };
  };

  const ownerWithOrg = async () => {
    const c = client();
    const email = `o${uniq()}@t.test`;
    const reg = await c.call('POST', '/api/auth/register', { fullName: 'Org Owner', email, password: pw, confirmPassword: pw });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    assert.equal((await c.call('POST', '/api/auth/login', { email, password: pw })).status, 200);
    const org = await c.call('POST', '/api/v1/everybody/organizations', { name: `Academy ${uniq()}` });
    assert.equal(org.status, 201, JSON.stringify(org.json));
    const { User } = await import('../src/models/User.js');
    const user = await User.findOne({ email });
    return { c, orgId: org.json.organization.id, userId: user._id };
  };

  const grantPlus = async (userId, over = {}) => {
    const { StudentEntitlement } = await import('../src/models/StudentEntitlement.js');
    await StudentEntitlement.create({
      user: userId, key: 'custom_cbt', source: 'admin', active: true, expiresAt: null, ...over,
    });
  };

  const liveBody = (title) => ({
    title, durationMinutes: 30, mode: 'live', startsAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const create = (c, orgId, body) => c.call('POST', `/api/v1/everybody/organizations/${orgId}/exams`, body);

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = { mongoose };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));
    const { seedPlans } = await import('../src/scripts/seed-plans.js');
    await seedPlans();
    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  });

  it('a free organisation without a pass still cannot create a live exam', async () => {
    const { c, orgId } = await ownerWithOrg();
    const res = await create(c, orgId, liveBody('Live'));
    assert.equal(res.status, 402);
    assert.equal(res.json.error.details.feature, 'live_cbt');
  });

  it('a Plus holder gets two live exams, then the third needs Studio', async () => {
    const { c, orgId, userId } = await ownerWithOrg();
    await grantPlus(userId);
    assert.equal((await create(c, orgId, liveBody('One'))).status, 201);
    assert.equal((await create(c, orgId, liveBody('Two'))).status, 201);
    const third = await create(c, orgId, liveBody('Three'));
    assert.equal(third.status, 402);
    assert.equal(third.json.error.code, 'PLAN_REQUIRED');

    const sub = await c.call('GET', `/api/v1/everybody/subscription?organizationId=${orgId}`);
    assert.equal(sub.status, 200, JSON.stringify(sub.json));
    assert.deepEqual(
      { eligible: sub.json.perks.liveCbt.eligible, limit: sub.json.perks.liveCbt.limit, used: sub.json.perks.liveCbt.used },
      { eligible: true, limit: 2, used: 2 },
    );
  });

  it('archiving a live exam frees a slot', async () => {
    const { c, orgId, userId } = await ownerWithOrg();
    await grantPlus(userId);
    const a = await create(c, orgId, liveBody('A'));
    await create(c, orgId, liveBody('B'));
    assert.equal((await create(c, orgId, liveBody('C'))).status, 402);
    const { OrgExam } = await import('../src/models/OrgExam.js');
    await OrgExam.updateOne({ _id: a.json.exam.id }, { $set: { status: 'archived' } });
    assert.equal((await create(c, orgId, liveBody('C'))).status, 201);
  });

  it('an expired pass gives nothing', async () => {
    const { c, orgId, userId } = await ownerWithOrg();
    await grantPlus(userId, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await create(c, orgId, liveBody('Late'))).status, 402);
  });
});
