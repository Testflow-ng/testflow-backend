/**
 * Everybody — students are added by the organisation, not self-registered.
 *
 * Run only when MONGODB_URI_TEST points at a DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/tf_org_students_test node --test tests/orgStudents.integration.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.RESEND_API_KEY = ''; // tests never send real email
process.env.SMTP_HOST = '';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';
delete process.env.TENANT_SELF_SIGNUP;
process.env.GOOGLE_CLIENT_ID = 'id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:5001/api/auth/google/callback';

describe('Everybody — the organisation adds its students (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  const client = (defaultHeaders = {}) => {
    const jar = {};
    const call = async (method, path, body) => {
      n += 1;
      const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.8.${n % 250}.${Math.floor(n / 250)}`, ...defaultHeaders };
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
    assert.equal((await c.call('POST', '/api/auth/register', { fullName: 'Org Owner', email, password: pw, confirmPassword: pw })).status, 201);
    assert.equal((await c.call('POST', '/api/auth/login', { email, password: pw })).status, 200);
    const org = await c.call('POST', '/api/v1/everybody/organizations', { name: `Academy ${uniq()}` });
    assert.equal(org.status, 201, JSON.stringify(org.json));
    return { c, orgId: org.json.organization.id, slug: org.json.organization.slug };
  };

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

  it('anyone can sign up on an organisation site; the organisation can suspend and reinstate them', async () => {
    const { c, orgId, slug } = await ownerWithOrg();
    const t = client({ 'X-Tenant-Host': `${slug}.testflow.com.ng` });
    const email = `w${uniq()}@t.test`;
    const reg = await t.call('POST', '/api/v1/public/auth/register', { fullName: 'Walk In', email, password: pw });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));

    const list = await c.call('GET', `/api/v1/everybody/organizations/${orgId}/students`);
    const row = list.json.items.find((i) => i.email === email);
    assert.equal(row.status, 'active');

    const path = `/api/v1/everybody/organizations/${orgId}/students/${row.id}`;
    assert.equal((await c.call('PATCH', path, { status: 'suspended' })).status, 200);
    const blocked = await client({ 'X-Tenant-Host': `${slug}.testflow.com.ng` }).call('POST', '/api/v1/public/auth/login', { email, password: pw });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error.code, 'ACCOUNT_SUSPENDED');
    const shown = await c.call('GET', `/api/v1/everybody/organizations/${orgId}/students`);
    assert.equal(shown.json.items.find((i) => i.email === email).status, 'suspended');

    assert.equal((await c.call('PATCH', path, { status: 'active' })).status, 200);
    const back = await client({ 'X-Tenant-Host': `${slug}.testflow.com.ng` }).call('POST', '/api/v1/public/auth/login', { email, password: pw });
    assert.equal(back.status, 200);
  });

  it('the Google start redirects to Google and refuses an unknown organisation site', async () => {
    const { slug } = await ownerWithOrg();
    const ok = await fetch(`${base}/api/auth/google?host=${slug}.testflow.com.ng`, { redirect: 'manual' });
    assert.equal(ok.status, 302);
    assert.match(ok.headers.get('location'), /^https:\/\/accounts\.google\.com\//);
    const none = await fetch(`${base}/api/auth/google?host=nobody-here.testflow.com.ng`, { redirect: 'manual' });
    assert.equal(none.status, 404);
  });

  it('Log in with Testflow: authorize, hand back to the org site, redeem with the verifier', async () => {
    const { setClientsForTests } = await import('../src/services/oauth.service.js');
    const redirectUri = 'http://localhost:5001/api/auth/testflow/callback';
    setClientsForTests([{ id: 'testflow-everyone', redirectUris: [redirectUri] }]);
    const { slug } = await ownerWithOrg();
    const host = `${slug}.testflow.com.ng`;
    const person = client();
    const email = `p${uniq()}@t.test`;
    await person.call('POST', '/api/auth/register', { fullName: 'Plain Student', email, password: pw, confirmPassword: pw });
    await person.call('POST', '/api/auth/login', { email, password: pw });

    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = Buffer.from(JSON.stringify({ n: 'x', o: 'http://localhost:5173' })).toString('base64url');
    const before = await person.call('GET', `/api/auth/testflow/consent?state=${state}`);
    assert.equal(before.status, 200, JSON.stringify(before.json));
    assert.equal(before.json.granted, false);
    const auth = await person.call('POST', '/api/auth/oauth/authorize', { clientId: 'testflow-everyone', redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256', state });
    assert.equal(auth.status, 200, JSON.stringify(auth.json));
    assert.equal((await person.call('GET', `/api/auth/testflow/consent?state=${state}`)).json.granted, true);
    const code = new URL(auth.json.redirectTo).searchParams.get('code');

    const hop = await fetch(`${base}/api/auth/testflow/callback?code=${code}&state=${state}`, { redirect: 'manual' });
    assert.equal(hop.status, 302);
    assert.match(hop.headers.get('location'), /^http:\/\/localhost:5173\/auth\/testflow\?code=/);
    const evil = Buffer.from(JSON.stringify({ n: 'x', o: 'https://evil.example' })).toString('base64url');
    const refused = await fetch(`${base}/api/auth/testflow/callback?code=${code}&state=${evil}`, { redirect: 'manual' });
    assert.match(refused.headers.get('location'), /error=testflow_failed/);

    const t = client({ 'X-Tenant-Host': host });
    const bad = await t.call('POST', '/api/v1/public/auth/testflow/complete', { code, codeVerifier: crypto.randomBytes(48).toString('base64url'), redirectUri });
    assert.equal(bad.status, 400);
    const code2 = new URL((await person.call('POST', '/api/auth/oauth/authorize', { clientId: 'testflow-everyone', redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256', state })).json.redirectTo).searchParams.get('code');
    const ok = await t.call('POST', '/api/v1/public/auth/testflow/complete', { code: code2, codeVerifier: verifier, redirectUri });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal((await t.call('GET', '/api/v1/public/auth/me')).status, 200);
  });

  it('the organisation site and Testflow keep separate sessions', async () => {
    const { slug } = await ownerWithOrg();
    const both = client({ 'X-Tenant-Host': `${slug}.testflow.com.ng` });
    const email = `s${uniq()}@t.test`;
    await both.call('POST', '/api/auth/register', { fullName: 'Two Sessions', email, password: pw, confirmPassword: pw });
    assert.equal((await both.call('POST', '/api/auth/login', { email, password: pw })).status, 200);
    assert.equal((await both.call('POST', '/api/v1/public/auth/login', { email, password: pw })).status, 200);
    assert.equal((await both.call('GET', '/api/v1/public/auth/me')).status, 200);

    // Signing out of the organisation site leaves Testflow signed in.
    assert.equal((await both.call('POST', '/api/v1/public/auth/logout')).status, 204);
    assert.equal((await both.call('GET', '/api/v1/public/auth/me')).status, 401);
    assert.equal((await both.call('GET', '/api/auth/me')).status, 200);

    // And signing out of Testflow (which revokes its tokens) leaves the organisation site signed in.
    assert.equal((await both.call('POST', '/api/v1/public/auth/login', { email, password: pw })).status, 200);
    assert.equal((await both.call('POST', '/api/auth/logout')).status, 204);
    assert.equal((await both.call('GET', '/api/v1/public/auth/me')).status, 200);
    assert.equal((await both.call('POST', '/api/v1/public/auth/refresh')).status, 200);
  });

  it('a Google handoff code signs the person in once, and only on its own site', async () => {
    const { slug } = await ownerWithOrg();
    const { User } = await import('../src/models/User.js');
    const { AuthCode } = await import('../src/models/AuthCode.js');
    const user = await User.create({ fullName: 'G Person', email: `g${uniq()}@t.test`, passwordHash: pw, isEmailVerified: true, tokenVersion: 3 });
    const host = `${slug}.testflow.com.ng`;
    const make = async (h) => {
      const code = crypto.randomBytes(32).toString('base64url');
      await AuthCode.create({ codeHash: crypto.createHash('sha256').update(code).digest('hex'), user: user._id, clientId: 'tenant-handoff', redirectUri: h, codeChallenge: 'none', expireAt: new Date(Date.now() + 60000) });
      return code;
    };
    const t = client({ 'X-Tenant-Host': host });
    const good = await make(host);
    assert.equal((await t.call('POST', '/api/v1/public/auth/google/complete', { code: good })).status, 200);
    assert.equal((await t.call('GET', '/api/v1/public/auth/me')).status, 200, 'the session works even for an account that has signed out before');
    assert.equal((await t.call('POST', '/api/v1/public/auth/google/complete', { code: good })).status, 400);
    const other = await make('someone-else.testflow.com.ng');
    assert.equal((await client({ 'X-Tenant-Host': host }).call('POST', '/api/v1/public/auth/google/complete', { code: other })).status, 400);
  });

  it('adding emails creates students, links existing accounts and skips repeats', async () => {
    const { c, orgId } = await ownerWithOrg();
    const { User } = await import('../src/models/User.js');
    const { OrgMembership } = await import('../src/models/OrgMembership.js');
    const fresh = `new${uniq()}@t.test`;
    const existing = `old${uniq()}@t.test`;
    await User.create({ fullName: 'Old Timer', email: existing, passwordHash: pw, isEmailVerified: true });

    const path = `/api/v1/everybody/organizations/${orgId}/students`;
    const res = await c.call('POST', path, { emails: [fresh, existing, fresh.toUpperCase()] });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const status = Object.fromEntries(res.json.results.map((r) => [r.email, r.status]));
    assert.equal(status[fresh], 'added');
    assert.equal(status[existing], 'linked');
    assert.equal(res.json.results.length, 2);

    const created = await User.findOne({ email: fresh }).select('+passwordResetTokenHash');
    assert.ok(created.passwordResetTokenHash, 'a set-password link was issued');
    assert.equal(await OrgMembership.countDocuments({ organization: orgId, role: 'student', status: 'active' }), 2);

    const again = await c.call('POST', path, { emails: [fresh, existing] });
    assert.deepEqual(again.json.results.map((r) => r.status), ['already', 'already']);
  });

  it('only the organisation staff can add students', async () => {
    const { orgId } = await ownerWithOrg();
    const other = client();
    const email = `x${uniq()}@t.test`;
    await other.call('POST', '/api/auth/register', { fullName: 'Other Person', email, password: pw, confirmPassword: pw });
    await other.call('POST', '/api/auth/login', { email, password: pw });
    const res = await other.call('POST', `/api/v1/everybody/organizations/${orgId}/students`, { emails: [`s${uniq()}@t.test`] });
    assert.ok([403, 404].includes(res.status), String(res.status));
  });
});
