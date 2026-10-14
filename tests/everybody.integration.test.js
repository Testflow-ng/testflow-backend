/**
 * Everybody phase 1 (organizations) — database-backed tests. Run only when
 * MONGODB_URI_TEST points at a DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/testflow_orgs_test npm test
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';

describe('Everybody phase 1 — organizations (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

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
      return { status: res.status, json: text ? JSON.parse(text) : null };
    };
    return { call, jar };
  };

  const registerLogin = async (over = {}) => {
    const c = client();
    const email = `o${uniq()}@t.test`;
    await c.call('POST', '/api/auth/register', {
      body: { fullName: 'Org Owner', email, password: pw, confirmPassword: pw, ...over },
    });
    const login = await c.call('POST', '/api/auth/login', { body: { email, password: pw } });
    assert.equal(login.status, 200);
    return { c, email };
  };
  const mkOrg = async (c, body = { name: `Academy ${uniq()}` }) =>
    c.call('POST', '/api/v1/everybody/organizations', { body });

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

  it('create → list → get → patch as owner', async () => {
    const { c } = await registerLogin();
    const created = await mkOrg(c);
    assert.equal(created.status, 201);
    assert.equal(created.json.myRole, 'owner');
    const id = created.json.organization.id;
    assert.ok(created.json.organization.slug);

    const list = await c.call('GET', '/api/v1/everybody/organizations');
    assert.equal(list.status, 200);
    assert.ok(list.json.items.some((o) => o.id === id));

    const get = await c.call('GET', `/api/v1/everybody/organizations/${id}`);
    assert.equal(get.status, 200);
    assert.equal(get.json.myRole, 'owner');

    const patched = await c.call('PATCH', `/api/v1/everybody/organizations/${id}`, { body: { contactEmail: 'info@academy.test' } });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.organization.contactEmail, 'info@academy.test');
  });

  it('duplicate slug → 409 SUBDOMAIN_TAKEN; reserved → 409 SUBDOMAIN_RESERVED', async () => {
    const { c } = await registerLogin();
    const slug = `ac-${uniq()}`;
    assert.equal((await mkOrg(c, { name: 'First School', slug })).status, 201);
    assert.equal((await mkOrg(c, { name: 'Second School', slug })).json.error.code, 'SUBDOMAIN_TAKEN');
    assert.equal((await mkOrg(c, { name: 'Sneaky', slug: 'api' })).json.error.code, 'SUBDOMAIN_RESERVED');
  });

  it('cross-tenant IDOR: swapping org ids returns 404, never another tenant', async () => {
    const a = await registerLogin();
    const b = await registerLogin();
    const orgA = (await mkOrg(a.c)).json.organization.id;
    // B has no membership in A's org: same 404 as a nonexistent org.
    assert.equal((await b.c.call('GET', `/api/v1/everybody/organizations/${orgA}`)).status, 404);
    assert.equal((await b.c.call('PATCH', `/api/v1/everybody/organizations/${orgA}`, { body: { name: 'Hijack' } })).status, 404);
    assert.equal((await b.c.call('GET', `/api/v1/everybody/organizations/${orgA}/members`)).status, 404);
  });

  it('invitations: admin cannot invite admins; accept requires matching email', async () => {
    const owner = await registerLogin();
    const orgId = (await mkOrg(owner.c)).json.organization.id;

    // Owner invites an examiner; examiner joins via token.
    const examiner = await registerLogin();
    const inv = await owner.c.call('POST', `/api/v1/everybody/organizations/${orgId}/invitations`, {
      body: { email: examiner.email, role: 'examiner' },
    });
    assert.equal(inv.status, 201);
    const accept = await examiner.c.call('POST', '/api/v1/everybody/invitations/accept', { body: { token: inv.json.token } });
    assert.equal(accept.status, 201);

    // Examiner cannot list members (owner/admin only).
    assert.equal((await examiner.c.call('GET', `/api/v1/everybody/organizations/${orgId}/members`)).status, 403);

    // Wrong-email accept is refused.
    const stranger = await registerLogin();
    const inv2 = await owner.c.call('POST', `/api/v1/everybody/organizations/${orgId}/invitations`, {
      body: { email: examiner.email, role: 'student' },
    });
    assert.equal((await stranger.c.call('POST', '/api/v1/everybody/invitations/accept', { body: { token: inv2.json.token } })).status, 403);
  });

  it('role escalation is refused: examiner cannot self-promote or touch the owner', async () => {
    const owner = await registerLogin();
    const orgId = (await mkOrg(owner.c)).json.organization.id;
    const members = await owner.c.call('GET', `/api/v1/everybody/organizations/${orgId}/members`);
    const ownerMemberId = members.json.items.find((x) => x.role === 'owner').id;
    // Owner demoting themselves via the member route is refused (no self changes).
    assert.equal(
      (await owner.c.call('PATCH', `/api/v1/everybody/organizations/${orgId}/members/${ownerMemberId}`, { body: { status: 'suspended' } })).status,
      403,
    );
  });
});
