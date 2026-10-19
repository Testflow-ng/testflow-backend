import { asyncHandler } from '../middleware/asyncHandler.js';
import * as content from '../services/orgContent.service.js';
import * as questionImport from '../services/orgQuestionImport.service.js';
import * as money from '../services/orgMoney.service.js';
import * as domains from '../services/orgDomain.service.js';
import * as site from '../services/orgSite.service.js';
import * as entitlements from '../services/entitlements.js';
import { Subscription } from '../models/Subscription.js';
import { PlanDefinition } from '../models/PlanDefinition.js';
import { SubscriptionPayment } from '../models/SubscriptionPayment.js';
import { PLAN_SEED } from '../scripts/seed-plans.js';
import { recordAction } from '../services/audit.service.js';

/* ------------------------------------------------------------------ exams */

export const listExams = asyncHandler(async (req, res) => {
  res.json(await content.listExams(req.org._id, req.query));
});

export const createExam = asyncHandler(async (req, res) => {
  const exam = await content.createExam(req.org, req.body, req.user._id);
  await recordAction({ actorId: req.user._id, action: 'ORG_EXAM_CREATE', targetId: req.org._id, targetType: 'Organization', metadata: { examId: exam.id }, req });
  res.status(201).json({ exam });
});

export const getExam = asyncHandler(async (req, res) => {
  res.json({ exam: await content.getExam(req.org._id, req.params.examId) });
});

export const getExamQuestions = asyncHandler(async (req, res) => {
  res.json(await content.getExamQuestions(req.org._id, req.params.examId));
});

export const setExamQuestions = asyncHandler(async (req, res) => {
  res.json({ exam: await content.setExamQuestions(req.org._id, req.params.examId, req.body.questionIds) });
});

export const getExamResults = asyncHandler(async (req, res) => {
  res.json(await content.getExamResults(req.org._id, req.params.examId, req.query));
});

