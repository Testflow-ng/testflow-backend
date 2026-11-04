/**
 * Share links, reported questions and saved questions — database-backed tests. Run only when
 * MONGODB_URI_TEST points at a DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/testflow_study_test npm test
 *
 * The interesting parts are the ones a status code cannot describe: that a crawler gets the tags
 * without running anything, that the card is a real 1200x630 PNG, that reporting twice is one
 * report, and that a public question payload never carries its own answer.
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';

describe('Share links, flags and bookmarks (integration)', { skip }, () => {
  let m; let server; let base; let sharp;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  /** Minimal cookie jar. Each call gets a unique X-Forwarded-For so shared rate limits never interfere. */
  const client = () => {
    const jar = {};
    const call = async (method, path, { body, headers, csrf = true } = {}) => {
      const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.3.${(n += 1) % 250}.${Math.floor(n / 250)}`, ...headers };
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
      return { status: res.status, json: text ? JSON.parse(text) : null, text, cookies: res.headers.getSetCookie() };
    };
    return { call, jar };
  };

  /** Fetch something that is not JSON: a share page or an image. */
  const raw = async (url) => {
    const res = await fetch(url.startsWith('http') ? url : `${base}${url}`);
    const body = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      type,
      corp: res.headers.get('cross-origin-resource-policy'),
      body,
      text: type.includes('html') ? body.toString('utf8') : '',
    };
  };

  const student = async () => {
    const email = `s${uniq()}@t.test`;
    const c = client();
    const reg = await c.call('POST', '/auth/register', {
      body: { fullName: 'Study Tester', email, password: pw, confirmPassword: pw, product: 'student' },
    });
    assert.equal(reg.status, 201);
    const login = await c.call('POST', '/auth/login', { body: { email, password: pw } });
    assert.equal(login.status, 200);
    return { c, email };
  };

  /** A finished attempt with a known score: four of five right. */
  const finishedAttempt = async (c) => {
    const started = await c.call('POST', '/exam-sessions', {
      body: { subject: 'MTH101', questionCount: 5, durationMinutes: 10 },
    });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const session = started.json.session;

    const stored = await m.ExamSession.findById(session.id).lean();
    for (let index = 0; index < stored.questions.length; index += 1) {
      const question = stored.questions[index];
      const selectedOption = index < 4 ? question.correctOption : (question.correctOption + 1) % 4;
      const saved = await c.call('PATCH', `/exam-sessions/${session.id}/answer`, {
        body: { questionIndex: index, selectedOption },
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.json));
    }

    const submitted = await c.call('POST', `/exam-sessions/${session.id}/submit`);
    assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
    return { id: session.id, result: submitted.json.result };
  };

  const seedQuestion = (subjectId, overrides = {}) =>
    m.Question.create({
      subject: subjectId,
      stem: 'Which of these is a prime number?',
      options: ['4', '9', '11', '15'],
      correctIndex: 2,
      explanation: '11 has no divisors other than 1 and itself.',
      topic: 'Number theory',
      ...overrides,
    });

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    sharp = (await import('sharp')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = {
      mongoose,
      User: (await import('../src/models/User.js')).User,
      Subject: (await import('../src/models/Subject.js')).Subject,
      Question: (await import('../src/models/Question.js')).Question,
      ExamSession: (await import('../src/models/ExamSession.js')).ExamSession,
      QuestionFlag: (await import('../src/models/QuestionFlag.js')).QuestionFlag,
      QuestionBookmark: (await import('../src/models/QuestionBookmark.js')).QuestionBookmark,
    };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));

    m.subject = await m.Subject.create({ code: 'MTH101', title: 'Mathematics', level: '100' });
    // Enough questions for a five-question paper and then some, all public questions.
    m.questions = [];
    for (let i = 0; i < 8; i += 1) {
      m.questions.push(
        await seedQuestion(m.subject._id, {
          stem: `Which of these is a prime number? (${i})`,
          isShareable: true,
          shareTitle: i === 0 ? 'A five second maths challenge' : undefined,
        }),
      );
    }

    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  // Reports and saved questions are counted, so each test starts from none. Users, subjects and
  // attempts are left alone: they are not under test and rebuilding them would be noise.
  beforeEach(async () => {
    await m.QuestionFlag.deleteMany({});
    await m.QuestionBookmark.deleteMany({});
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

  it('mints one link per attempt and serves the card a crawler can render', async () => {
    const { c } = await student();
    const attempt = await finishedAttempt(c);

    const minted = await c.call('POST', `/exam-sessions/${attempt.id}/share`);
    assert.equal(minted.status, 200, JSON.stringify(minted.json));

    const share = minted.json.share;
    assert.match(share.token, /^[0-9a-f]{8}\.[0-9a-f]{12}$/);
    assert.equal(share.url, `${base}/r/${share.token}`);
    assert.equal(share.imageUrl, `${share.url}/og.png`);

    // Asking twice answers with the token that already exists: a student who shares twice must
    // not end up with two URLs pointing at one attempt.
    const again = await c.call('POST', `/exam-sessions/${attempt.id}/share`);
    assert.equal(again.json.share.token, share.token);
    assert.equal(await m.ExamSession.countDocuments({ shareToken: share.token }), 1);

    const page = await raw(share.url);
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.text, /<meta property="og:title"/);
    assert.match(page.text, /og:site_name" content="TestFlow"/);
    assert.match(page.text, /<meta property="og:image:width" content="1200"/);
    assert.match(page.text, /<meta property="og:image:height" content="630"/);
    assert.match(page.text, /name="twitter:card" content="summary_large_image"/);
    assert.ok(page.text.includes(`${attempt.result.score}%`), 'the page names the score');
    // The page has to work with no script at all: the app's CSP blocks inline ones.
    assert.ok(!page.text.includes('<script'), 'no script tag on a share page');

    const image = await raw(share.imageUrl);
    assert.equal(image.status, 200);
    assert.equal(image.type, 'image/png');
    assert.equal(image.corp, 'cross-origin');
    assert.deepEqual([...image.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    const meta = await sharp(image.body).metadata();
    assert.equal(meta.width, 1200);
    assert.equal(meta.height, 630);

    // Immutable: a token always means the same attempt, so no proxy has to ask again.
    const cached = await fetch(share.imageUrl);
    assert.match(cached.headers.get('cache-control') ?? '', /immutable/);
  });

  it('refuses a link for an attempt the caller does not own, or one still running', async () => {
    const owner = await student();
    const other = await student();
    const attempt = await finishedAttempt(owner.c);

    // 404 rather than 403: a 403 would confirm that the attempt exists.
    assert.equal((await other.c.call('POST', `/exam-sessions/${attempt.id}/share`)).status, 404);

    const running = await owner.c.call('POST', '/exam-sessions', {
      body: { subject: 'MTH101', questionCount: 3, durationMinutes: 10 },
    });
    const inProgress = await owner.c.call('POST', `/exam-sessions/${running.json.session.id}/share`);
    assert.equal(inProgress.status, 409);
    assert.equal(inProgress.json.error.code, 'SESSION_IN_PROGRESS');

    // Nobody mints a link without signing in.
    assert.equal((await client().call('POST', `/exam-sessions/${attempt.id}/share`)).status, 401);
  });

  it('kills the link the moment the token is cleared', async () => {
    const { c } = await student();
    const attempt = await finishedAttempt(c);
    const share = (await c.call('POST', `/exam-sessions/${attempt.id}/share`)).json.share;

    assert.equal((await raw(share.url)).status, 200);

    // Revoking is clearing the field. Nothing else has to happen, which is the point.
    await m.ExamSession.updateOne({ _id: attempt.id }, { $unset: { shareToken: 1 } });

    const dead = await raw(share.url);
    assert.equal(dead.status, 404);
    assert.match(dead.text, /not active/i);
    assert.equal((await raw(share.imageUrl)).status, 404);
    assert.equal((await raw(`${base}/r/0000000000000000.000000000000`)).status, 404);
  });

  it('reports a question once per student, updating the reason on a second try', async () => {
    const a = await student();
    const b = await student();
    const question = m.questions[0];

    const first = await a.c.call('POST', `/questions/${question._id}/flag`, {
      body: { reason: 'typo', note: 'Option C reads 1l instead of 11.' },
    });
    assert.equal(first.status, 201, JSON.stringify(first.json));

    const flag = first.json.flag;
    assert.match(flag.id, /^[0-9a-f]{24}$/);
    assert.equal(flag.questionId, String(question._id));
    assert.equal(flag.reason, 'typo');
    assert.equal(flag.note, 'Option C reads 1l instead of 11.');
    assert.equal(flag.status, 'open');
    assert.equal(flag.resolution, '');
    assert.ok(flag.createdAt);
    // The report carries the question and its key, because the admin judges the claim without
    // leaving the queue.
    assert.equal(flag.question.id, String(question._id));
    assert.equal(flag.question.subjectCode, 'MTH101');
    assert.equal(flag.question.correctOption, 2);
    assert.ok(flag.question.explanation);
    assert.equal(flag.student.fullName, 'Study Tester');
    assert.equal(flag.reportCount, 1);

    // Reporting again is a correction, not a second report.
    const second = await a.c.call('POST', `/questions/${question._id}/flag`, {
      body: { reason: 'wrong_answer', note: 'Actually the key is wrong.' },
    });
    assert.equal(second.status, 201);
    assert.equal(second.json.flag.id, flag.id);
    assert.equal(second.json.flag.reason, 'wrong_answer');
    assert.equal(second.json.flag.reportCount, 1);
    assert.equal(await m.QuestionFlag.countDocuments({}), 1);

    // A second student is a second report, and the count says so.
    const other = await b.c.call('POST', `/questions/${question._id}/flag`, { body: { reason: 'duplicate' } });
    assert.equal(other.json.flag.reportCount, 2);
    assert.notEqual(other.json.flag.id, flag.id);
    assert.equal(other.json.flag.note, '');
  });

  it('refuses a report it cannot act on', async () => {
    const { c } = await student();

    const cases = [
      [{ reason: 'because' }, 'reason'],
      [{ reason: 'typo', note: 'x'.repeat(501) }, 'note'],
      [{ reason: 'typo', status: 'resolved' }, undefined],
      [{ reason: 'typo', student: '000000000000000000000000' }, undefined],
    ];
    for (const [body, field] of cases) {
      const res = await c.call('POST', `/questions/${m.questions[1]._id}/flag`, { body });
      assert.equal(res.status, 422, `expected 422 for ${JSON.stringify(body)}`);
      assert.equal(res.json.error.code, 'VALIDATION_ERROR');
      if (field) assert.ok(res.json.error.fields[field], `expected a field message for ${field}`);
    }

    // `other` is the one reason that cannot stand without a note.
    const bare = await c.call('POST', `/questions/${m.questions[1]._id}/flag`, { body: { reason: 'other' } });
    assert.equal(bare.status, 422);
    assert.equal(bare.json.error.code, 'NOTE_REQUIRED');

    const missing = await c.call('POST', '/questions/000000000000000000000000/flag', { body: { reason: 'typo' } });
    assert.equal(missing.status, 404);

    // Nobody reports a question without signing in.
    assert.equal(
      (await client().call('POST', `/questions/${m.questions[1]._id}/flag`, { body: { reason: 'typo' } })).status,
      401,
    );

    assert.equal(await m.QuestionFlag.countDocuments({}), 0);
  });

  it('works the report queue and audits the decision', async () => {
    const triager = await student();
    const reporter = await student();

    await reporter.c.call('POST', `/questions/${m.questions[0]._id}/flag`, {
      body: { reason: 'typo', note: 'The units are missing.' },
    });
    await reporter.c.call('POST', `/questions/${m.questions[1]._id}/flag`, { body: { reason: 'other', note: 'Broken image.' } });

    await m.User.updateOne({ email: triager.email }, { $set: { role: 'admin' } });

    // A student cannot read the queue.
    assert.equal((await reporter.c.call('GET', '/admin/question-flags')).status, 403);

    const queue = await triager.c.call('GET', '/admin/question-flags');
    assert.equal(queue.status, 200, JSON.stringify(queue.json));
    assert.equal(queue.json.flags.length, 2);
    assert.equal(queue.json.counts.open, 2);
    assert.equal(queue.json.counts.resolved, 0);
    assert.equal(queue.json.counts.dismissed, 0);
    // Two distinct questions are reported, which is the number an admin can act on.
    assert.equal(queue.json.counts.questionCount, 2);
    assert.equal(queue.json.flags.length, 2);

    const typo = queue.json.flags.find((f) => f.reason === 'typo');
    const other = queue.json.flags.find((f) => f.reason === 'other');
    const resolved = await triager.c.call('PATCH', `/admin/question-flags/${typo.id}`, {
      body: { status: 'resolved', resolution: 'Fixed the units and re-keyed the question.' },
    });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.json));
    assert.equal(resolved.json.flag.status, 'resolved');
    assert.equal(resolved.json.flag.resolution, 'Fixed the units and re-keyed the question.');
    assert.equal(resolved.json.flag.reportCount, 1);

    const after = await triager.c.call('GET', '/admin/question-flags');
    assert.equal(after.json.counts.open, 1);
    assert.equal(after.json.counts.resolved, 1);

    // Reopening keeps the note: the note is usually why it was reopened.
    const reopened = await triager.c.call('PATCH', `/admin/question-flags/${typo.id}`, { body: { status: 'open' } });
    assert.equal(reopened.json.flag.status, 'open');
    assert.equal(reopened.json.flag.resolution, 'Fixed the units and re-keyed the question.');

    const dismissed = await triager.c.call('PATCH', `/admin/question-flags/${other.id}`, {
      body: { status: 'dismissed', resolution: 'Reads fine on a phone.' },
    });
    assert.equal(dismissed.json.flag.status, 'dismissed');

    // Every decision is reconstructable later.
    const audit = await m.mongoose.connection.db
      .collection('auditlogs')
      .countDocuments({ action: 'REVIEW_QUESTION_FLAG' });
    assert.ok(audit >= 3, `expected audit rows, saw ${audit}`);

    // And every refusal is explicit.
    assert.equal((await triager.c.call('PATCH', '/admin/question-flags/000000000000000000000000', { body: { status: 'open' } })).status, 404);
    assert.equal((await triager.c.call('PATCH', `/admin/question-flags/${typo.id}`, { body: { status: 'melted' } })).status, 422);
    assert.equal((await triager.c.call('PATCH', '/admin/question-flags/not-an-id', { body: { status: 'open' } })).status, 422);
    assert.equal((await triager.c.call('PATCH', `/admin/question-flags/${typo.id}`, { body: { resolution: 'no status' } })).status, 422);
    assert.equal((await triager.c.call('GET', '/admin/question-flags?limit=99999')).status, 422);
  });

  it('saves and unsaves a question, and reads it back with its answer', async () => {
    const { c } = await student();
    const question = m.questions[2];

    const empty = await c.call('GET', '/question-bookmarks');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json.bookmarks, []);

    // Toggling: the button never has to know which way it is going.
    const saved = await c.call('POST', '/question-bookmarks', { body: { questionId: String(question._id) } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.questionId, String(question._id));
    assert.equal(saved.json.bookmarked, true);

    const list = await c.call('GET', '/question-bookmarks');
    assert.equal(list.json.bookmarks.length, 1);
    const row = list.json.bookmarks[0];
    assert.match(row.id, /^[0-9a-f]{24}$/);
    assert.equal(row.questionId, String(question._id));
    assert.ok(row.createdAt);
    // A study list without the key is a list of things to re-answer blind.
    assert.equal(row.question.id, String(question._id));
    assert.equal(row.question.subjectCode, 'MTH101');
    assert.equal(row.question.stem, question.stem);
    assert.deepEqual(row.question.options, [...question.options]);
    assert.equal(row.question.correctOption, 2);
    assert.equal(row.question.explanation, '11 has no divisors other than 1 and itself.');
    assert.equal(row.question.topic, 'Number theory');

    const unsaved = await c.call('POST', '/question-bookmarks', { body: { questionId: String(question._id) } });
    assert.equal(unsaved.json.bookmarked, false);
    assert.deepEqual((await c.call('GET', '/question-bookmarks')).json.bookmarks, []);

    // Saving is per student.
    const other = await student();
    await other.c.call('POST', '/question-bookmarks', { body: { questionId: String(question._id) } });
    assert.equal((await c.call('GET', '/question-bookmarks')).json.bookmarks.length, 0);
    assert.equal((await other.c.call('GET', '/question-bookmarks')).json.bookmarks.length, 1);

    const savedRow = (await other.c.call('GET', '/question-bookmarks')).json.bookmarks[0];
    // Somebody else's row is not yours to remove, and the refusal does not confirm it exists.
    assert.equal((await c.call('DELETE', `/question-bookmarks/${savedRow.id}`)).status, 404);
    assert.equal((await other.c.call('DELETE', `/question-bookmarks/${savedRow.id}`)).status, 200);
    const gone = await other.c.call('DELETE', `/question-bookmarks/${savedRow.id}`);
    assert.equal(gone.status, 404);
  });

  it('keeps a saved row when the question behind it is deleted', async () => {
    const { c } = await student();
    const question = await seedQuestion(m.subject._id, { stem: 'A question that will not survive.' });

    await c.call('POST', '/question-bookmarks', { body: { questionId: String(question._id) } });
    await m.Question.deleteOne({ _id: question._id });

    const list = await c.call('GET', '/question-bookmarks');
    assert.equal(list.json.bookmarks.length, 1);
    // The screen says the question is gone, which is better than an entry that vanishes.
    assert.equal(list.json.bookmarks[0].question, null);

    assert.equal((await c.call('POST', '/question-bookmarks', { body: { questionId: '000000000000000000000000' } })).status, 404);
    assert.equal((await c.call('POST', '/question-bookmarks', { body: { questionId: 'nope' } })).status, 422);
    assert.equal((await client().call('GET', '/question-bookmarks')).status, 401);
  });

  it('serves a public question without its answer, and refuses one that is not shareable', async () => {
    const { c } = await student();
    const question = m.questions[0];
    const answerable = m.questions[1];

    const view = await c.call('GET', `/public/questions/${question._id}`);
    assert.equal(view.status, 200);
    assert.equal(view.json.question.id, String(question._id));
    assert.equal(view.json.question.subjectCode, 'MTH101');
    assert.equal(view.json.question.stem, question.stem);
    assert.deepEqual(view.json.question.options, [...question.options]);
    assert.equal(view.json.question.topic, 'Number theory');
    assert.equal(view.json.question.shareTitle, 'A five second maths challenge');
    // The answer key and the explanation are not in the payload at all.
    assert.equal(view.json.question.correctOption, undefined);
    assert.equal(view.json.question.explanation, undefined);
    assert.equal(view.json.question.correctIndex, undefined);

    const answered = await c.call('POST', `/public/questions/${answerable._id}/respond`, { body: { selectedOption: 2 } });
    assert.equal(answered.status, 200);
    assert.equal(answered.json.isCorrect, true);
    assert.equal(answered.json.correctOption, 2);
    assert.ok(answered.json.explanation);
    assert.equal(answered.json.correctIndex, undefined);

    const wrong = await c.call('POST', `/public/questions/${answerable._id}/respond`, { body: { selectedOption: 0 } });
    assert.equal(wrong.json.isCorrect, false);
    assert.equal((await c.call('POST', `/public/questions/${answerable._id}/respond`, { body: {} })).status, 400);

    // A question nobody published is not public, and asking is a 404 rather than a redirect.
    const hidden = await seedQuestion(m.subject._id, { isShareable: false });
    assert.equal((await c.call('GET', `/public/questions/${hidden._id}`)).status, 404);
    assert.equal((await c.call('GET', `/public/questions/${hidden._id}/share`)).status, 404);
    assert.equal((await c.call('GET', '/public/questions/not-an-id')).status, 404);

    // The share page carries the tags a crawler reads, and it points at a card of this question.
    const page = await raw(`/api/public/questions/${question._id}/share`);
    assert.equal(page.status, 200);
    assert.match(page.text, /<meta property="og:title" content="A five second maths challenge"/);
    assert.ok(page.text.includes(`/api/public/questions/${question._id}/og.png`), 'the card is this question');
    assert.ok(!page.text.includes('<script'), 'no script tag on a share page');

    const card = await raw(`/api/public/questions/${question._id}/og.png`);
    assert.equal(card.status, 200);
    assert.equal(card.type, 'image/png');
    assert.equal(card.corp, 'cross-origin');
    const meta = await sharp(card.body).metadata();
    assert.equal(meta.width, 1200);
    assert.equal(meta.height, 630);
    assert.equal((await raw(`/api/public/questions/${hidden._id}/og.png`)).status, 404);
  });
});
