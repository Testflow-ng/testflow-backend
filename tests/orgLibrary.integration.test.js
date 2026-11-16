/**
 * The organisation's own Library: the console's file upload, and the student shelf, download and
 * one-time purchase.
 *
 * Run only when MONGODB_URI_TEST points at a DISPOSABLE database (it is dropped at the end):
 *   node --env-file=.env.test --test tests/orgLibrary.integration.test.js
 *
 * The rules this file protects:
 *  - Only a PDF is accepted, and the type is decided by the bytes, not the file name.
 *  - A member sees the shelf; nobody else does, even with a session from another organisation.
 *  - A published row with legacy `group` visibility is never served to students.
 *  - A priced book is listed as locked and 402s on download until a verified payment exists.
 *  - A file URL only ever comes from the gated download, and `fileKey` never appears in a response.
 */
process.env.NODE_ENV = 'test';
process.env.TRIAL_DISABLED = 'true';
process.env.RESEND_API_KEY = '';
process.env.SMTP_HOST = '';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';
process.env.TENANT_SELF_SIGNUP = 'true';
// Fake R2 credentials so the download path signs a real URL; writes go to an in-process fake.
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET = 'testflow-org-library';
process.env.R2_PUBLIC_URL = 'https://cdn.example.test';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

describe('Organisation Library: upload, student shelf, download and paid books (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;
  let fakeState;
  let stored;
  let orgA; let orgB;
  let ownerA; let ownerB;
  let studentA; let studentB;
  let freeBook; let paidBook; let draftBook;

  /** A cookie-jar client. `defaultHeaders` lets a tenant client carry `X-Tenant-Host`. */
  const client = (defaultHeaders = {}, jar = {}) => {
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
      n += 1;
      const h = { 'X-Forwarded-For': `10.11.${n % 250}.${Math.floor(n / 250)}`, ...defaultHeaders, ...extra };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.Cookie = cookie;
      if (jar.tfo_csrf || jar.tf_csrf) h['X-CSRF-Token'] = jar.tfo_csrf || jar.tf_csrf;
      return h;
    };
    const parse = async (res) => {
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null, text };
    };
    return {
      jar,
      callRaw: async (method, path, { body, headers: extra } = {}) => {
        const res = await fetch(`${base}${path}`, { method, headers: headers(extra), body });
        absorb(res);
        return parse(res);
      },
      call: async (method, path, { body, headers: extra } = {}) => {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: headers({ 'Content-Type': 'application/json', ...extra }),
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        absorb(res);
        return parse(res);
      },
    };
  };

  const tenantClient = (slug, jar) => client({ 'X-Tenant-Host': `${slug}.testflow.com.ng` }, jar);

  const registerLogin = async () => {
    const c = client();
    const email = `libo${uniq()}@t.test`;
    const reg = await c.call('POST', '/api/auth/register', {
      body: { fullName: 'Shelf Owner', email, password: pw, confirmPassword: pw },
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    const login = await c.call('POST', '/api/auth/login', { body: { email, password: pw } });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    return { c, email };
  };

  const mkOrg = async (c) => {
    const created = await c.call('POST', '/api/v1/everybody/organizations', { body: { name: `Shelf ${uniq()}` } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    return { id: created.json.organization.id, slug: created.json.organization.slug };
  };

  const activatePayout = async (orgId) => {
    const { Organization } = await import('../src/models/Organization.js');
    await Organization.updateOne(
      { _id: orgId },
      { $set: { 'payout.status': 'active', 'payout.subaccountCode': 'ACCT_test', 'payout.accountName': 'Shelf Org' } },
    );
  };

  const registerStudent = async (slug) => {
    const t = tenantClient(slug);
    const email = `libs${uniq()}@t.test`;
    const res = await t.call('POST', '/api/v1/public/auth/register', {
      body: { fullName: 'Shelf Student', email, password: pw },
    });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return { t, email };
  };

  const createBook = async (c, orgId, body) => {
    const res = await c.call('POST', `/api/v1/everybody/organizations/${orgId}/library/books`, { body });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.json.book;
  };

  const uploadPdf = async (c, orgId, bookId, { bytes = PDF, name = 'book.pdf' } = {}) => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), name);
    return c.callRaw('POST', `/api/v1/everybody/organizations/${orgId}/library/books/${bookId}/file`, { body: form });
  };

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = { mongoose, User: (await import('../src/models/User.js')).User };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));

    const { seedPlans } = await import('../src/scripts/seed-plans.js');
    await seedPlans();

    stored = new Map();
    const { setR2ForTests } = await import('../src/utils/r2.js');
    setR2ForTests({
      putObject: async (key, body, contentType) => { stored.set(key, { body, contentType }); },
      deleteObject: async (key) => { stored.delete(key); },
    });

    const { setOrgPaystackForTests } = await import('../src/services/orgPaystack.service.js');
    fakeState = { paid: new Set(), amountKobo: 0, signature: 'test-signature', lastSubaccount: null };
    setOrgPaystackForTests({
      initialize: async ({ reference, subaccount }) => {
        fakeState.lastSubaccount = subaccount;
        return { authorizationUrl: `https://pay.test/${reference}` };
      },
      verify: async (reference) => (fakeState.paid.has(reference)
        ? { status: 'success', amountKobo: fakeState.amountKobo, currency: 'NGN', transactionId: `tx_${reference}`, paidAt: new Date() }
        : { status: 'pending' }),
      refund: async () => ({ refundId: 'ref_test', status: 'processed' }),
      verifyWebhookSignature: (_raw, signature) => signature === fakeState.signature,
      parseWebhook: (body) => ({ type: body?.event, reference: body?.data?.reference, eventId: null, refundReference: null }),
    });

    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;

    // Two organisations, so cross-tenant isolation is real rather than assumed.
    ownerA = await registerLogin();
    orgA = await mkOrg(ownerA.c);
    ownerB = await registerLogin();
    orgB = await mkOrg(ownerB.c);
    studentA = await registerStudent(orgA.slug);
    studentB = await registerStudent(orgB.slug);

    freeBook = await createBook(ownerA.c, orgA.id, { title: 'Free Physics Notes', code: 'PHY100', priceMinor: 0 });
    await activatePayout(orgA.id);
    paidBook = await createBook(ownerA.c, orgA.id, { title: 'Premium Chemistry', code: 'CHM200', priceMinor: 50_000 });
    const paidUpload = await uploadPdf(ownerA.c, orgA.id, paidBook.id, { name: 'premium.pdf' });
    assert.equal(paidUpload.status, 201, JSON.stringify(paidUpload.json));
    draftBook = await createBook(ownerA.c, orgA.id, { title: 'Draft Book', published: false });
    await createBook(ownerB.c, orgB.id, { title: 'Other Org Book' });
  });

  after(async () => {
    const { setR2ForTests } = await import('../src/utils/r2.js');
    setR2ForTests(null);
    if (server) await new Promise((r) => server.close(r));
    if (m?.mongoose) {
      await m.mongoose.connection.dropDatabase();
      await m.mongoose.disconnect();
    }
  });

  it('uploads a PDF by its bytes and reports the file on the console view', async () => {
    const missing = await uploadPdf(ownerA.c, orgA.id, freeBook.id, { bytes: Buffer.from('not a pdf at all') });
    assert.equal(missing.status, 422, JSON.stringify(missing.json));
    assert.equal(missing.json.error.code, 'UNSUPPORTED_TYPE');

    const up = await uploadPdf(ownerA.c, orgA.id, freeBook.id);
    assert.equal(up.status, 201, JSON.stringify(up.json));
    assert.equal(up.json.book.hasFile, true);
    assert.equal(up.json.book.fileName, 'book.pdf');
    assert.ok(!('fileKey' in up.json.book), 'the storage key is never serialised');

    const rows = await ownerA.c.call('GET', `/api/v1/everybody/organizations/${orgA.id}/library/books`);
    const view = rows.json.items.find((b) => b.id === freeBook.id);
    assert.equal(view.hasFile, true);
    assert.ok([...stored.keys()].some((key) => key.startsWith(`org/${orgA.id}/library/`) && key.endsWith('.pdf')));
  });

  it('serves the shelf and a signed download to a member, without leaking the key', async () => {
    const shelf = await studentA.t.call('GET', '/api/v1/public/library/books');
    assert.equal(shelf.status, 200, JSON.stringify(shelf.json));
    assert.equal(shelf.json.total, 2, 'the unpublished draft is not on the student shelf');
    for (const book of shelf.json.items) {
      assert.ok(!('fileKey' in book));
      assert.ok(!('url' in book));
    }
    const free = shelf.json.items.find((b) => b.id === freeBook.id);
    assert.equal(free.locked, false);
    assert.equal(free.owned, true);

    const detail = await studentA.t.call('GET', `/api/v1/public/library/books/${freeBook.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.book.title, 'Free Physics Notes');

    const file = await studentA.t.call('GET', `/api/v1/public/library/books/${freeBook.id}/download`);
    assert.equal(file.status, 200, JSON.stringify(file.json));
    assert.match(file.json.url, /^https:\/\/test-account\.r2\.cloudflarestorage\.com\/testflow-org-library\/org\//);
    assert.match(file.json.url, /X-Amz-Signature=/);
    assert.equal(file.json.fileName, 'book.pdf');
    assert.ok(!JSON.stringify(file.json).includes('fileKey'));
  });

  it('hides unpublished books and legacy group-visibility rows from students', async () => {
    const missing = await studentA.t.call('GET', `/api/v1/public/library/books/${draftBook.id}`);
    assert.equal(missing.status, 404);

    const { OrgBook } = await import('../src/models/OrgBook.js');
    const legacy = await OrgBook.create({
      organization: orgA.id, title: 'Legacy Group Book', visibility: 'group', published: true,
    });

    const shelf = await studentA.t.call('GET', '/api/v1/public/library/books');
    assert.equal(shelf.json.items.some((b) => b.id === String(legacy._id)), false, 'a group row is not served to everyone');
    const direct = await studentA.t.call('GET', `/api/v1/public/library/books/${legacy._id}`);
    assert.equal(direct.status, 404);
  });

  it('refuses an unpaid priced book, then unlocks it after a verified payment', async () => {
    const shelf = await studentA.t.call('GET', '/api/v1/public/library/books');
    const locked = shelf.json.items.find((b) => b.id === paidBook.id);
    assert.equal(locked.locked, true);
    assert.equal(locked.owned, false);
    assert.equal(locked.priceMinor, 50_000);
    assert.equal(locked.visibility, undefined, 'the student view does not expose console fields');

    const refused = await studentA.t.call('GET', `/api/v1/public/library/books/${paidBook.id}/download`);
    assert.equal(refused.status, 402, JSON.stringify(refused.json));
    assert.equal(refused.json.error.code, 'PAYMENT_REQUIRED');

    const checkout = await studentA.t.call('POST', `/api/v1/public/library/books/${paidBook.id}/checkout`, {
      body: { idempotencyKey: 'book-key-1' },
      headers: { 'idempotency-key': 'book-key-1' },
    });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
    assert.equal(checkout.json.amountKobo, 50_000);
    assert.equal(checkout.json.payment.item, 'book');
    assert.equal(fakeState.lastSubaccount, 'ACCT_test', 'the org is paid at source');

    // A retried checkout with the same key returns the same purchase, not a second row.
    const replay = await studentA.t.call('POST', `/api/v1/public/library/books/${paidBook.id}/checkout`, {
      body: { idempotencyKey: 'book-key-1' },
      headers: { 'idempotency-key': 'book-key-1' },
    });
    assert.equal(replay.json.reference, checkout.json.reference);
    const { OrgPayment } = await import('../src/models/OrgPayment.js');
    assert.equal(await OrgPayment.countDocuments({ organization: orgA.id, idempotencyKey: 'book-key-1' }), 1);

    fakeState.amountKobo = 50_000;
    fakeState.paid.add(checkout.json.reference);
    const verify = await studentA.t.call('GET', `/api/v1/public/payments/verify?reference=${checkout.json.reference}`);
    assert.equal(verify.status, 200, JSON.stringify(verify.json));
    assert.equal(verify.json.access, true);

    const file = await studentA.t.call('GET', `/api/v1/public/library/books/${paidBook.id}/download`);
    assert.equal(file.status, 200, JSON.stringify(file.json));

    const after = await studentA.t.call('GET', '/api/v1/public/library/books');
    const owned = after.json.items.find((b) => b.id === paidBook.id);
    assert.equal(owned.owned, true);
    assert.equal(owned.locked, false);
  });

  it('refuses a priced book without a payout account, and paid visibility without a price', async () => {
    const noPayout = await ownerB.c.call('POST', `/api/v1/everybody/organizations/${orgB.id}/library/books`, {
      body: { title: 'Priced But No Payout', priceMinor: 10_000 },
    });
    assert.equal(noPayout.status, 422, JSON.stringify(noPayout.json));
    assert.equal(noPayout.json.error.code, 'PAYOUT_REQUIRED');

    const noPrice = await ownerA.c.call('POST', `/api/v1/everybody/organizations/${orgA.id}/library/books`, {
      body: { title: 'Paid With No Price', visibility: 'paid', priceMinor: 0 },
    });
    assert.equal(noPrice.status, 422, JSON.stringify(noPrice.json));
    assert.equal(noPrice.json.error.code, 'BOOK_PRICE_REQUIRED');
  });

  it('keeps one organisation out of another’s shelf, even with a valid session', async () => {
    const otherShelf = await studentB.t.call('GET', '/api/v1/public/library/books');
    assert.equal(otherShelf.status, 200);
    assert.ok(otherShelf.json.items.every((b) => b.id !== freeBook.id));

    // studentA's organisation cookie is valid, but it is not a member of orgB.
    const intruder = tenantClient(orgB.slug, studentA.t.jar);
    const refused = await intruder.call('GET', '/api/v1/public/library/books');
    assert.equal(refused.status, 403, JSON.stringify(refused.json));
    assert.equal(refused.json.error.code, 'NO_MEMBERSHIP');

    const crossBook = await intruder.call('GET', `/api/v1/public/library/books/${freeBook.id}/download`);
    assert.equal(crossBook.status, 403);
  });

  it('removing the file turns the download into DOWNLOAD_NOT_AVAILABLE, not a missing book', async () => {
    const removed = await ownerA.c.call('DELETE', `/api/v1/everybody/organizations/${orgA.id}/library/books/${freeBook.id}/file`);
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    assert.equal(removed.json.book.hasFile, false);

    const file = await studentA.t.call('GET', `/api/v1/public/library/books/${freeBook.id}/download`);
    assert.equal(file.status, 403);
    assert.equal(file.json.error.code, 'DOWNLOAD_NOT_AVAILABLE');
  });

  it('requires a session on every student library route', async () => {
    const guest = tenantClient(orgA.slug);
    assert.equal((await guest.call('GET', '/api/v1/public/library/books')).status, 401);
    assert.equal((await guest.call('GET', `/api/v1/public/library/books/${freeBook.id}`)).status, 401);
    assert.equal((await guest.call('GET', `/api/v1/public/library/books/${freeBook.id}/download`)).status, 401);
    assert.equal((await guest.call('POST', `/api/v1/public/library/books/${paidBook.id}/checkout`, { body: {} })).status, 401);
  });
});
