/**
 * Centralized identity — database-backed tests. Run only when MONGODB_URI_TEST
 * points at a DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/testflow_identity_test npm test
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';
process.env.AUTH_CLIENTS = JSON.stringify([{ id: 'partner', redirectUris: ['https://partner.example/callback'] }]);

describe('Centralized identity (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  /** Minimal cookie jar. Each call gets a unique X-Forwarded-For so shared rate limits never interfere. */
  const client = () => {
    const jar = {};
    const call = async (method, path, { body, headers, csrf = true, origin } = {}) => {
      const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.${(n += 1) % 250}.${Math.floor(n / 250)}`, ...headers };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.Cookie = cookie;
      if (csrf && jar.tf_csrf) h['X-CSRF-Token'] = jar.tf_csrf;
      if (origin) h.Origin = origin;
      const res = await fetch(`${base}/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (!value || /expires=Thu, 01 Jan 1970/i.test(c)) delete jar[name]; else jar[name] = value;
      }
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null, cookies: res.headers.getSetCookie() };
    };
    return { call, jar };
  };

  const account = async (product = 'student', over = {}) => {
    const email = `u${uniq()}@t.test`;
    const body = { fullName: 'Test User', email, password: pw, confirmPassword: pw, product, ...(product === 'ads' ? { profile: { businessName: 'Biz Ltd' } } : {}), ...over };
    const c = client();
    const reg = await c.call('POST', '/auth/register', { body });
    return { c, email, reg };
  };
  const signIn = async (c, email, product) => c.call('POST', '/auth/login', { body: { email, password: pw, ...(product ? { product } : {}) } });

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = {
      mongoose,
      User: (await import('../src/models/User.js')).User,
      AuditLog: (await import('../src/models/AuditLog.js')).AuditLog,
      AdvertiserProfile: (await import('../src/models/AdvertiserProfile.js')).AdvertiserProfile,
      tokens: await import('../src/utils/tokens.js'),
      migrate: await import('../src/scripts/migrate-memberships.js'),
    };
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

  it('one account per email: registering for another product with a used email is refused with a join hint', async () => {
    const { email, reg } = await account('student');
    assert.equal(reg.status, 201);
    assert.deepEqual(reg.json.memberships.map((x) => x.product), ['student']);
    const again = await client().call('POST', '/auth/register', { body: { fullName: 'X Y', email, password: pw, confirmPassword: pw, product: 'ads', profile: { businessName: 'Biz' } } });
    assert.equal(again.status, 409);
    assert.equal(again.json.error.code, 'EMAIL_TAKEN');
    assert.equal(again.json.error.details.canJoin, true);
    const noBiz = await client().call('POST', '/auth/register', { body: { fullName: 'X Y', email: `n${uniq()}@t.test`, password: pw, confirmPassword: pw, product: 'ads' } });
    assert.equal(noBiz.status, 422);
  });

  it('everybody: organizationName is required; membership, profile, login gate, join and switch all work', async () => {
    const noName = await client().call('POST', '/auth/register', { body: { fullName: 'Org Owner', email: `o${uniq()}@t.test`, password: pw, confirmPassword: pw, product: 'everybody' } });
    assert.equal(noName.status, 422);
    assert.ok(noName.json.error.fields['profile.organizationName']);
    const { c, email, reg } = await account('everybody', { profile: { organizationName: 'Advance Academy' } });
    assert.equal(reg.status, 201);
    assert.deepEqual(reg.json.memberships.map((x) => [x.product, x.role]), [['everybody', 'organizer']]);
    const ok = await signIn(c, email, 'everybody');
    assert.equal(ok.status, 200); assert.equal(ok.json.activeProduct, 'everybody');
    assert.equal(ok.json.profiles.everybody.organizationName, 'Advance Academy');
    assert.equal((await signIn(c, email, 'student')).json.error.code, 'NO_MEMBERSHIP');
    // a student account has no everybody membership
    const stud = await account('student');
    const denied = await signIn(stud.c, stud.email, 'everybody');
    assert.equal(denied.status, 403); assert.deepEqual(denied.json.error.details, { product: 'everybody', canJoin: true });
    await signIn(stud.c, stud.email);
    assert.equal((await stud.c.call('POST', '/auth/memberships', { body: { product: 'everybody' } })).status, 422);
    const joined = await stud.c.call('POST', '/auth/memberships', { body: { product: 'everybody', profile: { organizationName: 'Joined Org' } } });
    assert.equal(joined.status, 201);
    assert.deepEqual(joined.json.memberships.map((x) => x.product).sort(), ['everybody', 'student']);
    assert.equal(joined.json.profiles.everybody.organizationName, 'Joined Org');
    assert.equal((await stud.c.call('POST', '/auth/switch-product', { body: { product: 'everybody' } })).json.activeProduct, 'everybody');
    assert.equal((await stud.c.call('GET', '/auth/me')).json.activeProduct, 'everybody');
  });

  it('login: sets session + CSRF cookies, returns memberships/profiles; wrong product → 403 NO_MEMBERSHIP (no session)', async () => {
    const { c, email } = await account('student');
    const denied = await signIn(c, email, 'ads');
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error.code, 'NO_MEMBERSHIP');
    assert.deepEqual(denied.json.error.details, { product: 'ads', canJoin: true });
    assert.equal(denied.cookies.length, 0);
    assert.equal(c.jar.tf_access, undefined);

    const ok = await signIn(c, email, 'student');
    assert.equal(ok.status, 200);
    assert.equal(ok.json.activeProduct, 'student');
    assert.ok(ok.json.profiles.student);
    assert.ok(ok.json.csrfToken && ok.json.csrfToken === c.jar.tf_csrf);
    const flags = ok.cookies.find((x) => x.startsWith('tf_access'));
    assert.match(flags, /HttpOnly/i); assert.match(flags, /SameSite=Lax/i);
    assert.doesNotMatch(ok.cookies.find((x) => x.startsWith('tf_csrf')), /HttpOnly/i);
    const me = await c.call('GET', '/auth/me');
    assert.equal(me.json.memberships[0].product, 'student');
    assert.equal(me.json.user.email, email);
  });

  it('unknown email and wrong password are indistinguishable', async () => {
    const { email } = await account('student');
    const a = await client().call('POST', '/auth/login', { body: { email, password: 'WrongPass123' } });
    const b = await client().call('POST', '/auth/login', { body: { email: `nobody${uniq()}@t.test`, password: 'WrongPass123' } });
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    assert.deepEqual(a.json, b.json);
  });

  it('forgot-password answers identically and never faster than the floor for known/unknown emails', async () => {
    const { email } = await account('student');
    const t1 = Date.now(); const known = await client().call('POST', '/auth/forgot-password', { body: { email } }); const d1 = Date.now() - t1;
    const t2 = Date.now(); const unknown = await client().call('POST', '/auth/forgot-password', { body: { email: `no${uniq()}@t.test` } }); const d2 = Date.now() - t2;
    assert.deepEqual(known.json, unknown.json);
    assert.ok(d1 >= 380 && d2 >= 380, `${d1}/${d2}`);
  });

  it('add a product to an existing account (session or email+password), atomically; switch context without signing out', async () => {
    const { c, email } = await account('student');
    await signIn(c, email);
    assert.equal((await c.call('POST', '/auth/switch-product', { body: { product: 'ads' } })).json.error.code, 'NO_MEMBERSHIP');

    const noProfile = await c.call('POST', '/auth/memberships', { body: { product: 'ads' } });
    assert.equal(noProfile.status, 422);
    const results = await Promise.all([1, 2, 3].map(() => c.call('POST', '/auth/memberships', { body: { product: 'ads', profile: { businessName: 'Biz' } } })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.every((r) => [201, 409].includes(r.status)));
    const user = await m.User.findOne({ email });
    assert.deepEqual(user.memberships.map((x) => x.product).sort(), ['ads', 'student']);
    assert.equal(await m.AdvertiserProfile.countDocuments({ user: user._id }), 1);

    const sw = await c.call('POST', '/auth/switch-product', { body: { product: 'ads' } });
    assert.equal(sw.status, 200); assert.equal(sw.json.activeProduct, 'ads');
    assert.equal((await c.call('GET', '/auth/me')).json.activeProduct, 'ads'); // same session, new context
    assert.equal((await c.call('GET', '/ads/auth/me')).status, 200);

    // Without a session: prove ownership with email + password.
    const other = await account('student');
    const joined = await client().call('POST', '/auth/memberships', { body: { product: 'ads', profile: { businessName: 'B2' }, email: other.email, password: pw } });
    assert.equal(joined.status, 201);
    assert.equal((await client().call('POST', '/auth/memberships', { body: { product: 'ads', profile: { businessName: 'B2' }, email: other.email, password: 'bad-password1' } })).status, 401);
  });

  it('product access follows memberships (student routes, ads routes, admin stays separate)', async () => {
    const adsOnly = await account('ads'); await signIn(adsOnly.c, adsOnly.email);
    const studentOnly = await account('student'); await signIn(studentOnly.c, studentOnly.email);
    assert.equal((await adsOnly.c.call('GET', '/ads/dashboard')).status, 200);
    assert.equal((await studentOnly.c.call('GET', '/ads/dashboard')).json.error.code, 'NO_MEMBERSHIP');
    assert.equal((await adsOnly.c.call('POST', '/ads/serve', { body: { sessionType: 'exam', sessionId: '507f1f77bcf86cd799439011' } })).json.error.code, 'NO_MEMBERSHIP');
    assert.equal((await adsOnly.c.call('GET', '/admin/stats')).status, 403);
    // ads-only accounts are not counted as students
    const { studentQuery } = await import('../src/utils/identity.js');
    assert.equal(await m.User.countDocuments({ email: adsOnly.email, ...studentQuery() }), 0);
    assert.equal(await m.User.countDocuments({ email: studentOnly.email, ...studentQuery() }), 1);
  });

  it('legacy ads wrappers keep their shape; legacy un-migrated advertisers still work', async () => {
    const c = client();
    const email = `adv${uniq()}@t.test`;
    const reg = await c.call('POST', '/ads/auth/register', { body: { fullName: 'Ad Vertiser', email, password: pw, confirmPassword: pw, businessName: 'Legacy Biz' } });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.profile.businessName, 'Legacy Biz'); assert.ok(reg.json.user); assert.equal(reg.json.activeProduct, 'ads');
    assert.equal((await c.call('GET', '/ads/auth/me')).json.profile.businessName, 'Legacy Biz');
    assert.equal((await c.call('GET', '/ads/campaigns')).status, 200);

    const stud = await account('student');
    const denied = await client().call('POST', '/ads/auth/login', { body: { email: stud.email, password: pw } });
    assert.equal(denied.status, 403); assert.equal(denied.json.error.code, 'NO_MEMBERSHIP');

    // pre-migration row: role 'advertiser', no memberships
    const legacyEmail = `legacy${uniq()}@t.test`;
    await m.User.create({ fullName: 'Legacy', email: legacyEmail, passwordHash: pw, role: 'advertiser', isEmailVerified: true });
    const lc = client(); const li = await lc.call('POST', '/ads/auth/login', { body: { email: legacyEmail, password: pw } });
    assert.equal(li.status, 200);
    assert.equal((await lc.call('GET', '/ads/dashboard')).status, 200);
  });

  it('CSRF: foreign Origin is always refused; token required for cookie sessions in enforce mode; login exempt', async () => {
    const { c, email } = await account('student');
    assert.equal((await c.call('POST', '/auth/login', { body: { email, password: pw }, origin: 'https://evil.example' })).json.error.code, 'CSRF_ORIGIN');
    await signIn(c, email);
    assert.equal((await c.call('POST', '/auth/switch-product', { body: { product: 'student' }, csrf: false })).json.error.code, 'CSRF_TOKEN');
    assert.equal((await c.call('POST', '/auth/switch-product', { body: { product: 'student' }, headers: { 'X-CSRF-Token': 'wrong' }, csrf: false })).status, 403);
    assert.equal((await c.call('POST', '/auth/switch-product', { body: { product: 'student' } })).status, 200);
    assert.equal((await c.call('POST', '/auth/switch-product', { body: { product: 'student' }, origin: 'https://evil.example' })).json.error.code, 'CSRF_ORIGIN');
    assert.equal((await c.call('POST', '/auth/login', { body: { email, password: pw }, csrf: false })).status, 200); // re-login with stale cookies
    assert.equal((await c.call('GET', '/auth/me', { csrf: false })).status, 200); // safe methods need no token
  });

  it('password reset signs out EVERY session on every device', async () => {
    const { c: a, email } = await account('student');
    await signIn(a, email);
    const b = client(); await signIn(b, email);
    assert.equal((await a.call('GET', '/auth/me')).status, 200);
    const token = m.tokens.generateToken();
    await m.User.updateOne({ email }, { $set: { passwordResetTokenHash: m.tokens.hashToken(token), passwordResetExpires: new Date(Date.now() + 60000) } });
    const reset = await client().call('POST', '/auth/reset-password', { body: { token, password: 'NewPassw0rd1' } });
    assert.equal(reset.status, 200);
    assert.equal((await a.call('GET', '/auth/me')).status, 401);
    assert.equal((await b.call('GET', '/auth/me')).status, 401);
    assert.equal((await b.call('POST', '/auth/refresh', { csrf: false })).status, 401);
    assert.equal((await client().call('POST', '/auth/login', { body: { email, password: pw } })).status, 401); // old password dead
    assert.equal((await client().call('POST', '/auth/login', { body: { email, password: 'NewPassw0rd1' } })).status, 200);
  });

  it('audit log records register, login (ok/failed/no-membership), membership, switch and reset', async () => {
    const { c, email } = await account('student');
    await client().call('POST', '/auth/login', { body: { email, password: 'WrongPass123' } });
    await signIn(c, email, 'ads').catch(() => {});
    await signIn(c, email);
    await c.call('POST', '/auth/memberships', { body: { product: 'ads', profile: { businessName: 'B' } } });
    await c.call('POST', '/auth/switch-product', { body: { product: 'ads' } });
    const user = await m.User.findOne({ email });
    for (const action of ['AUTH_REGISTER', 'AUTH_LOGIN', 'MEMBERSHIP_ADD', 'PRODUCT_SWITCH']) {
      assert.ok(await m.AuditLog.findOne({ actor: user._id, action }), action);
    }
    assert.ok(await m.AuditLog.findOne({ action: 'AUTH_LOGIN_FAILED', 'metadata.emailHash': { $exists: true } }));
    assert.ok(await m.AuditLog.findOne({ actor: user._id, action: 'AUTH_LOGIN_FAILED', 'metadata.reason': 'NO_MEMBERSHIP' }));
    // never store the raw email or password in audit metadata
    const dump = JSON.stringify(await m.AuditLog.find({ action: 'AUTH_LOGIN_FAILED' }).lean());
    assert.equal(dump.includes(email), false); assert.equal(dump.includes('WrongPass123'), false);
  });

  describe('code + PKCE exchange for other domains', () => {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authz = (c, over = {}) => c.call('POST', '/auth/oauth/authorize', {
      body: { clientId: 'partner', redirectUri: 'https://partner.example/callback', codeChallenge: challenge, codeChallengeMethod: 'S256', state: 'xyz', ...over },
    });
    const exchange = (code, over = {}) => client().call('POST', '/auth/oauth/token', {
      body: { grantType: 'authorization_code', code, codeVerifier: verifier, clientId: 'partner', redirectUri: 'https://partner.example/callback', ...over },
    });
    const codeFrom = (res) => new URL(res.json.redirectTo).searchParams.get('code');

    it('happy path: bearer token works without cookies; the code is single-use', async () => {
      const { c, email } = await account('student'); await signIn(c, email);
      const a = await authz(c);
      assert.equal(a.status, 200);
      const url = new URL(a.json.redirectTo);
      assert.equal(url.origin + url.pathname, 'https://partner.example/callback'); assert.equal(url.searchParams.get('state'), 'xyz');
      const code = codeFrom(a);
      const t = await exchange(code);
      assert.equal(t.status, 200); assert.equal(t.json.tokenType, 'Bearer'); assert.ok(t.json.expiresIn > 0);
      const me = await client().call('GET', '/auth/me', { headers: { Authorization: `Bearer ${t.json.accessToken}` } });
      assert.equal(me.json.user.email, email);
      const post = await client().call('POST', '/auth/switch-product', { body: { product: 'student' }, headers: { Authorization: `Bearer ${t.json.accessToken}` } });
      assert.equal(post.status, 200); // bearer calls are not subject to the cookie CSRF token
      assert.equal((await exchange(code)).json.error.code, 'INVALID_GRANT'); // replay
    });
    it('wrong verifier burns the code; wrong client/redirect rejected; unknown client/redirect refused at authorize', async () => {
      const { c, email } = await account('student'); await signIn(c, email);
      const code = codeFrom(await authz(c));
      assert.equal((await exchange(code, { codeVerifier: crypto.randomBytes(48).toString('base64url') })).json.error.code, 'INVALID_GRANT');
      assert.equal((await exchange(code)).json.error.code, 'INVALID_GRANT'); // already burned
      const code2 = codeFrom(await authz(c));
      assert.equal((await exchange(code2, { redirectUri: 'https://partner.example/other' })).status, 400);
      assert.equal((await authz(c, { redirectUri: 'https://partner.example/callback/../evil' })).json.error.code, 'INVALID_REDIRECT_URI');
      assert.equal((await authz(c, { redirectUri: 'https://evil.example/callback' })).json.error.code, 'INVALID_REDIRECT_URI');
      assert.equal((await authz(c, { clientId: 'nope' })).json.error.code, 'INVALID_CLIENT');
      assert.equal((await authz(c, { product: 'ads' })).json.error.code, 'NO_MEMBERSHIP');
      assert.equal((await client().call('POST', '/auth/oauth/authorize', { body: { clientId: 'partner', redirectUri: 'https://partner.example/callback', codeChallenge: challenge, codeChallengeMethod: 'S256' } })).status, 401);
    });
    it('expired codes are refused and bearer tokens die on password reset', async () => {
      const { c, email } = await account('student'); await signIn(c, email);
      const code = codeFrom(await authz(c));
      const { AuthCode } = await import('../src/models/AuthCode.js');
      await AuthCode.updateMany({}, { $set: { expireAt: new Date(Date.now() - 1000) } });
      assert.equal((await exchange(code)).json.error.code, 'INVALID_GRANT');
      const fresh = await exchange(codeFrom(await authz(c)));
      const token = m.tokens.generateToken();
      await m.User.updateOne({ email }, { $set: { passwordResetTokenHash: m.tokens.hashToken(token), passwordResetExpires: new Date(Date.now() + 60000) } });
      await client().call('POST', '/auth/reset-password', { body: { token, password: 'NewPassw0rd1' } });
      assert.equal((await client().call('GET', '/auth/me', { headers: { Authorization: `Bearer ${fresh.json.accessToken}` } })).status, 401);
    });
  });

  it('migration: dry-run writes nothing; apply creates memberships; re-run is a no-op; admins untouched', async () => {
    const mk = (over) => m.User.collection.insertOne({ fullName: 'L', email: `l${uniq()}@t.test`, passwordHash: 'x', isEmailVerified: true, createdAt: new Date(), updatedAt: new Date(), ...over });
    const s = await mk({ role: 'student' }); const a = await mk({ role: 'advertiser' }); const adm = await mk({ role: 'admin' });
    const unverified = await mk({ role: 'student', isEmailVerified: false });
    await m.AdvertiserProfile.create({ user: unverified.insertedId, businessName: 'U' });

    const dry = await m.migrate.runMigration({ dryRun: true });
    assert.equal(dry.dryRun, true); assert.ok(dry.migrated >= 2);
    assert.equal((await m.User.findById(s.insertedId).lean()).memberships?.length ?? 0, 0);

    const real = await m.migrate.runMigration({ dryRun: false });
    assert.ok(real.migrated >= 2);
    assert.deepEqual((await m.User.findById(s.insertedId).lean()).memberships.map((x) => x.product), ['student']);
    const adv = await m.User.findById(a.insertedId).lean();
    assert.deepEqual(adv.memberships.map((x) => x.product), ['ads']); assert.equal(adv.role, 'student');
    assert.equal((await m.User.findById(adm.insertedId).lean()).memberships.length, 0);
    assert.deepEqual((await m.User.findById(unverified.insertedId).lean()).memberships.map((x) => x.product), ['student']); // ads NOT linked: email unverified
    assert.ok(real.review.some((r) => r.id === String(unverified.insertedId)));

    const again = await m.migrate.runMigration({ dryRun: false });
    assert.equal(again.migrated, 0);
  });
});
