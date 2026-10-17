/**
 * Student feedback — database-backed tests. Run only when MONGODB_URI_TEST points at a
 * DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/testflow_feedback_test npm test
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';

describe('Student feedback (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  /** Minimal cookie jar. Each call gets a unique X-Forwarded-For so shared rate limits never interfere. */
  const client = () => {
    const jar = {};
    const call = async (method, path, { body, headers, csrf = true } = {}) => {
      const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.1.${(n += 1) % 250}.${Math.floor(n / 250)}`, ...headers };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.Cookie = cookie;
      if (csrf && jar.tf_csrf) h['X-CSRF-Token'] = jar.tf_csrf;
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

  /** A signed-in student. Returns the jar and the email so the row can be promoted to admin. */
  const student = async () => {
    const email = `f${uniq()}@t.test`;
    const c = client();
    const reg = await c.call('POST', '/auth/register', {
      body: { fullName: 'Feedback Tester', email, password: pw, confirmPassword: pw, product: 'student' },
    });
    assert.equal(reg.status, 201);
    const login = await c.call('POST', '/auth/login', { body: { email, password: pw } });
    assert.equal(login.status, 200);
    return { c, email };
  };

  const send = (c, body) => c.call('POST', '/feedback', { body });

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = {
      mongoose,
      User: (await import('../src/models/User.js')).User,
      Feedback: (await import('../src/models/Feedback.js')).Feedback,
    };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));
    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  // Every test starts from an empty feedback collection, so the counts it asserts describe
  // only the notes it sent. Users and rate-limit hits are left alone: they are not under test.
  beforeEach(async () => {
    await m.Feedback.deleteMany({});
  });

  after(async () => {
    // Defensive: a failure in `before` must not leave the process holding a server or a
    // connection, because node:test waits for the event loop to drain before exiting.
    if (server) await new Promise((r) => server.close(r));
    if (m?.mongoose) {
      await m.mongoose.connection.dropDatabase();
      await m.mongoose.disconnect();
    }
  });

  it('sends a note and reads it back with its status, rating and author', async () => {
    const { c } = await student();

    const created = await send(c, {
      kind: 'problem',
      rating: 2,
      screen: 'Exam timer',
      message: 'The countdown froze when I switched tabs and I lost two minutes.',
    });

    assert.equal(created.status, 201);
    const fb = created.json.feedback;
    assert.match(fb.id, /^[0-9a-f]{24}$/);
    assert.equal(fb.kind, 'problem');
    assert.equal(fb.rating, 2);
    assert.equal(fb.screen, 'Exam timer');
    assert.equal(fb.status, 'open');
    assert.equal(fb.reply, null);
    assert.equal(fb.resolvedAt, null);
    assert.equal(fb.student.fullName, 'Feedback Tester');
    assert.equal(fb.student.username, null);
    // The service's private bookkeeping never reaches the wire.
    assert.equal(fb.messageHash, undefined);
    assert.equal(fb.resolvedBy, undefined);

    const list = await c.call('GET', '/feedback');
    assert.equal(list.status, 200);
    assert.equal(list.json.feedback.length, 1);
    assert.equal(list.json.feedback[0].id, fb.id);

    const stored = await m.Feedback.findById(fb.id);
    assert.equal(stored.status, 'open');
    assert.equal(stored.kind, 'problem');
  });

  it('refuses what it cannot act on, naming the field', async () => {
    const { c } = await student();
    const long = 'x'.repeat(1001);
    const cases = [
      [{ message: 'too short' }, 'message'],
      [{ message: long }, 'message'],
      [{ message: 'A perfectly good message about the app.', rating: 6 }, 'rating'],
      [{ message: 'A perfectly good message about the app.', rating: 3.5 }, 'rating'],
      [{ message: 'A perfectly good message about the app.', kind: 'bug' }, 'kind'],
      [{ message: 'A perfectly good message about the app.', kind: 'idea', screen: 'y'.repeat(81) }, 'screen'],
    ];

    for (const [body, field] of cases) {
      const res = await send(c, body);
      assert.equal(res.status, 422, `expected 422 for ${JSON.stringify(body)}`);
      assert.equal(res.json.error.code, 'VALIDATION_ERROR');
      assert.ok(res.json.error.fields[field], `expected a message for ${field}`);
    }

    // An omitted rating is a real shape (a bug report is not gated on rating us): it works.
    const unrated = await send(c, { message: 'The audio on my phone kept cutting out intermittently.' });
    assert.equal(unrated.status, 201);
    assert.equal(unrated.json.feedback.rating, null);
    assert.equal(unrated.json.feedback.kind, 'other');

    // Nothing that was refused left a row behind.
    assert.equal(await m.Feedback.countDocuments({}), 1);
  });

  it('refuses a body that tries to choose its own author or status', async () => {
    const { c } = await student();
    // `.strict()` turns an unknown key into a refusal rather than something the service has
    // to remember to ignore, so neither of these can ever be trusted.
    const forgedAuthor = await send(c, {
      message: 'Trying to write this on someone else behalf.',
      student: '000000000000000000000000',
    });
    assert.equal(forgedAuthor.status, 422);
    assert.match(forgedAuthor.json.error.message, /student/);

    const forgedStatus = await send(c, {
      message: 'Trying to mark my own note resolved.',
      status: 'resolved',
    });
    assert.equal(forgedStatus.status, 422);
    assert.match(forgedStatus.json.error.message, /status/);

    assert.equal(await m.Feedback.countDocuments({}), 0);
  });

  it('shows each student only their own notes', async () => {
    const a = await student();
    const b = await student();

    await send(a.c, { message: 'The lucky draw spinner on my profile never loads at all.' });
    await send(b.c, { message: 'I would like a dark mode for the midnight study sessions.' });

    const listA = await a.c.call('GET', '/feedback');
    assert.equal(listA.json.feedback.length, 1);
    assert.equal(listA.json.feedback[0].message, 'The lucky draw spinner on my profile never loads at all.');

    const listB = await b.c.call('GET', '/feedback');
    assert.equal(listB.json.feedback.length, 1);
    assert.equal(listB.json.feedback[0].message, 'I would like a dark mode for the midnight study sessions.');
  });

  it('collapses the same words twice in a day into one row', async () => {
    const { c } = await student();
    const body = { kind: 'problem', message: 'The submit button did nothing the first time I tapped it.' };

    const first = await send(c, body);
    // Whitespace and case are noise, so this is the same retry, not a second report.
    const again = await send(c, { ...body, message: 'The submit  button did nothing the first time I tapped it. ' });

    assert.equal(first.status, 201);
    assert.equal(again.status, 201);
    assert.equal(again.json.feedback.id, first.json.feedback.id);
    assert.equal(await m.Feedback.countDocuments({}), 1);

    // A different note is a different report.
    const other = await send(c, { kind: 'problem', message: 'The submit button did nothing the second time too.' });
    assert.notEqual(other.json.feedback.id, first.json.feedback.id);
    assert.equal(await m.Feedback.countDocuments({}), 2);
  });

  it('lets an admin move a note along and shows the reply back to its author', async () => {
    const { c: studentC, email } = await student();
    const other = await student();

    await send(studentC, { kind: 'idea', rating: 5, message: 'Please add keyboard shortcuts to the mock exam screen.' });
    await send(other.c, { kind: 'problem', rating: 1, message: 'My results page showed the wrong subject twice in a row.' });

    // Promote after login on purpose: the role is read from the database per request.
    await m.User.updateOne({ email }, { $set: { role: 'admin' } });

    // A student cannot touch the queue.
    assert.equal((await other.c.call('GET', '/admin/feedback')).status, 403);

    const queue = await studentC.call('GET', '/admin/feedback');
    assert.equal(queue.status, 200);
    assert.equal(queue.json.feedback.length, 2);
    assert.equal(queue.json.counts.open, 2);
    assert.equal(queue.json.counts.resolved, 0);
    assert.equal(queue.json.counts.total, 2);
    // 5 and 1 are the only rated notes: the unrated ones must not pull this toward zero.
    assert.equal(queue.json.counts.averageRating, 3);
    assert.equal(queue.json.counts.ratedCount, 2);

    const newest = queue.json.feedback.find((x) => x.kind === 'problem');
    const idea = queue.json.feedback.find((x) => x.kind === 'idea');

    const noReply = await studentC.call('PATCH', `/admin/feedback/${idea.id}`, { body: { status: 'resolved' } });
    assert.equal(noReply.status, 200);
    assert.equal(noReply.json.feedback.status, 'resolved');
    assert.equal(noReply.json.feedback.reply, null);
    assert.ok(noReply.json.feedback.resolvedAt);

    const answered = await studentC.call('PATCH', `/admin/feedback/${newest.id}`, {
      body: { status: 'resolved', reply: 'Fixed, thank you for the screenshot.' },
    });
    assert.equal(answered.status, 200);
    assert.equal(answered.json.feedback.reply, 'Fixed, thank you for the screenshot.');

    // The author sees the outcome on their own list.
    const mine = await other.c.call('GET', '/feedback');
    assert.equal(mine.json.feedback[0].status, 'resolved');
    assert.equal(mine.json.feedback[0].reply, 'Fixed, thank you for the screenshot.');

    // Reopening is allowed and clears the resolution bookkeeping, but not the reply.
    const reopened = await studentC.call('PATCH', `/admin/feedback/${newest.id}`, { body: { status: 'open' } });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.json.feedback.status, 'open');
    assert.equal(reopened.json.feedback.resolvedAt, null);
    assert.equal(reopened.json.feedback.reply, 'Fixed, thank you for the screenshot.');

    // The counts are over the whole queue, not the current filter.
    const filtered = await studentC.call('GET', '/admin/feedback?status=resolved');
    assert.equal(filtered.json.feedback.length, 1);
    assert.equal(filtered.json.counts.open, 1);
    assert.equal(filtered.json.counts.resolved, 1);
    assert.equal(filtered.json.counts.in_review, 0);

    // An empty reply erases a note written by mistake.
    const cleared = await studentC.call('PATCH', `/admin/feedback/${newest.id}`, { body: { reply: '' } });
    assert.equal(cleared.json.feedback.reply, null);

    // Audited, and every refusal is explicit.
    const audit = await m.mongoose.connection.db.collection('auditlogs').countDocuments({ action: 'REVIEW_FEEDBACK' });
    assert.ok(audit >= 4);
    assert.equal((await studentC.call('PATCH', '/admin/feedback/000000000000000000000000', { body: { status: 'open' } })).status, 404);
    assert.equal((await studentC.call('GET', '/admin/feedback?status=shredded')).status, 422);
    assert.equal((await studentC.call('PATCH', `/admin/feedback/${newest.id}`, { body: { status: 'shredded' } })).status, 422);
    assert.equal((await studentC.call('PATCH', `/admin/feedback/${newest.id}`, { body: { reply: 'z'.repeat(501) } })).status, 422);
    assert.equal((await studentC.call('PATCH', '/admin/feedback/not-an-id', { body: { status: 'open' } })).status, 422);
  });
});
