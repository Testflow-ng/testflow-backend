/**
 * Everybody step 2 — exams, the paper, marking, results and the tenant sitting flow.
 *
 * Run only when MONGODB_URI_TEST points at a DISPOSABLE database (it is dropped at the end):
 *   MONGODB_URI_TEST=mongodb://127.0.0.1:27019/tf_org_exam_test node --test tests/orgExamFlow.integration.test.js
 *
 * The rules this file protects:
 *  - A paper cannot be published empty, and a live exam cannot start in the past.
 *  - A published exam that has been sat locks its questions, duration and negative marking.
 *  - A draft that was never sat is deleted; anything else is archived.
 *  - A question a live paper relies on is only soft-deleted, never removed.
 *  - `showCorrections` decides what a student may see; `hidden` never leaks a score, even on submit.
 *  - A priced exam needs a verified payment before the server lets a student start it.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'MONGODB_URI_TEST not set';

process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.CSRF_TOKEN_MODE = 'enforce';

describe('Everybody step 2 — exams, results and the tenant sitting flow (integration)', { skip }, () => {
  let m; let server; let base;
  const pw = 'Passw0rdTest';
  const uniq = () => crypto.randomBytes(4).toString('hex');
  let n = 0;

  /** A cookie-jar client. `defaultHeaders` lets a tenant client carry `X-Tenant-Host` on every call. */
  const client = (defaultHeaders = {}) => {
    const jar = {};
    const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const callRaw = async (method, path, { body, headers } = {}) => {
      n += 1;
      const h = { 'X-Forwarded-For': `10.7.${n % 250}.${Math.floor(n / 250)}`, ...defaultHeaders, ...headers };
      const cookie = cookieHeader();
      if (cookie) h.Cookie = cookie;
      if (jar.tf_csrf) h['X-CSRF-Token'] = jar.tf_csrf;
      const res = await fetch(`${base}${path}`, { method, headers: h, body });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (!value || /expires=Thu, 01 Jan 1970/i.test(c)) delete jar[name]; else jar[name] = value;
      }
      return res;
    };
    const call = async (method, path, { body, headers } = {}) => {
      const res = await callRaw(method, path, {
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null, text };
    };
    return { call, callRaw, jar };
  };

  const registerLogin = async (over = {}) => {
    const c = client();
    const email = `o${uniq()}@t.test`;
    const reg = await c.call('POST', '/api/auth/register', {
      body: { fullName: 'Org Owner', email, password: pw, confirmPassword: pw, ...over },
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    const login = await c.call('POST', '/api/auth/login', { body: { email, password: pw } });
    assert.equal(login.status, 200);
    return { c, email };
  };

  const mkOrg = async (c) => {
    const created = await c.call('POST', '/api/v1/everybody/organizations', { body: { name: `Academy ${uniq()}` } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    return { id: created.json.organization.id, slug: created.json.organization.slug };
  };

  /** Give the org a specific plan by writing the subscription the entitlement lookup reads. */
  const setPlan = async (orgId, planKey) => {
    const { Subscription } = await import('../src/models/Subscription.js');
    const { PLAN_ENTITLEMENTS } = await import('../src/config/planFeatures.js');
    await Subscription.deleteMany({ organization: orgId });
    await Subscription.create({
      organization: orgId,
      planKey,
      status: 'active',
      currentPeriodEnd: planKey === 'free' ? null : new Date(Date.now() + 30 * 24 * 3600 * 1000),
      planSnapshot: { priceMinor: 0, currency: 'NGN', entitlements: { ...PLAN_ENTITLEMENTS[planKey] } },
      provider: 'none',
    });
  };

  const activatePayout = async (orgId) => {
    const { Organization } = await import('../src/models/Organization.js');
    await Organization.updateOne(
      { _id: orgId },
      { $set: { 'payout.status': 'active', 'payout.subaccountCode': 'ACCT_test', 'payout.accountName': 'Test Org' } },
    );
  };

  const createExam = async (c, orgId, body) => {
    const res = await c.call('POST', `/api/v1/everybody/organizations/${orgId}/exams`, { body });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.json.exam;
  };

  const addQuestion = async (c, orgId, body) => {
    const res = await c.call('POST', `/api/v1/everybody/organizations/${orgId}/questions`, { body });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.json.question;
  };

  const publish = (c, orgId, examId) =>
    c.call('POST', `/api/v1/everybody/organizations/${orgId}/exams/${examId}/publish`);

  const tenantClient = (slug, over) => client({ 'X-Tenant-Host': `${slug}.testflow.com.ng`, ...over });

  const registerStudent = async (slug, fullName = 'Site Student') => {
    const t = tenantClient(slug);
    const email = `s${uniq()}@t.test`;
    const res = await t.call('POST', '/api/v1/public/auth/register', { body: { fullName, email, password: pw } });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return { t, email };
  };

  /** A one-question exam that is ready to sit, on whatever plan the caller set. */
  const examWithOneQuestion = async (c, orgId, examOver = {}, questionOver = {}) => {
    const exam = await createExam(c, orgId, { title: `Paper ${uniq()}`, durationMinutes: 30, ...examOver });
    const q = await addQuestion(c, orgId, {
      stem: 'Which number is prime?',
      options: ['2', '4', '6', '9'],
      correctIndex: 0,
      examId: exam.id,
      ...questionOver,
    });
    return { exam, q };
  };

  before(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    m = { mongoose };
    await Promise.all(Object.values(mongoose.models).map((mod) => mod.init()));
    const { seedPlans } = await import('../src/scripts/seed-plans.js');
    await seedPlans();
    const { setOrgPaystackForTests } = await import('../src/services/orgPaystack.service.js');
    // No network in tests: a fake provider that reports success only for the references the test
    // marks as paid, and that the webhook path can drive directly.
    fakeState = {
      paid: new Set(),
      amountKobo: 0,
      signature: 'test-signature',
      verifyWebhookSignature: (rawBody, signature) => signature === fakeState.signature,
    };
    setOrgPaystackForTests({
      initialize: async ({ reference }) => ({ authorizationUrl: `https://pay.test/${reference}` }),
      verify: async (reference) => (fakeState.paid.has(reference)
        ? { status: 'success', amountKobo: fakeState.amountKobo, currency: 'NGN', transactionId: `tx_${reference}`, paidAt: new Date() }
        : { status: 'pending' }),
      refund: async () => ({ refundId: 'ref_test', status: 'processed' }),
      verifyWebhookSignature: (rawBody, signature) => fakeState.verifyWebhookSignature(rawBody, signature),
      parseWebhook: (body) => ({ type: body?.event, reference: body?.data?.reference, eventId: null, refundReference: null }),
    });
    const app = (await import('../src/app.js')).default;
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  });

  let fakeState;

  it('publish refuses an empty exam; live refuses a past start and needs Studio', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);

    const empty = await createExam(c, org.id, { title: 'Empty', durationMinutes: 10 });
    const publishEmpty = await publish(c, org.id, empty.id);
    assert.equal(publishEmpty.status, 422);
    assert.equal(publishEmpty.json.error.code, 'NO_QUESTIONS');

    // Live on Free is a plan error, not a validation error.
    const liveOnFree = await c.call('POST', `/api/v1/everybody/organizations/${org.id}/exams`, {
      body: { title: 'Live', durationMinutes: 30, mode: 'live', startsAt: new Date(Date.now() + 3600_000).toISOString() },
    });
    assert.equal(liveOnFree.status, 402);
    assert.equal(liveOnFree.json.error.code, 'PLAN_REQUIRED');
    assert.equal(liveOnFree.json.error.details.feature, 'live_cbt');

    await setPlan(org.id, 'studio');
    const pastLive = await createExam(c, org.id, {
      title: 'Past live',
      durationMinutes: 30,
      mode: 'live',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await addQuestion(c, org.id, { stem: 'Q?', options: ['a', 'b'], correctIndex: 0, examId: pastLive.id });
    const publishPast = await publish(c, org.id, pastLive.id);
    assert.equal(publishPast.status, 422);
    assert.equal(publishPast.json.error.code, 'START_IN_PAST');
  });

  it('the sitting flow marks a paper and feeds the console results, students and CSV', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    const { exam } = await examWithOneQuestion(c, org.id);
    assert.equal((await publish(c, org.id, exam.id)).status, 200);

    const { t } = await registerStudent(org.slug, '=SUM(A1)');
    const start = await t.call('POST', `/api/v1/public/exams/${exam.id}/start`, { body: {} });
    assert.equal(start.status, 201, JSON.stringify(start.json));
    const attempt = start.json.attempt;
    assert.equal(attempt.totalQuestions, 1);
    assert.ok(attempt.endsAt);

    const save = await t.call('PATCH', `/api/v1/public/attempts/${attempt.id}/answers`, {
      body: { questionId: attempt.questions[0].id, selectedIndex: 0 },
    });
    assert.equal(save.status, 200);

    const submit = await t.call('POST', `/api/v1/public/attempts/${attempt.id}/submit`, { body: {} });
    assert.equal(submit.status, 200);
    assert.equal(submit.json.result.scorePercent, 100);
    assert.equal(submit.json.result.correct, 1);

    const results = await c.call('GET', `/api/v1/everybody/organizations/${org.id}/exams/${exam.id}/results`);
    assert.equal(results.status, 200);
    assert.equal(results.json.summary.attempts, 1);
    assert.equal(results.json.summary.average, 100);
    assert.equal(results.json.summary.highest, 100);
    assert.equal(results.json.summary.lowest, 100);
    assert.equal(results.json.items.length, 1);

    const students = await c.call('GET', `/api/v1/everybody/organizations/${org.id}/students`);
    assert.equal(students.status, 200);
    const student = students.json.items[0];
    assert.equal(student.attempts, 1);
    assert.equal(student.average, 100);

    const record = await c.call('GET', `/api/v1/everybody/organizations/${org.id}/students/${student.id}`);
    assert.equal(record.status, 200);
    assert.equal(record.json.attempts.length, 1);
    assert.ok(record.json.attempts[0].timeMinutes >= 1);

    const attemptDetail = await c.call('GET', `/api/v1/everybody/organizations/${org.id}/attempts/${attempt.id}`);
    assert.equal(attemptDetail.status, 200);

    const csv = await c.callRaw('GET', `/api/v1/everybody/organizations/${org.id}/exams/${exam.id}/results.csv`);
    assert.equal(csv.status, 200);
    const csvText = await csv.text();
    assert.match(csvText, /^student,email,scorePercent/);
    // The student's name starts with "=", so the cell is neutralised with a leading apostrophe.
    assert.ok(csvText.includes(`"'=SUM(A1)"`), csvText);
  });

  it('showCorrections=hidden never leaks a score, including in the submit response', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    const { exam } = await examWithOneQuestion(c, org.id, { showCorrections: 'hidden' });
    await publish(c, org.id, exam.id);

    const { t } = await registerStudent(org.slug);
    const start = await t.call('POST', `/api/v1/public/exams/${exam.id}/start`, { body: {} });
    const attempt = start.json.attempt;
    await t.call('PATCH', `/api/v1/public/attempts/${attempt.id}/answers`, {
      body: { questionId: attempt.questions[0].id, selectedIndex: 0 },
    });
    const submit = await t.call('POST', `/api/v1/public/attempts/${attempt.id}/submit`, { body: {} });
    assert.equal(submit.status, 200);
    assert.equal(submit.json.result.hidden, true);
    assert.equal(submit.json.result.scorePercent, undefined);

    const one = await t.call('GET', `/api/v1/public/results/${attempt.id}`);
    assert.equal(one.status, 200);
    assert.equal(one.json.hidden, true);
    assert.equal(one.json.scorePercent, undefined);

    const list = await t.call('GET', '/api/v1/public/results');
    assert.equal(list.status, 200);
    assert.equal(list.json.items[0].hidden, true);
  });

  it('showCorrections=score_only returns a score but no corrections', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    const { exam } = await examWithOneQuestion(c, org.id, { showCorrections: 'score_only' });
    await publish(c, org.id, exam.id);

    const { t } = await registerStudent(org.slug);
    const start = await t.call('POST', `/api/v1/public/exams/${exam.id}/start`, { body: {} });
    const attempt = start.json.attempt;
    const submit = await t.call('POST', `/api/v1/public/attempts/${attempt.id}/submit`, { body: {} });
    assert.equal(submit.json.result.hidden, false);
    assert.equal(submit.json.result.scorePercent, 0);
    assert.equal(submit.json.result.corrections, null);
    assert.equal(submit.json.result.correctionsAvailable, false);
  });

  it('a published exam that was sat locks its paper; delete hard-deletes a draft, archives anything else', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    const { exam, q } = await examWithOneQuestion(c, org.id);
    await publish(c, org.id, exam.id);

    const { t } = await registerStudent(org.slug);
    const start = await t.call('POST', `/api/v1/public/exams/${exam.id}/start`, { body: {} });
    await t.call('POST', `/api/v1/public/attempts/${start.json.attempt.id}/submit`, { body: {} });

    const locked = await c.call('PATCH', `/api/v1/everybody/organizations/${org.id}/exams/${exam.id}`, {
      body: { questionIds: [q.id], durationMinutes: 45 },
    });
    assert.equal(locked.status, 409);
    assert.equal(locked.json.error.code, 'EXAM_LOCKED');

    const del = await c.call('DELETE', `/api/v1/everybody/organizations/${org.id}/exams/${exam.id}`);
    assert.equal(del.status, 200);
    assert.equal(del.json.archived, true);
    assert.equal(del.json.deleted, false);

    const draft = await createExam(c, org.id, { title: 'Never sat', durationMinutes: 10 });
    const delDraft = await c.call('DELETE', `/api/v1/everybody/organizations/${org.id}/exams/${draft.id}`);
    assert.equal(delDraft.status, 200);
    assert.equal(delDraft.json.deleted, true);
  });

  it('a question a sat paper relied on is soft-deleted, and the bank delete reports both counts', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    await setPlan(org.id, 'pro');

    const bank = await c.call('POST', `/api/v1/everybody/organizations/${org.id}/question-banks`, { body: { name: `Bank ${uniq()}` } });
    assert.equal(bank.status, 201, JSON.stringify(bank.json));
    const bankId = bank.json.bank.id;

    const exam = await createExam(c, org.id, { title: `Banked ${uniq()}`, durationMinutes: 20 });
    const lockedQ = await addQuestion(c, org.id, {
      stem: 'Used by a sat paper?', options: ['yes', 'no'], correctIndex: 0, examId: exam.id, bankId,
    });
    await addQuestion(c, org.id, { stem: 'Unused', options: ['a', 'b'], correctIndex: 1, bankId });
    await publish(c, org.id, exam.id);

    const { t } = await registerStudent(org.slug);
    const start = await t.call('POST', `/api/v1/public/exams/${exam.id}/start`, { body: {} });
    await t.call('POST', `/api/v1/public/attempts/${start.json.attempt.id}/submit`, { body: {} });

    const delQ = await c.call('DELETE', `/api/v1/everybody/organizations/${org.id}/questions/${lockedQ.id}`);
    assert.equal(delQ.status, 200);
    assert.equal(delQ.json.softDeleted, true);
    assert.equal(delQ.json.deleted, false);

    const delBank = await c.call('DELETE', `/api/v1/everybody/organizations/${org.id}/question-banks/${bankId}`);
    assert.equal(delBank.status, 200);
    assert.equal(delBank.json.softDeleted, 1);
    assert.equal(delBank.json.deleted, 1);
  });

  it('a priced exam is 402 until a verified payment lands', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    await setPlan(org.id, 'studio');
    await activatePayout(org.id);

    const { exam } = await examWithOneQuestion(c, org.id, { priceMinor: 50_000, currency: 'NGN' });
    assert.equal((await publish(c, org.id, exam.id)).status, 200);

    const { t } = await registerStudent(org.slug);
    const blocked = await t.call('POST', `/api/v1/public/exams/${exam.id}/start`, { body: {} });
    assert.equal(blocked.status, 402);
    assert.equal(blocked.json.error.code, 'PAYMENT_REQUIRED');
    assert.equal(blocked.json.error.details.priceMinor, 50_000);

    const checkout = await t.call('POST', `/api/v1/public/exams/${exam.id}/checkout`, { body: {} });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
    assert.equal(checkout.json.amountKobo, 50_000);
    assert.ok(checkout.json.authorizationUrl);

    // The provider confirms this reference, then the student re-checks.
    fakeState.amountKobo = 50_000;
    fakeState.paid.add(checkout.json.reference);
    const verify = await t.call('GET', `/api/v1/public/payments/verify?reference=${checkout.json.reference}`);
    assert.equal(verify.status, 200);
    assert.equal(verify.json.access, true);

    // A second verify is a no-op that still says paid.
    const verifyAgain = await t.call('GET', `/api/v1/public/payments/verify?reference=${checkout.json.reference}`);
    assert.equal(verifyAgain.json.duplicate, true);
    assert.equal(verifyAgain.json.access, true);

    const start = await t.call('POST', `/api/v1/public/exams/${exam.id}/start`, { body: {} });
    assert.equal(start.status, 201);
  });

  it('the payment webhook is signature-checked and settles idempotently', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    await setPlan(org.id, 'studio');
    await activatePayout(org.id);
    const { exam } = await examWithOneQuestion(c, org.id, { priceMinor: 30_000 });
    await publish(c, org.id, exam.id);

    const { t } = await registerStudent(org.slug);
    const checkout = await t.call('POST', `/api/v1/public/exams/${exam.id}/checkout`, { body: {} });
    assert.equal(checkout.status, 201);

    fakeState.amountKobo = 30_000;
    fakeState.paid.add(checkout.json.reference);
    const body = JSON.stringify({ event: 'charge.success', data: { reference: checkout.json.reference } });

    const bad = await fetch(`${base}/api/v1/public/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'wrong' },
      body,
    });
    assert.equal(bad.status, 401);

    const ok1 = await fetch(`${base}/api/v1/public/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'test-signature' },
      body,
    });
    assert.equal(ok1.status, 200);
    const ok1Json = await ok1.json();
    assert.equal(ok1Json.status, 'paid');

    const ok2 = await fetch(`${base}/api/v1/public/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'test-signature' },
      body,
    });
    assert.equal((await ok2.json()).duplicate, true);
  });

  it('another tenant gets 404 for an attempt and an exam it does not own', async () => {
    const ownerA = await registerLogin();
    const orgA = await mkOrg(ownerA.c);
    const { exam } = await examWithOneQuestion(ownerA.c, orgA.id);
    await publish(ownerA.c, orgA.id, exam.id);

    const studentA = await registerStudent(orgA.slug);
    const start = await studentA.t.call('POST', `/api/v1/public/exams/${exam.id}/start`, { body: {} });
    const attemptId = start.json.attempt.id;

    // A second organisation's owner cannot reach A's attempt, and a student on B's site cannot
    // fetch A's result by id (the attempt is scoped to A).
    const ownerB = await registerLogin();
    const orgB = await mkOrg(ownerB.c);
    assert.equal((await ownerB.c.call('GET', `/api/v1/everybody/organizations/${orgA.id}/attempts/${attemptId}`)).status, 404);

    const studentB = await registerStudent(orgB.slug);
    const crossStart = await studentB.t.call('POST', `/api/v1/public/exams/${exam.id}/start`, { body: {} });
    assert.equal(crossStart.status, 404);
    const crossResult = await studentB.t.call('GET', `/api/v1/public/results/${attemptId}`);
    assert.equal(crossResult.status, 404);
  });

  it('CSV import: a dry run validates, the real run writes, and bad rows are reported', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    const exam = await createExam(c, org.id, { title: `Imported ${uniq()}`, durationMinutes: 15 });

    const csvText = [
      'stem,options,correctIndex,explanation',
      '"What is 2+2?","4|5|6",0,"basic addition"',
      '"Broken row","4|5",9,""',
      '',
    ].join('\r\n');
    const file = () => {
      const form = new FormData();
      form.append('file', new Blob([csvText], { type: 'text/csv' }), 'questions.csv');
      return form;
    };

    const dry = await c.callRaw('POST', `/api/v1/everybody/organizations/${org.id}/questions/import?examId=${exam.id}&dryRun=true`, { body: file() });
    assert.equal(dry.status, 200);
    const dryJson = await dry.json();
    assert.equal(dryJson.dryRun, true);
    assert.equal(dryJson.valid, 1);
    assert.equal(dryJson.failed.length, 1);
    assert.equal(dryJson.failed[0].row, 3);

    const real = await c.callRaw('POST', `/api/v1/everybody/organizations/${org.id}/questions/import?examId=${exam.id}`, { body: file() });
    assert.equal(real.status, 201);
    const realJson = await real.json();
    assert.equal(realJson.imported, 1);
    assert.equal(realJson.failed.length, 1);

    const examQuestions = await c.call('GET', `/api/v1/everybody/organizations/${org.id}/exams/${exam.id}/questions`);
    assert.equal(examQuestions.status, 200);
    assert.equal(examQuestions.json.items.length, 1);

    const template = await c.callRaw('GET', `/api/v1/everybody/organizations/${org.id}/questions/import/template`);
    assert.equal(template.status, 200);
    assert.match(await template.text(), /^stem,options,correctIndex/);
  });

  it('image quota is enforced per organisation before the object store is touched', async () => {
    const { c } = await registerLogin();
    const org = await mkOrg(c);
    const { OrgAsset } = await import('../src/models/OrgAsset.js');
    const rows = Array.from({ length: 50 }, (_, i) => ({
      organization: org.id, kind: 'image', storageKey: `org/${org.id}/image/${i}.webp`,
      url: `https://cdn.test/${i}.webp`, mimeType: 'image/webp', size: 100,
    }));
    await OrgAsset.insertMany(rows);

    const form = new FormData();
    const { default: sharp } = await import('sharp');
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toBuffer();
    form.append('file', new Blob([png], { type: 'image/png' }), 'logo.png');
    const res = await c.callRaw('POST', `/api/v1/everybody/organizations/${org.id}/questions/assets`, { body: form });
    assert.equal(res.status, 422);
    const json = await res.json();
    assert.equal(json.error.code, 'STORAGE_LIMIT');
  });
});
