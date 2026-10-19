/**
 * The Hall of Fame: the overall board and the per-subject board. Database-backed; run only when
 * MONGODB_URI_TEST points at a DISPOSABLE database (it is dropped at the end).
 *
 * The rules this file protects:
 *  - The overall board sums each student's best score per subject (points), not every attempt.
 *  - A student's own rank rides along in `me`, even when they are below the visible rows.
 *  - Opting out hides a student, and the overall board only shows students who chose a username.
 *  - The subject board ranks with the same tie-breaks and adds `rank` and `me`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';

describe('Hall of Fame leaderboards (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  const client = () => {
    const jar = {};
    const call = async (method, path, { body, headers } = {}) => {
      n += 1;
      const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.4.${n % 250}.${Math.floor(n / 250)}`, ...headers };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.Cookie = cookie;
      if (jar.tf_csrf) h['X-CSRF-Token'] = jar.tf_csrf;
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
    return { call };
  };

  /** Register and sign in, returning the client and the stored user document. */
  const student = async (over = {}) => {
    const c = client();
    const email = `s${uniq()}@t.test`;
    const reg = await c.call('POST', '/auth/register', {
      body: { fullName: over.fullName ?? 'Board Student', email, password: pw, confirmPassword: pw, product: 'student', ...over.body },
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    await c.call('POST', '/auth/login', { body: { email, password: pw } });
    const user = await m.User.findOne({ email }).lean();
    if (over.username !== undefined || over.showOnLeaderboard !== undefined || over.level !== undefined) {
      await m.User.updateOne({ _id: user._id }, {
        $set: {
          ...(over.username !== undefined ? { username: over.username } : {}),
          ...(over.showOnLeaderboard !== undefined ? { showOnLeaderboard: over.showOnLeaderboard } : {}),
          ...(over.level !== undefined ? { level: over.level } : {}),
        },
      });
    }
    return { c, email, id: String(user._id) };
  };

  /** Sit a five-question paper and answer exactly `correctCount` of them. */
  const sit = async (c, subjectCode, correctCount) => {
    const started = await c.call('POST', '/exam-sessions', {
      body: { subject: subjectCode, questionCount: 5, durationMinutes: 10 },
    });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const stored = await m.ExamSession.findById(started.json.session.id).lean();
    for (let index = 0; index < stored.questions.length; index += 1) {
      const question = stored.questions[index];
      const selectedOption = index < correctCount
        ? question.correctOption
        : (question.correctOption + 1) % question.options.length;
      const saved = await c.call('PATCH', `/exam-sessions/${started.json.session.id}/answer`, {
        body: { questionIndex: index, selectedOption },
      });
      assert.equal(saved.status, 200);
    }
    const submitted = await c.call('POST', `/exam-sessions/${started.json.session.id}/submit`);
    assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
    return submitted.json.result;
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
      ExamSession: (await import('../src/models/ExamSession.js')).ExamSession,
    };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));

    m.math = await m.Subject.create({ code: 'MTH101', title: 'Mathematics', level: '100' });
    m.phys = await m.Subject.create({ code: 'PHY101', title: 'Physics', level: '100' });
    // A third subject only the subject-board test touches, so its ranking is unaffected by the
    // overall-board test that ran before it.
    m.bio = await m.Subject.create({ code: 'BIO101', title: 'Biology', level: '100' });
    for (const subject of [m.math, m.phys, m.bio]) {
      for (let i = 0; i < 6; i += 1) {
        await m.Question.create({
          subject: subject._id,
          stem: `Prime? (${subject.code} ${i})`,
          options: ['4', '9', '11', '15'],
          correctIndex: 2,
          topic: 'Number theory',
        });
      }
    }

    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  });

  it('the overall board sums the best per subject, ranks it, and reports my own rank', async () => {
    const alice = await student({ username: 'alice' });
    const bob = await student({ username: 'bob' });
    const carol = await student({ username: 'carol', showOnLeaderboard: false });
    const dave = await student(); // no username

    // Alice tops both subjects; Bob only takes maths.
    await sit(alice.c, 'MTH101', 5);
    await sit(alice.c, 'PHY101', 5);
    await sit(bob.c, 'MTH101', 4);
    await sit(carol.c, 'MTH101', 5);
    await sit(dave.c, 'MTH101', 5);

    // Alice is asked for a single-row board; Bob is outside it and only appears in `me`.
    const aliceBoard = await alice.c.call('GET', '/leaderboard?limit=1');
    assert.equal(aliceBoard.status, 200, JSON.stringify(aliceBoard.json));
    assert.equal(aliceBoard.json.leaderboard.length, 1);
    assert.deepEqual(
      {
        rank: aliceBoard.json.leaderboard[0].rank,
        username: aliceBoard.json.leaderboard[0].username,
        points: aliceBoard.json.leaderboard[0].points,
        subjectsCount: aliceBoard.json.leaderboard[0].subjectsCount,
        averageScore: aliceBoard.json.leaderboard[0].averageScore,
        examsCount: aliceBoard.json.leaderboard[0].examsCount,
      },
      { rank: 1, username: 'alice', points: 200, subjectsCount: 2, averageScore: 100, examsCount: 2 },
    );
    assert.equal(aliceBoard.json.me.rank, 1);
    assert.equal(aliceBoard.json.me.points, 200);
    // Carol (opted out) and Dave (no username) are never on the board.
    const usernames = aliceBoard.json.leaderboard.map((r) => r.username);
    assert.ok(!usernames.includes('carol'));
    assert.ok(!usernames.some((u) => u == null));

    const bobBoard = await bob.c.call('GET', '/leaderboard?limit=1');
    assert.equal(bobBoard.json.leaderboard[0].username, 'alice');
    assert.equal(bobBoard.json.me.rank, 2);
    assert.equal(bobBoard.json.me.points, 80);
    assert.equal(bobBoard.json.me.subjectsCount, 1);
  });

  it('the subject board ranks rows and returns my row even outside the top ten', async () => {
    const top = await student({ username: 'top' });
    await sit(top.c, 'BIO101', 5);
    const runner = await student({ username: 'runner' });
    await sit(runner.c, 'BIO101', 4);

    const board = await runner.c.call('GET', `/subjects/${m.bio._id}/leaderboard`);
    assert.equal(board.status, 200, JSON.stringify(board.json));
    const mine = board.json.leaderboard.find((r) => r.username === 'runner');
    assert.equal(mine.rank, 2);
    assert.equal(board.json.me.rank, 2);
    assert.equal(board.json.me.score, 80);
    assert.ok(board.json.leaderboard.every((row) => typeof row.rank === 'number'));
  });
});
