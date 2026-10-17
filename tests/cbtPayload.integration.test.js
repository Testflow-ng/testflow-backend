/**
 * The CBT payloads — database-backed tests. Run only when MONGODB_URI_TEST points at a
 * DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/testflow_cbt_test npm test
 *
 * The payload is the contract here. The live paper, the corrections and the printed report are
 * all rebuilt from `session` and `result`, so these tests assert shapes and arithmetic, not
 * just statuses.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';

describe('CBT payloads (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  /** Minimal cookie jar. Each call gets a unique X-Forwarded-For so shared rate limits never interfere. */
  const client = () => {
    const jar = {};
    const call = async (method, path, { body, headers, csrf = true } = {}) => {
      const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.2.${(n += 1) % 250}.${Math.floor(n / 250)}`, ...headers };
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

  const student = async ({ paid = false } = {}) => {
    const email = `c${uniq()}@t.test`;
    const c = client();
    const reg = await c.call('POST', '/auth/register', {
      body: { fullName: 'CBT Tester', email, password: pw, confirmPassword: pw, product: 'student' },
    });
    assert.equal(reg.status, 201);
    const login = await c.call('POST', '/auth/login', { body: { email, password: pw } });
    assert.equal(login.status, 200);
    if (paid) await m.User.updateOne({ email }, { $set: { isPostUtmePaid: true } });
    return { c, email };
  };

  /** Start a paper, returning the `session` payload. */
  const start = async (c, body) => {
    const res = await c.call('POST', '/exam-sessions', { body });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.json.session;
  };

  const seedQuestions = (subjectId, count, topic) =>
    m.Question.create(
      Array.from({ length: count }, (_, i) => ({
        subject: subjectId,
        stem: `${topic} question ${i}: pick the right one.`,
        options: ['alpha', 'bravo', 'charlie', 'delta'],
        correctIndex: i % 4,
        explanation: `${topic} ${i} works because alpha is the only one that fits.`,
        topic,
      })),
    );

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = {
      mongoose,
      User: (await import('../src/models/User.js')).User,
      Subject: (await import('../src/models/Subject.js')).Subject,
      Question: (await import('../src/models/Question.js')).Question,
      ExamSession: (await import('../src/models/ExamSession.js')).ExamSession,
      PostUtmeSession: (await import('../src/models/PostUtmeSession.js')).PostUtmeSession,
    };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));

    m.subjects = {
      mth: await m.Subject.create({ code: 'MTH101', title: 'Mathematics', level: '100', allowCalculator: true }),
      // A subject where the paper runs without a calculator.
      phy: await m.Subject.create({ code: 'PHY101', title: 'Physics', level: '100', allowCalculator: false }),
      eng: await m.Subject.create({ code: 'ENG101', title: 'Use of English', level: '100' }),
      // The compulsory Post-UTME paper; the service looks it up by this flag, not by code.
      gst: await m.Subject.create({ code: 'GST101', title: 'General Knowledge', level: 'post-utme', isCompulsoryUtme: true }),
    };

    await seedQuestions(m.subjects.mth._id, 12, 'Algebra');
    await seedQuestions(m.subjects.phy._id, 12, 'Mechanics');
    await seedQuestions(m.subjects.eng._id, 10, 'Comprehension');
    await seedQuestions(m.subjects.gst._id, 10, 'Civics');

    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  });

  it('starts a paper whose payload can rebuild the whole sitting', async () => {
    const { c } = await student();
    const s = await start(c, { subject: 'MTH101', questionCount: 5, durationMinutes: 10 });

    assert.match(s.id, /^[0-9a-f]{24}$/);
    assert.equal(s.subjectCode, 'MTH101');
    assert.equal(s.status, 'in_progress');
    assert.equal(s.strikes, 0);
    assert.equal(s.totalQuestions, 5);
    // The timer counts down from here, and expiresAt stays the authority.
    assert.equal(s.timeLimitSeconds, 600);
    assert.equal(s.allowCalculator, true);
    assert.ok(new Date(s.expiresAt).getTime() > Date.now());
    assert.ok(s.remainingSeconds > 0 && s.remainingSeconds <= 600);
    // One subject, so the runtime draws no section strip.
    assert.equal(s.subjectCodes, undefined);

    assert.equal(s.questions.length, 5);
    const bank = await m.Question.find({ subject: m.subjects.mth._id });
    const bankIds = new Set(bank.map((q) => String(q._id)));

    s.questions.forEach((q, index) => {
      assert.equal(q.index, index);
      assert.ok(bankIds.has(q.id), 'the question id is the bank id');
      assert.match(q.stem, /^Algebra question \d/);
      assert.equal(q.options.length, 4);
      assert.equal(q.topic, 'Algebra');
      // Resume state, present from the first response.
      assert.equal(q.selectedOption, null);
      assert.equal(q.markedForReview, false);
      // The answer key is not in a live paper.
      assert.equal(q.correctOption, undefined);
      assert.equal(q.explanation, undefined);
    });
  });

  it('patches one field at a time, clears an answer, and resumes exactly there', async () => {
    const { c } = await student();
    const s = await start(c, { subject: 'MTH101', questionCount: 4, durationMinutes: 10 });

    const chosen = await c.call('PATCH', `/exam-sessions/${s.id}/answer`, { body: { questionIndex: 0, selectedOption: 1 } });
    assert.equal(chosen.status, 200);
    assert.deepEqual(chosen.json.answer, { index: 0, selectedOption: 1, markedForReview: false });

    // A flag does not clobber the answer it was set alongside.
    const flagged = await c.call('PATCH', `/exam-sessions/${s.id}/answer`, { body: { questionIndex: 0, markedForReview: true } });
    assert.deepEqual(flagged.json.answer, { index: 0, selectedOption: 1, markedForReview: true });

    // Repeating the same patch is safe.
    assert.equal((await c.call('PATCH', `/exam-sessions/${s.id}/answer`, { body: { questionIndex: 0, selectedOption: 1 } })).status, 200);

    // null clears the answer and leaves the flag alone.
    const cleared = await c.call('PATCH', `/exam-sessions/${s.id}/answer`, { body: { questionIndex: 0, selectedOption: null } });
    assert.deepEqual(cleared.json.answer, { index: 0, selectedOption: null, markedForReview: true });

    // One GET rebuilds the paper, including both pieces of state.
    const resumed = (await c.call('GET', `/exam-sessions/${s.id}`)).json.session;
    assert.equal(resumed.questions[0].selectedOption, null);
    assert.equal(resumed.questions[0].markedForReview, true);
    assert.equal(resumed.questions[1].selectedOption, null);

    // Answers outside the paper are refused rather than stored.
    assert.equal((await c.call('PATCH', `/exam-sessions/${s.id}/answer`, { body: { questionIndex: 0, selectedOption: 9 } })).status, 400);
    assert.equal((await c.call('PATCH', `/exam-sessions/${s.id}/answer`, { body: { questionIndex: 99, selectedOption: 0 } })).status, 400);
    assert.equal((await c.call('PATCH', `/exam-sessions/${s.id}/answer`, { body: { questionIndex: 0 } })).status, 422);
  });

  it('hides the calculator when the subject forbids it, without touching sittings already underway', async () => {
    const a = await student();
    assert.equal((await start(a.c, { subject: 'MTH101' })).allowCalculator, true);

    const b = await student();
    const physics = await start(b.c, { subject: 'PHY101' });
    assert.equal(physics.allowCalculator, false);

    // Flipping the subject later cannot change the paper this student already has.
    await m.Subject.updateOne({ _id: m.subjects.phy._id }, { $set: { allowCalculator: true } });
    assert.equal((await b.c.call('GET', `/exam-sessions/${physics.id}`)).json.session.allowCalculator, false);
    await m.Subject.updateOne({ _id: m.subjects.phy._id }, { $set: { allowCalculator: false } });
  });

  it('counts strikes on the session, and the third submits the paper server-side', async () => {
    const { c } = await student();
    const s = await start(c, { subject: 'MTH101', questionCount: 3 });

    const first = await c.call('POST', `/exam-sessions/${s.id}/strike`);
    assert.deepEqual(first.json.result, { strikes: 1, status: 'in_progress' });
    // Kept on the session, so a reload still shows the strike.
    assert.equal((await c.call('GET', `/exam-sessions/${s.id}`)).json.session.strikes, 1);

    assert.equal((await c.call('POST', `/exam-sessions/${s.id}/strike`)).json.result.strikes, 2);
    assert.deepEqual((await c.call('POST', `/exam-sessions/${s.id}/strike`)).json.result, { strikes: 3, status: 'submitted' });

    // A closed paper accepts no more answers.
    assert.equal((await c.call('PATCH', `/exam-sessions/${s.id}/answer`, { body: { questionIndex: 0, selectedOption: 0 } })).status, 409);
  });

  it('submits a summary, then serves the marked paper the corrections and report are built from', async () => {
    const { c } = await student();
    const s = await start(c, { subject: 'MTH101', questionCount: 5, durationMinutes: 10 });

    // The answer key is readable only in the database, which is the only way to answer on purpose.
    const stored = await m.ExamSession.findById(s.id);
    const right = stored.questions[0].correctOption;
    const wrong = (stored.questions[1].correctOption + 1) % stored.questions[1].options.length;

    await c.call('PATCH', `/exam-sessions/${s.id}/answer`, { body: { questionIndex: 0, selectedOption: right } });
    await c.call('PATCH', `/exam-sessions/${s.id}/answer`, { body: { questionIndex: 1, selectedOption: wrong, markedForReview: true } });

    const submitted = await c.call('POST', `/exam-sessions/${s.id}/submit`);
    assert.equal(submitted.status, 200);
    const summary = submitted.json.result;
    assert.equal(summary.status, 'submitted');
    assert.equal(summary.score, 20);
    assert.equal(summary.correctCount, 1);
    assert.equal(summary.totalQuestions, 5);
    // A summary, not the paper: the corrections fetch `/result`.
    assert.equal(summary.questions, undefined);

    const marked = (await c.call('GET', `/exam-sessions/${s.id}/result`)).json.result;
    assert.equal(marked.score, 20);
    assert.equal(marked.correctCount, 1);
    assert.equal(marked.subjectCode, 'MTH101');
    assert.equal(marked.status, 'submitted');
    assert.ok(marked.submittedAt);
    assert.ok(marked.timeTakenSeconds >= 1);
    assert.equal(marked.questions.length, 5);
    assert.equal(marked.questions.filter((q) => q.isCorrect).length, 1);

    const [first, second, third] = marked.questions;
    assert.equal(first.selectedOption, right);
    assert.equal(first.correctOption, right);
    assert.equal(first.isCorrect, true);
    assert.equal(second.selectedOption, wrong);
    assert.equal(second.correctOption, stored.questions[1].correctOption);
    assert.equal(second.isCorrect, false);
    // Flags survive into the corrections.
    assert.equal(second.markedForReview, true);
    // A skipped question says so, and is not counted as right.
    assert.equal(third.selectedOption, null);
    assert.equal(third.isCorrect, false);

    marked.questions.forEach((q, index) => {
      assert.equal(q.index, index);
      assert.match(q.id, /^[0-9a-f]{24}$/);
      assert.equal(q.topic, 'Algebra');
      assert.equal(typeof q.explanation, 'string');
    });

    // Reading the result again must not re-mark or re-time the attempt.
    const again = (await c.call('GET', `/exam-sessions/${s.id}/result`)).json.result;
    assert.equal(again.score, 20);
    assert.equal(again.submittedAt, marked.submittedAt);
  });

  it('builds a Post-UTME paper with sections, and keeps the answer key for the corrections only', async () => {
    const { c } = await student({ paid: true });
    const res = await c.call('POST', '/post-utme/start', { body: { subjects: ['MTH101', 'PHY101', 'ENG101'] } });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const s = res.json.session;

    assert.equal(s.timeLimitSeconds, 3600);
    assert.ok(new Date(s.expiresAt).getTime() > Date.now());
    assert.equal(s.totalQuestions, 40);
    // Three electives plus the compulsory paper.
    assert.equal(s.subjectCodes.length, 4);
    assert.ok(s.subjectCodes.includes('GST101'));
    assert.equal(s.status, 'in_progress');
    // A mixed paper has no single calculator policy, so the client's own default applies.
    assert.equal(s.allowCalculator, undefined);

    assert.equal(s.questions.length, 40);
    const sections = new Map();
    s.questions.forEach((q, index) => {
      assert.equal(q.index, index);
      assert.match(q.id, /^[0-9a-f]{24}$/);
      // The section strip groups by `subject` and labels from `subjectCodes`.
      assert.match(q.subject, /^[0-9a-f]{24}$/);
      assert.ok(s.subjectCodes.includes(q.subjectCode));
      assert.equal(q.options.length, 4);
      assert.equal(typeof q.topic, 'string');
      assert.equal(q.selectedOption, null);
      assert.equal(q.markedForReview, false);
      // Never while the paper is live.
      assert.equal(q.correctOption, undefined);
      assert.equal(q.explanation, undefined);

      sections.set(q.subjectCode, (sections.get(q.subjectCode) ?? 0) + 1);
    });
    // Ten from each subject, however the shuffle interleaved them.
    assert.deepEqual([...sections.values()].sort((a, b) => a - b), [10, 10, 10, 10]);

    // Answer through the stored key: one right, one wrong.
    const stored = await m.PostUtmeSession.findById(s.id);
    const right = stored.questions[0].correctOption;
    const wrong = (stored.questions[1].correctOption + 1) % stored.questions[1].options.length;

    const patched = await c.call('PATCH', `/post-utme/${s.id}/answer`, { body: { questionIndex: 0, selectedOption: right } });
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.json.answer, { index: 0, selectedOption: right, markedForReview: false });
    await c.call('PATCH', `/post-utme/${s.id}/answer`, { body: { questionIndex: 1, selectedOption: wrong, markedForReview: true } });
    assert.equal((await c.call('PATCH', `/post-utme/${s.id}/answer`, { body: { questionIndex: 99, selectedOption: 0 } })).status, 400);

    // The result screen fetches the marked paper by submitting.
    const submitted = await c.call('POST', `/post-utme/${s.id}/submit`);
    assert.equal(submitted.status, 200);
    const marked = submitted.json.session;
    assert.equal(marked.status, 'submitted');
    assert.equal(marked.totalScore, 1);
    assert.ok(marked.timeTakenSeconds >= 1);
    assert.equal(marked.questions[0].isCorrect, true);
    assert.equal(marked.questions[0].correctOption, right);
    assert.equal(marked.questions[1].isCorrect, false);
    assert.equal(marked.questions[1].markedForReview, true);
    assert.equal(typeof marked.questions[1].explanation, 'string');
    assert.equal(typeof marked.questions[1].subjectCode, 'string');
    // The per-subject tally the dashboard reads.
    assert.ok(marked.scores);

    // Opening the result a second time must not mark the attempt twice.
    const again = (await c.call('POST', `/post-utme/${s.id}/submit`)).json.session;
    assert.equal(again.totalScore, 1);
    assert.equal(again.submittedAt, marked.submittedAt);

    // Stats are the marked view too: the subject radar reads correctOption off them.
    const stats = (await c.call('GET', '/post-utme/stats')).json.stats;
    assert.equal(stats.length, 1);
    assert.equal(typeof stats[0].questions[0].correctOption, 'number');
    assert.equal(stats[0].questions[0].subjectCode, marked.questions[0].subjectCode);
    assert.equal(typeof stats[0].totalScore, 'number');
  });
});
