/**
 * The Library: the shelf, bookmarks, reading progress, the reader and the signed download, plus
 * the Student Pass gate on reading and downloading.
 * Run only when MONGODB_URI_TEST points at a DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/testflow_library_test node --test tests/library.integration.test.js
 *
 * The rules this file protects:
 *  - Browsing, bookmarks and progress are free; reading and downloading need the `library`
 *    entitlement, computed against the clock, and a lapsed pass needs no job to stop working.
 *  - No list or detail response ever carries a file URL or a storage key.
 *  - A refund revokes the key it granted; a later pass stacked on top keeps its own.
 *  - Passes sold before the entitlement existed are backfilled, not locked out.
 *  - An administrator manages the shelf and is exempt from the gate.
 */
process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';
// Fake R2 credentials so the download path signs a real URL without touching the network. Set
// before the app (and therefore `config/env.js`) is imported.
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET = 'testflow-library';
process.env.R2_PUBLIC_URL = 'https://cdn.example.test';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';

describe('Library shelf, reader, download and the Student Pass gate (integration)', { skip }, () => {
  let m; let server; let base; let setProviderForTests; let planService; let backfill;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;
  let books; let shelfCount;

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
      const h = { 'X-Forwarded-For': `10.9.${(n += 1) % 250}.${Math.floor(n / 250)}`, ...extra };
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
    const email = `lib${uniq()}@t.test`;
    const c = client();
    const reg = await c.call('POST', '/auth/register', {
      body: { fullName: 'Library Tester', email, password: pw, confirmPassword: pw, product: 'student' },
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    if (role !== 'student') await m.User.updateOne({ email }, { $set: { role } });
    const login = await c.call('POST', '/auth/login', { body: { email, password: pw } });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    const user = await m.User.findOne({ email }).lean();
    return { c, email, userId: String(user._id) };
  };

  /** A student holding a live pass, however it was obtained. */
  const withPass = async (role = 'student', durationDays = 30) => {
    const accountRef = await account(role);
    await planService.grantEntitlement({ userId: accountRef.userId, key: 'library', source: 'admin', durationDays });
    return accountRef;
  };

  const pages = (ref, id, query = '') => ref.c.call('GET', `/library/books/${id}/pages${query}`);
  const download = (ref, id) => ref.c.call('GET', `/library/books/${id}/download`);

  const checkout = async (ref, planKey = 'pass_30d') => {
    const res = await ref.c.call('POST', '/billing/ad-free/checkout', { body: { planKey } });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.json.purchase;
  };

  const payAndWebhook = async (purchase) => {
    payments.set(purchase.reference, { status: 'success', amountKobo: purchase.amountKobo, currency: 'NGN', transactionId: `tx_${purchase.reference}` });
    const raw = JSON.stringify({ event: 'charge.success', data: { reference: purchase.reference } });
    const signature = crypto.createHmac('sha512', WEBHOOK_SECRET).update(raw).digest('hex');
    return client().rawPost('/billing/ad-free/webhook', raw, { 'x-paystack-signature': signature });
  };

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = {
      mongoose,
      User: (await import('../src/models/User.js')).User,
      Book: (await import('../src/models/Book.js')).Book,
      BookPage: (await import('../src/models/BookPage.js')).BookPage,
      BookBookmark: (await import('../src/models/BookBookmark.js')).BookBookmark,
      BookReadingProgress: (await import('../src/models/BookReadingProgress.js')).BookReadingProgress,
      StudentEntitlement: (await import('../src/models/StudentEntitlement.js')).StudentEntitlement,
      StudentPurchase: (await import('../src/models/StudentPurchase.js')).StudentPurchase,
    };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));

    const make = (overrides) => ({
      subtitle: 'A shelf fixture', description: 'Fixture book for the library tests.',
      color: 'ink', level: 100, semester: 'first', pages: 10, sizeBytes: 1024 * 1024,
      edition: '1st edition', author: 'TestFlow Editorial', year: 2024, topics: ['Algebra'],
      published: true, fileKey: null, ...overrides,
    });

    books = {
      // Has a published file: the download can be signed.
      one: await m.Book.create(make({ code: 'LIB101', title: 'Sample Library Book One', fileKey: 'library/lib101.pdf', pages: 10, topics: ['Algebra', 'Calculus'] })),
      // No file yet: download answers 403, not 404.
      two: await m.Book.create(make({ code: 'LIB102', title: 'Sample Library Book Two', pages: 4, topics: ['Cells'] })),
      // Withdrawn: invisible everywhere.
      hidden: await m.Book.create(make({ code: 'LIB103', title: 'Unpublished Draft', published: false })),
      three: await m.Book.create(make({ code: 'LIB201', title: 'Advanced Sample Book', level: 200, semester: 'second', topics: ['Genetics'] })),
      four: await m.Book.create(make({ code: 'LIB202', title: 'Second Advanced Book', level: 200, semester: 'second', topics: ['Optics'] })),
    };
    shelfCount = 4; // everything except the unpublished draft

    // Pages for book one, and deliberately none for book two (so "not published yet" is real).
    await m.BookPage.create(
      Array.from({ length: books.one.pages }, (_, i) => ({
        book: books.one._id,
        page: i + 1,
        blocks: [
          { type: 'heading', text: `Page ${i + 1} heading` },
          { type: 'paragraph', text: `Page ${i + 1} paragraph.` },
        ],
      })),
    );

    ({ setProviderForTests } = await import('../src/services/ads/payment/index.js'));
    setProviderForTests(fakeProvider);
    planService = await import('../src/services/studentPlan.service.js');
    backfill = (await import('../src/scripts/backfill-library-entitlement.js')).backfillLibraryEntitlements;

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

  // --- The shelf (free) ---

  it('serves the shelf, the details and the reading list to a free student', async () => {
    const student = await account();

    const list = await student.c.call('GET', '/library/books');
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.equal(list.json.total, shelfCount);
    assert.equal(list.json.page, 1);
    assert.equal(list.json.pageCount, 1);
    const first = list.json.books[0];
    assert.equal(first.code, 'LIB101', 'sorted by level then code');
    for (const book of list.json.books) {
      assert.equal(typeof book.bookmarked, 'boolean', 'bookmarked is always present');
      assert.equal(typeof book.sizeKb, 'number');
      assert.ok(!('fileKey' in book));
      assert.ok(!('url' in book));
    }

    const hidden = await student.c.call('GET', `/library/books/${books.hidden._id}`);
    assert.equal(hidden.status, 404);
    assert.equal(hidden.json.error.code, 'BOOK_NOT_FOUND');

    const detail = await student.c.call('GET', `/library/books/${books.one._id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.book.code, 'LIB101');

    const reading = await student.c.call('GET', '/library/reading');
    assert.equal(reading.status, 200);
    assert.deepEqual(reading.json.reading, [], 'an empty reading list is normal, not a 404');

    // No response anywhere carries the storage key.
    assert.ok(!JSON.stringify(list.json).includes('library/lib101.pdf'));
    assert.ok(!JSON.stringify(detail.json).includes('fileKey'));
  });

  it('pages, searches and filters the shelf, and treats an unknown filter as all', async () => {
    const student = await account();

    const paged = await student.c.call('GET', '/library/books?limit=2&page=1');
    assert.equal(paged.json.books.length, 2);
    assert.equal(paged.json.pageCount, 2);

    const beyond = await student.c.call('GET', '/library/books?limit=2&page=9');
    assert.equal(beyond.json.page, 2, 'the requested page is clamped to the last one');

    const search = await student.c.call('GET', '/library/books?q=genetics');
    assert.equal(search.json.total, 1, 'a topic is searchable');
    assert.equal(search.json.books[0].code, 'LIB201');

    const byCode = await student.c.call('GET', '/library/books?q=lib202');
    assert.equal(byCode.json.total, 1, 'search is case-insensitive on the course code');

    const none = await student.c.call('GET', '/library/books?q=nothingmatchesthis');
    assert.equal(none.json.total, 0);
    assert.equal(none.json.pageCount, 1, 'an empty result still has a sane pager');
    assert.deepEqual(none.json.books, []);

    const unknownFilter = await student.c.call('GET', '/library/books?filter=whatever');
    assert.equal(unknownFilter.status, 200);
    assert.equal(unknownFilter.json.total, shelfCount, 'an unknown filter is all, never an error');

    const level = await student.c.call('GET', '/library/books?level=200');
    assert.equal(level.json.total, 2);
    const semester = await student.c.call('GET', '/library/books?semester=second');
    assert.equal(semester.json.total, 2);
  });

  it('toggles a bookmark and filters the shelf to bookmarks', async () => {
    const student = await account();

    const saved = await student.c.call('POST', `/library/books/${books.one._id}/bookmark`);
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(saved.json, { id: String(books.one._id), bookmarked: true });

    const filtered = await student.c.call('GET', '/library/books?filter=bookmarks');
    assert.equal(filtered.json.total, 1, 'a toggle is visible to the very next list call');
    assert.equal(filtered.json.books[0].code, 'LIB101');
    assert.equal(filtered.json.books[0].bookmarked, true);

    const other = await account();
    const theirs = await other.c.call('GET', '/library/books?filter=bookmarks');
    assert.equal(theirs.json.total, 0, 'bookmarks are per student');

    const removed = await student.c.call('POST', `/library/books/${books.one._id}/bookmark`);
    assert.deepEqual(removed.json, { id: String(books.one._id), bookmarked: false });
    const empty = await student.c.call('GET', '/library/books?filter=bookmarks');
    assert.equal(empty.json.total, 0);
  });

  it('records progress per book, computes the percentage and keeps every book in "continue reading"', async () => {
    const student = await account();

    const first = await student.c.call('PUT', `/library/books/${books.one._id}/progress`, { body: { page: 4, percent: 99 } });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.progress.page, 4);
    assert.equal(first.json.progress.percent, 40, 'the client percentage is ignored, not stored');

    await new Promise((r) => setTimeout(r, 10));

    const second = await student.c.call('PUT', `/library/books/${books.two._id}/progress`, { body: { page: 1 } });
    assert.equal(second.json.progress.percent, 25);

    const reading = await student.c.call('GET', '/library/reading');
    assert.equal(reading.json.reading.length, 2, 'every book they opened, not just the last');
    assert.equal(reading.json.reading[0].book.code, 'LIB102', 'newest activity first');
    assert.equal(reading.json.reading[0].percent, 25);
    assert.equal(reading.json.reading[0].book.bookmarked, false);
    assert.equal(reading.json.reading[1].book.code, 'LIB101');

    // Re-reading the same book updates the row rather than adding one.
    const again = await student.c.call('PUT', `/library/books/${books.one._id}/progress`, { body: { page: 10 } });
    assert.equal(again.json.progress.percent, 100, 'the last page is 100%');
    assert.equal(await m.BookReadingProgress.countDocuments({ user: student.userId }), 2);

    // Out of range is clamped, not refused.
    const tooFar = await student.c.call('PUT', `/library/books/${books.two._id}/progress`, { body: { page: 999 } });
    assert.equal(tooFar.json.progress.page, 4);

    const unknown = await student.c.call('PUT', `/library/books/${books.hidden._id}/progress`, { body: { page: 1 } });
    assert.equal(unknown.status, 404);
  });

  // --- The gate ---

  it('refuses reading and downloading to a free student and allows the rest', async () => {
    const student = await account();

    const read = await pages(student, books.one._id, '?page=1');
    assert.equal(read.status, 402, JSON.stringify(read.json));
    assert.equal(read.json.error.code, 'PLAN_REQUIRED');

    const file = await download(student, books.one._id);
    assert.equal(file.status, 402);
    assert.equal(file.json.error.code, 'PLAN_REQUIRED');

    // Browsing, bookmarks and progress are free.
    assert.equal((await student.c.call('GET', '/library/books')).status, 200);
    assert.equal((await student.c.call('GET', `/library/books/${books.one._id}`)).status, 200);
    assert.equal((await student.c.call('POST', `/library/books/${books.one._id}/bookmark`)).status, 200);
    assert.equal((await student.c.call('PUT', `/library/books/${books.one._id}/progress`, { body: { page: 2 } })).status, 200);
  });

  it('serves one page at a time and a short-lived download URL to a pass holder', async () => {
    const student = await withPass();

    const read = await pages(student, books.one._id, '?page=3');
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.equal(read.json.page, 3);
    assert.equal(read.json.totalPages, 10);
    assert.equal(read.json.blocks.length, 2);
    assert.equal(read.json.blocks[0].type, 'heading');

    const far = await pages(student, books.one._id, '?page=999');
    assert.equal(far.json.page, 10, 'out of range is clamped to the last page');

    const notPublished = await pages(student, books.two._id, '?page=1');
    assert.equal(notPublished.status, 200, 'a book with no pages is not a missing book');
    assert.deepEqual(notPublished.json.blocks, []);

    const file = await download(student, books.one._id);
    assert.equal(file.status, 200, JSON.stringify(file.json));
    assert.match(file.json.url, /^https:\/\/test-account\.r2\.cloudflarestorage\.com\/testflow-library\/library\/lib101\.pdf\?/);
    assert.match(file.json.url, /X-Amz-Signature=/);
    assert.equal(file.json.fileName, 'LIB101 - Sample Library Book One.pdf');
    assert.equal(file.json.sizeBytes, 1024 * 1024);
    assert.ok(new Date(file.json.expiresAt).getTime() > Date.now(), 'a short-lived URL, not an expired one');

    // A repeated tap reuses the still-valid URL rather than minting a new signature.
    const again = await download(student, books.one._id);
    assert.equal(again.json.url, file.json.url);

    // A book with no published file is 403, which is not the same answer as a missing book.
    const noFile = await download(student, books.two._id);
    assert.equal(noFile.status, 403);
    assert.equal(noFile.json.error.code, 'DOWNLOAD_NOT_AVAILABLE');

    const missing = await download(student, books.hidden._id);
    assert.equal(missing.status, 404);
  });

  it('stops working when the pass lapses, with no job having to run', async () => {
    const student = await account();
    await m.StudentEntitlement.create({
      user: student.userId, key: 'library', source: 'admin', active: true,
      startsAt: new Date(Date.now() - 10 * 86400000), expiresAt: new Date(Date.now() - 86400000),
    });

    const entitlement = await student.c.call('GET', '/billing/entitlement');
    assert.equal(entitlement.json.entitlement.status, 'expired');
    assert.equal(entitlement.json.entitlement.library, false);
    assert.equal((await pages(student, books.one._id)).status, 402);
    assert.equal((await download(student, books.one._id)).status, 402);
  });

  it('reports the library entitlement on the entitlement and product reads', async () => {
    const student = await withPass();

    const entitlement = await student.c.call('GET', '/billing/entitlement');
    assert.equal(entitlement.json.entitlement.library, true);
    assert.equal(entitlement.json.entitlement.entitlements.library, true);
    assert.ok(entitlement.json.entitlement.activeKeys.includes('library'));

    const products = await client().call('GET', '/billing/ad-free/products');
    for (const product of products.json.products) {
      assert.equal(product.entitlements.library, true, 'the plan page can be driven from data');
    }
  });

  it('revokes the library entitlement on revocation, and again after a purchase is refunded', async () => {
    const revoked = await withPass();
    await planService.revokeEntitlement({ userId: revoked.userId, key: 'library', reason: 'test' });
    assert.equal((await pages(revoked, books.one._id)).status, 402);

    // A real purchase grants every key in the catalogue, and a refund takes them back.
    const buyer = await account();
    const purchase = await checkout(buyer);
    const applied = await payAndWebhook(purchase);
    assert.equal(applied.status, 200, JSON.stringify(applied.json));
    assert.equal(applied.json.applied, true);
    assert.equal((await pages(buyer, books.one._id)).status, 200);
    assert.equal((await download(buyer, books.one._id)).status, 200);

    const admin = await account('admin');
    const refund = await admin.c.call('POST', '/billing/ad-free/refund', { body: { reference: purchase.reference } });
    assert.equal(refund.status, 200, JSON.stringify(refund.json));
    assert.equal((await pages(buyer, books.one._id)).status, 402, 'the refund took the library key with it');
    assert.equal((await download(buyer, books.one._id)).status, 402);
  });

  it('keeps access after a refund when a later pass stacked on top', async () => {
    const student = await account();
    const first = await checkout(student, 'pass_30d');
    await payAndWebhook(first);
    const second = await checkout(student, 'pass_90d');
    await payAndWebhook(second);
    assert.equal((await pages(student, books.one._id)).status, 200);

    const admin = await account('admin');
    const refund = await admin.c.call('POST', '/billing/ad-free/refund', { body: { reference: first.reference } });
    assert.equal(refund.status, 200, JSON.stringify(refund.json));
    assert.equal((await pages(student, books.one._id)).status, 200, 'the stacked pass keeps its own entitlement');

    const alsoRefunded = await admin.c.call('POST', '/billing/ad-free/refund', { body: { reference: second.reference } });
    assert.equal(alsoRefunded.status, 200, JSON.stringify(alsoRefunded.json));
    assert.equal((await pages(student, books.one._id)).status, 402);
  });

  it('backfills passes sold before the library entitlement existed, idempotently', async () => {
    const student = await account();
    await m.StudentEntitlement.create({
      user: student.userId, key: 'ad_free', source: 'purchase', planKey: 'pass_30d',
      startsAt: new Date(Date.now() - 86400000), expiresAt: new Date(Date.now() + 29 * 86400000),
    });
    assert.equal((await pages(student, books.one._id)).status, 402, 'locked out until the backfill runs');

    const dry = await backfill({ dryRun: true });
    assert.ok(dry.created >= 1);
    assert.equal(await m.StudentEntitlement.countDocuments({ user: student.userId, key: 'library' }), 0, 'a dry run writes nothing');

    const applied = await backfill({});
    assert.equal(applied.created, dry.created, 'it creates exactly what the dry run counted');
    assert.equal((await pages(student, books.one._id)).status, 200);

    const again = await backfill({});
    assert.equal(again.created, 0, 'idempotent');
    assert.ok(again.existing >= 1);

    const row = await m.StudentEntitlement.findOne({ user: student.userId, key: 'library' }).lean();
    assert.equal(row.planKey, 'pass_30d');
    assert.ok(row.expiresAt, 'the backfilled row keeps the pass expiry');
  });

  it('lets an administrator read and download without a pass, but not grant one to themselves', async () => {
    const admin = await account('admin');
    assert.equal((await pages(admin, books.one._id)).status, 200);
    assert.equal((await download(admin, books.one._id)).status, 200);

    const selfGrant = await admin.c.call('POST', `/billing/ad-free/entitlements/${admin.userId}/grant`, { body: { key: 'library' } });
    assert.equal(selfGrant.status, 201, 'the support tool accepts the new key');
    assert.equal(selfGrant.json.entitlement.key, 'library');

    const student = await account();
    const refused = await student.c.call('POST', `/billing/ad-free/entitlements/${student.userId}/grant`, { body: { key: 'library' } });
    assert.equal(refused.status, 403, 'the only student write is a checkout');
    assert.equal((await pages(student, books.one._id)).status, 402);
  });

  it('requires a session for every library route', async () => {
    const guest = client();
    assert.equal((await guest.call('GET', '/library/books')).status, 401);
    assert.equal((await guest.call('GET', '/library/reading')).status, 401);
    assert.equal((await guest.call('GET', `/library/books/${books.one._id}`)).status, 401);
    assert.equal((await guest.call('GET', `/library/books/${books.one._id}/pages`)).status, 401);
    assert.equal((await guest.call('POST', `/library/books/${books.one._id}/bookmark`)).status, 401);
    assert.equal((await guest.call('PUT', `/library/books/${books.one._id}/progress`, { body: { page: 1 } })).status, 401);
    assert.equal((await guest.call('GET', `/library/books/${books.one._id}/download`)).status, 401);
  });
});