/** Quote a cell and stop a spreadsheet from treating it as a formula. */
const csvCell = (value) => {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export const downloadExamResults = asyncHandler(async (req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="exam-${req.params.examId}-results.csv"`);
  res.set('Cache-Control', 'no-store');
  res.write('student,email,scorePercent,correct,total,timeMinutes,submittedAt,status\r\n');
  await content.forEachExamResultRow(req.org._id, req.params.examId, (row) => {
    res.write(
      [
        row.studentName,
        row.email,
        row.scorePercent,
        row.correct,
        row.total,
        row.timeMinutes,
        row.submittedAt ? new Date(row.submittedAt).toISOString() : '',
        row.status,
      ]
        .map(csvCell)
        .join(',') + '\r\n',
    );
  });
  res.end();
});

export const getAttempt = asyncHandler(async (req, res) => {
  res.json({ attempt: await content.getAttempt(req.org._id, req.params.attemptId) });
});

export const deleteExam = asyncHandler(async (req, res) => {
  res.json(await content.deleteExam(req.org._id, req.params.examId));
});

export const updateExam = asyncHandler(async (req, res) => {
  res.json({ exam: await content.updateExam(req.org, req.params.examId, req.body) });
});

export const publishExam = asyncHandler(async (req, res) => {
  res.json({ exam: await content.setExamPublished(req.org, req.params.examId, true) });
});

export const unpublishExam = asyncHandler(async (req, res) => {
  res.json({ exam: await content.setExamPublished(req.org, req.params.examId, false) });
});

/* -------------------------------------------------------------- questions */

export const listQuestions = asyncHandler(async (req, res) => {
  res.json(await content.listQuestions(req.org._id, req.query));
});

export const createQuestion = asyncHandler(async (req, res) => {
  res.status(201).json({ question: await content.createQuestion(req.org._id, req.body, req.user._id) });
});

export const updateQuestion = asyncHandler(async (req, res) => {
  res.json({ question: await content.updateQuestion(req.org._id, req.params.questionId, req.body) });
});

export const deleteQuestion = asyncHandler(async (req, res) => {
  res.json(await content.deleteQuestion(req.org._id, req.params.questionId));
});

export const bulkQuestions = asyncHandler(async (req, res) => {
  res.json(await content.bulkQuestions(req.org._id, req.body, req.user._id, req.query));
});

/** Shares the site uploader: question images are assets of the same organisation, same limits. */
export const uploadQuestionImage = asyncHandler(async (req, res) => {
  const asset = await site.uploadSiteAsset(req.org, req.file, 'image', req.user._id);
  res.status(201).json({ asset });
});

/** POST .../questions/import — a CSV, or a ZIP of `questions.csv` plus its images. */
export const importQuestions = asyncHandler(async (req, res) => {
  const result = await questionImport.importQuestionsFile(req.org, req.file?.buffer, {
    examId: req.query.examId,
    bankId: req.query.bankId,
    dryRun: req.query.dryRun,
    actorId: req.user._id,
  });
  res.status(result.dryRun ? 200 : 201).json(result);
});

/** GET .../questions/import/template — the exact CSV the importer expects. */
export const downloadQuestionTemplate = asyncHandler(async (_req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="questions-template.csv"');
  res.set('Cache-Control', 'no-store');
  res.send(questionImport.CSV_TEMPLATE);
});

/* --------------------------------------------------------- question banks */

export const listQuestionBanks = asyncHandler(async (req, res) => {
  res.json(await content.listBanks(req.org._id));
});

export const createQuestionBank = asyncHandler(async (req, res) => {
  res.status(201).json({ bank: await content.createBank(req.org._id, req.body, req.user._id) });
});

export const updateQuestionBank = asyncHandler(async (req, res) => {
  res.json({ bank: await content.updateBank(req.org._id, req.params.bankId, req.body) });
});

export const deleteQuestionBank = asyncHandler(async (req, res) => {
  res.json(await content.deleteBank(req.org._id, req.params.bankId));
});

export const listQuestionBankQuestions = asyncHandler(async (req, res) => {
  res.json(await content.listBankQuestions(req.org._id, req.params.bankId, req.query));
});

/* -------------------------------------------------------------- students */

export const listStudents = asyncHandler(async (req, res) => {
  res.json(await content.listStudents(req.org._id, req.query));
});

export const getStudent = asyncHandler(async (req, res) => {
  res.json(await content.getStudent(req.org._id, req.params.studentId));
});

/* ----------------------------------------------------------------- books */

export const listBooks = asyncHandler(async (req, res) => {
  res.json(await content.listBooks(req.org._id));
});

export const createBook = asyncHandler(async (req, res) => {
  res.status(201).json({ book: await content.createBook(req.org, req.body, req.user._id) });
});

export const updateBook = asyncHandler(async (req, res) => {
  res.json({ book: await content.updateBook(req.org, req.params.bookId, req.body) });
});

export const deleteBook = asyncHandler(async (req, res) => {
  res.json(await content.deleteBook(req.org._id, req.params.bookId));
});

/* ----------------------------------------------------------------- money */

export const listBanks = asyncHandler(async (_req, res) => {
  const { banks } = await money.listBanks();
  res.json({ banks });
});

export const verifyPayout = asyncHandler(async (req, res) => {
  await entitlements.requireFeature(req.org._id, 'paid_exams');
  res.json(await money.verifyPayoutAccount(req.body));
});

export const savePayout = asyncHandler(async (req, res) => {
  const payout = await money.savePayout(req.org, req.body);
  await recordAction({ actorId: req.user._id, action: 'ORG_PAYOUT_SAVE', targetId: req.org._id, targetType: 'Organization', metadata: { bankCode: req.body.bankCode }, req });
  res.json({ payout });
});

export const getEarnings = asyncHandler(async (req, res) => {
  res.json({ earnings: await money.getEarnings(req.org._id) });
});

export const listPayments = asyncHandler(async (req, res) => {
  res.json(await money.listOrgPayments(req.org._id, req.query));
});

/* --------------------------------------------------------------- domains */

export const listDomains = asyncHandler(async (req, res) => {
  res.json(await domains.listDomains(req.org._id));
});

export const checkSubdomain = asyncHandler(async (req, res) => {
  res.json(await domains.checkSubdomain(req.query.name));
});

export const addDomain = asyncHandler(async (req, res) => {
  const domain = await domains.addDomain(req.org, req.body);
  await recordAction({ actorId: req.user._id, action: 'ORG_DOMAIN_ADD', targetId: req.org._id, targetType: 'Organization', metadata: { hostname: domain.hostname, type: domain.type }, req });
  res.status(201).json({ domain });
});

export const verifyDomain = asyncHandler(async (req, res) => {
  res.json({ domain: await domains.verifyDomain(req.org._id, req.params.domainId) });
});

export const removeDomain = asyncHandler(async (req, res) => {
  res.json(await domains.removeDomain(req.org._id, req.params.domainId));
});

/* ----------------------------------------------- subscription (flat aliases) */

const entitlementKey = (plan) => plan?.entitlements ?? {};

const PLAN_NAMES = { free: 'Free', pro: 'Pro', studio: 'Studio' };

const consoleSubscription = (sub, planDef, pendingDef, entitlements) => ({
  id: String(sub._id),
  planKey: sub.planKey,
  planName: planDef?.name ?? PLAN_NAMES[sub.planKey] ?? sub.planKey,
  status: sub.status,
  priceMinor: sub.planSnapshot?.priceMinor ?? planDef?.priceMinor ?? 0,
  currency: sub.planSnapshot?.currency ?? planDef?.currency ?? 'NGN',
  interval: planDef?.interval ?? 'month',
  currentPeriodStart: sub.currentPeriodStart ?? null,
  currentPeriodEnd: sub.currentPeriodEnd ?? null,
  cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
  pendingPlanKey: sub.pendingPlanKey ?? null,
  pendingPlanName: pendingDef?.name ?? (sub.pendingPlanKey ? PLAN_NAMES[sub.pendingPlanKey] : null),
  // The feature matrix the console reads. `maxExams: null` means unlimited.
  entitlements: entitlements ?? undefined,
  adsEnabled: Boolean(entitlements?.adsEnabled ?? entitlementKey(sub.planSnapshot).adsEnabled ?? planDef?.entitlements?.adsEnabled ?? true),
  graceEndsAt: sub.graceEndsAt ?? null,
  reference: sub.providerReference ?? null,
  provider: sub.provider ?? null,
});

const planListItem = (p) => ({
  key: p.key,
  name: p.name,
  priceMinor: p.priceMinor,
  currency: p.currency,
  interval: p.interval ?? 'month',
  available: p.available ?? true,
  adsEnabled: Boolean(p.entitlements?.adsEnabled ?? true),
  entitlements: p.entitlements ?? {},
});

export const getSubscription = asyncHandler(async (req, res) => {
  const latest = await Subscription.findOne({ organization: req.org._id }).sort({ createdAt: -1 }).lean();
  // Every organisation has a plan: the Free default is created on demand for older records.
  const sub = latest ?? (await entitlements.ensureFreeSubscription(req.org._id));
  const [planDef, pendingDef, ent] = await Promise.all([
    PlanDefinition.findOne({ key: sub.planKey }).lean(),
    sub.pendingPlanKey ? PlanDefinition.findOne({ key: sub.pendingPlanKey }).lean() : null,
    entitlements.entitlementsFor(req.org._id),
  ]);
  res.json({ subscription: consoleSubscription(sub, planDef, pendingDef, ent) });
});

export const listPlans = asyncHandler(async (_req, res) => {
  const rows = await PlanDefinition.find({ available: true }).sort({ sortOrder: 1 }).lean();
  res.json({ plans: (rows.length ? rows : PLAN_SEED).map(planListItem) });
});

export const listSubscriptionPayments = asyncHandler(async (req, res) => {
  const [rows, planDefs] = await Promise.all([
    SubscriptionPayment.find({ organization: req.org._id }).sort({ createdAt: -1 }).limit(50).lean(),
    PlanDefinition.find().select('key name').lean(),
  ]);
  const names = new Map(planDefs.map((p) => [p.key, p.name]));
  res.json({
    items: rows.map((p) => ({
      id: String(p._id),
      reference: p.reference,
      planName: names.get(p.planKey) ?? p.planKey,
      kind: p.kind,
      amountKobo: p.amountKobo,
      currency: p.currency,
      status: p.status,
      paidAt: p.paidAt ?? p.createdAt ?? null,
      receiptUrl: null,
    })),
    total: rows.length,
  });
});

/* -------------------------------------------------------------- community */

export const listPosts = asyncHandler(async (req, res) => {
  res.json(await content.listPosts(req.org._id));
});

export const createPost = asyncHandler(async (req, res) => {
  res.status(201).json({ post: await content.createPost(req.org._id, req.body, req.user._id) });
});

export const updatePost = asyncHandler(async (req, res) => {
  res.json({ post: await content.updatePost(req.org._id, req.params.postId, req.body) });
});

export const deletePost = asyncHandler(async (req, res) => {
  res.json(await content.deletePost(req.org._id, req.params.postId));
});

/* -------------------------------------------------------- reported questions */

export const listFlags = asyncHandler(async (req, res) => {
  res.json(await content.listFlags(req.org._id));
});

export const updateFlag = asyncHandler(async (req, res) => {
  res.json({ flag: await content.updateFlag(req.org._id, req.params.flagId, req.body, req.user._id) });
});
