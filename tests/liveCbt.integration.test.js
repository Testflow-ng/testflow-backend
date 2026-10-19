/**
 * Live CBT delivery — database-backed tests. Run only when MONGODB_URI_TEST points at a
 * DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/testflow_live_test node --test tests/liveCbt.integration.test.js
 *
 * The rule this file protects: the paper is handed out once, and a participant whose connection
 * drops can keep answering. Their answers live on their device until they submit, and whatever the
 * best-effort autosave never delivered still counts when the paper finally arrives.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';

describe('Live CBT delivery (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  /** Minimal cookie jar. Each call gets a unique X-Forwarded-For so shared rate limits never interfere. */
  const client = () => {
    const jar = {};
    const call = async (method, path, { body, json = true, headers, csrf = true } = {}) => {
      const h = { 'X-Forwarded-For': `10.9.${(n += 1) % 250}.${Math.floor(n / 250)}`, ...headers };
      if (json) h['Content-Type'] = 'application/json';
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
      return { status: res.status, json: text ? JSON.parse(text) : null };
    };
    return { call, jar };
  };

  const account = async () => {
    const email = `l${uniq()}@t.test`;
    const c = client();
    const reg = await c.call('POST', '/auth/register', {
      body: { fullName: 'Live Tester', email, password: pw, confirmPassword: pw, product: 'student' },
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    const login = await c.call('POST', '/auth/login', { body: { email, password: pw } });
    assert.equal(login.status, 200);
    const user = await m.User.findOne({ email }).lean();
    return { c, email, userId: String(user._id) };
  };

  /** Host + one approved participant, exam already running. Returns the share code and the paper. */
  const runningExam = async ({ numQuestions = 8, durationMinutes = 30 } = {}) => {
    const host = await account();
    const student = await account();
    const created = await host.c.call('POST', '/live-cbt', {
      body: { title: `Live ${uniq()}`, subject: 'LIV101', numQuestions, durationMinutes },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const code = created.json.exam.shareCode;

    assert.equal((await student.c.call('POST', `/live-cbt/${code}/join`)).status, 201);
    const approved = await host.c.call('POST', `/live-cbt/${code}/approve`, { body: { userId: student.userId } });
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    const started = await host.c.call('POST', `/live-cbt/${code}/start`);
    assert.equal(started.status, 200, JSON.stringify(started.json));

    const paper = await student.c.call('GET', `/live-cbt/${code}/questions`);
    assert.equal(paper.status, 200, JSON.stringify(paper.json));
    return { code, host, student, exam: paper.json.exam };
  };

  const participantDoc = async (code, userId) => {
    const examId = await m.examId(code);
    return m.LiveParticipant.findOne({ liveExam: examId, user: userId });
  };

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = {
      mongoose,
      User: (await import('../src/models/User.js')).User,
      Subject: (await import('../src/models/Subject.js')).Subject,
      Question: (await import('../src/models/Question.js')).Question,
      LiveExam: (await import('../src/models/LiveExam.js')).LiveExam,
      LiveParticipant: (await import('../src/models/LiveParticipant.js')).LiveParticipant,
    };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));

    m.examId = async (code) => {
      const exam = await m.LiveExam.findOne({ shareCode: code }).select('_id').lean();
      return exam._id;
    };

    const subject = await m.Subject.create({ code: 'LIV101', title: 'Live Test Subject', level: '100' });
    await m.Question.create(
      Array.from({ length: 10 }, (_, i) => ({
        subject: subject._id,
        stem: `Live question ${i}: pick the right one.`,
        options: ['alpha', 'bravo', 'charlie', 'delta'],
        correctIndex: i % 4,
        explanation: `Live ${i} works because alpha is the only one that fits.`,
      })),
    );

    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
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

  it('hands the paper out once, and never with the answer key', async () => {
    const { exam } = await runningExam();
    assert.equal(exam.questions.length, 8);
    assert.equal(exam.attemptStatus, 'in_progress');
    assert.ok(exam.endsAt && exam.serverTime, 'the paper carries the authoritative clock');
    for (const [index, q] of exam.questions.entries()) {
      assert.equal(q.index, index, 'the paper is ordered by the index answers are patched by');
      assert.equal(q.selectedOption, null);
      assert.equal(q.options.length, 4);
      assert.ok(!('correctOption' in q), 'the answer key must not reach the browser');
      assert.ok(!('explanation' in q), 'the explanation must not reach the browser');
    }
  });

  it('applies the answers a submit carries, and scores them with the stored ones', async () => {
    const { code, student, exam } = await runningExam();
    // Two answers reach the server during the sitting.
    for (const q of exam.questions.slice(0, 2)) {
      const res = await student.c.call('PATCH', `/live-cbt/${code}/answer`, {
        body: { questionIndex: q.index, selectedOption: 0 },
      });
      assert.equal(res.status, 200);
    }
    // Two more were answered while the connection was down. The participant knows the right option
    // for each (the key lives on the server), so hand in the ones the autosave never delivered.
    const doc = await participantDoc(code, student.userId);
    const batch = exam.questions.slice(2, 4).map((q) => ({ questionIndex: q.index, selectedOption: doc.questions[q.index].correctOption }));

    const res = await student.c.call('POST', `/live-cbt/${code}/submit`, { body: { answers: batch } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.result.answersAccepted, 2);
    assert.equal(res.json.result.attemptStatus, 'submitted');
    assert.equal(res.json.result.score, null, 'the score stays hidden until the host publishes');

    const after = await participantDoc(code, student.userId);
    assert.equal(after.attemptStatus, 'submitted');
    assert.equal(after.questions[2].selectedOption, doc.questions[2].correctOption);
    assert.equal(after.questions[3].selectedOption, doc.questions[3].correctOption);
    const expectedCorrect = [0, 1, 2, 3].filter((i) => {
      const selected = i < 2 ? 0 : doc.questions[i].correctOption;
      return selected === doc.questions[i].correctOption;
    }).length;
    assert.equal(after.correctCount, expectedCorrect, 'both offline answers were scored');
    assert.equal(after.incorrectCount, 4 - expectedCorrect);
    assert.equal(after.unansweredCount, 4);
  });

  it('counts a paper answered offline when the clock ran out while it was disconnected', async () => {
    const { code, student, exam } = await runningExam();
    // The deadline passes with the client offline: nothing was ever autosaved.
    const deadline = new Date(Date.now() - 1000);
    await m.LiveExam.updateOne({ shareCode: code }, { $set: { endsAt: deadline } });
    const doc = await participantDoc(code, student.userId);
    const batch = exam.questions.slice(0, 4).map((q) => ({ questionIndex: q.index, selectedOption: doc.questions[q.index].correctOption }));

    const res = await student.c.call('POST', `/live-cbt/${code}/submit`, { body: { answers: batch } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.result.answersAccepted, 4);
    assert.equal(res.json.result.attemptStatus, 'timed_out', 'the sitting stays timed out; only the work is kept');
    assert.equal(res.json.result.answersRejected, undefined);

    const after = await participantDoc(code, student.userId);
    assert.equal(after.correctCount, 4);
    assert.equal(after.incorrectCount, 0);
    assert.equal(after.submittedAt.getTime(), deadline.getTime(), 'the sitting closed at the deadline, not when the paper arrived');

    // A retry of the same paper changes nothing and never double-counts.
    const retry = await student.c.call('POST', `/live-cbt/${code}/submit`, { body: { answers: batch } });
    assert.equal(retry.status, 200);
    assert.equal(retry.json.result.answersAccepted, 0);
    assert.equal((await participantDoc(code, student.userId)).correctCount, 4);
  });

  it('still accepts a submit with no body at all', async () => {
    const { code, student } = await runningExam();
    const res = await student.c.call('POST', `/live-cbt/${code}/submit`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.result.attemptStatus, 'submitted');
    assert.equal(res.json.result.answersAccepted, 0);
  });

  it('refuses a late batch once results are out, and says so', async () => {
    const { code, host, student } = await runningExam();
    assert.equal((await host.c.call('POST', `/live-cbt/${code}/end`)).status, 200);
    assert.equal((await host.c.call('POST', `/live-cbt/${code}/publish`)).status, 200);

    const res = await student.c.call('POST', `/live-cbt/${code}/submit`, {
      body: { answers: [{ questionIndex: 0, selectedOption: 1 }] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.result.answersAccepted, 0);
    assert.equal(res.json.result.answersRejected, true, 'the client must be told its answers did not land');

    const after = await participantDoc(code, student.userId);
    assert.equal(after.questions[0].selectedOption, null, 'a released result is never rewritten');
  });
});
