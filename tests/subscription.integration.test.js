/**
 * Everybody phase 2 — subscriptions integration tests.
 * Run only when MONGODB_URI_TEST points at a DISPOSABLE database:
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/testflow_subs_test npm test
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';

describe('Everybody phase 2 — subscriptions (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  const client = () => {
    const jar = {};
    const call = async (method, path, { body, headers } = {}) => {
      n += 1;
      const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9${n % 250}.${Math.floor(n / 250)}`, ...headers };
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
    const email = `s${uniq()}@t.test`;
    await c.call('POST', '/api/auth/register', {
      body: { fullName: 'Test User', email, password: pw, confirmPassword: pw, product: 'student' },
    });
    const login = await c.call('POST', '/api/auth/login', { body: { email, password: pw } });
    assert.equal(login.status, 200);
    return { c, email };
  };
  const mkOrg = async (c, name = `Acad ${uniq()}`) =>
    c.call('POST', '/api/v1/everybody/organizations', { body: { name } });

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = { mongoose };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));
    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  });

  it('owner can create a subscription (pro plan)', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    const sub = await c.call('POST', `/api/v1/everybody/organizations/${org.json.organization.id}/subscriptions`, {
      body: { planKey: 'pro' },
    });
    assert.equal(sub.status, 201);
    assert.ok(sub.json.subscription.planKey === 'pro');
    assert.ok(sub.json.subscription.status === 'pending');
  });

  it('owner cannot create subscription if one already active', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    await c.call('POST', `/api/v1/everybody/organizations/${org.json.organization.id}/subscriptions`, { body: { planKey: 'pro' } });
    const dup = await c.call('POST', `/api/v1/everybody/organizations/${org.json.organization.id}/subscriptions`, {
      body: { planKey: 'studio' },
    });
    assert.equal(dup.status, 409);
  });

  it('owner can list subscriptions', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    await c.call('POST', `/api/v1/everybody/organizations/${org.json.organization.id}/subscriptions`, { body: { planKey: 'pro' } });
    const list = await c.call('GET', `/api/v1/everybody/organizations/${org.json.organization.id}/subscriptions`);
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.json.subscriptions));
  });

  it('checkout returns reference + authorizationUrl', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    const create = await c.call('POST', `/api/v1/everybody/organizations/${org.json.organization.id}/subscriptions`, {
      body: { planKey: 'pro' },
    });
    assert.equal(create.status, 201);
    const subId = create.json.subscription.id;
    // In v1 checkout returns a Paystack URL; we just verify the shape.
    const chk = await c.call('POST', `/api/v1/everybody/organizations/${org.json.organization.id}/subscriptions/${subId}/checkout`, {
      body: {},
    });
    assert.equal(chk.status, 200);
    assert.ok(chk.json.reference);
    assert.ok(chk.json.authorizationUrl);
  });

  it('verify marks subscription active', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    const create = await c.call('POST', `/api/v1/everybody/organizations/${org.json.organization.id}/subscriptions`, {
      body: { planKey: 'pro' },
    });
    assert.equal(create.status, 201);
    const subId = create.json.subscription.id;
    const verify = await c.call('GET', `/api/v1/everybody/organizations/${org.json.organization.id}/subscriptions/${subId}/verify?reference=${create.json.subscription.reference}`);
    assert.equal(verify.status, 200);
    assert.ok(verify.json.subscription.status === 'active');
  });

  it('cross-tenant IDOR on subscription routes returns 404', async () => {
    const a = await registerLogin();
    const b = await registerLogin();
    const orgA = (await mkOrg(a.c)).json.organization.id;
    assert.equal(
      (await b.c.call('GET', `/api/v1/everybody/organizations/${orgA}/subscriptions`)).status,
      404,
    );
    assert.equal(
      (await b.c.call('GET', `/api/v1/everybody/organizations/${orgA}/subscriptions/nonexistent`)).status,
      404,
    );
  });
});