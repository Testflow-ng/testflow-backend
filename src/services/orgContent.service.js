import mongoose from 'mongoose';
import { OrgExam } from '../models/OrgExam.js';
import { OrgQuestion } from '../models/OrgQuestion.js';
import { OrgQuestionBank } from '../models/OrgQuestionBank.js';
import { OrgQuestionFlag } from '../models/OrgQuestionFlag.js';
import { OrgPost } from '../models/OrgPost.js';
import { OrgAttempt } from '../models/OrgAttempt.js';
import { OrgBook } from '../models/OrgBook.js';
import { OrgMembership } from '../models/OrgMembership.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { entitlementsFor } from './entitlements.js';

/**
 * The organisation console's content: exams, the question bank, the books on its shelf, and the
 * students it invites.
 *
 * Every read and write is scoped to one `organization` id, and the two paid surfaces (a priced
 * exam, a priced book) refuse to go live without an active payout account, which is the
 * `PAYOUT_REQUIRED` the console turns into "Add a payout account first".
 */

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const isPayoutActive = (org) => org?.payout?.status === 'active';

/** A priced item may not be published until money has somewhere to go. */
export const requirePayoutForPrice = (org, priceMinor) => {
  if (Number(priceMinor) > 0 && !isPayoutActive(org)) {
    throw new AppError(422, 'PAYOUT_REQUIRED', 'Add a payout account before selling anything.');
  }
};

/* ------------------------------------------------------------ plan features */

const FEATURE_FIELDS = Object.freeze({
  live_cbt: 'liveCbt',
  paid_exams: 'paidExams',
  question_banks: 'questionBanks',
  announcements: 'announcements',
  reports: 'reports',
});

const FEATURE_MESSAGES = Object.freeze({
  live_cbt: 'Live CBT is part of the Studio plan.',
  paid_exams: 'Charging students for an exam is part of the Studio plan.',
  question_banks: 'Question banks are part of the Pro plan.',
  announcements: 'Announcements are part of the Pro plan.',
  reports: 'Reported questions are part of the Pro plan.',
  exam_limit: 'The Free plan allows three exams. Upgrade to Pro to make as many as you like.',
});

const planError = (feature) => {
  const requiredPlan = feature === 'paid_exams' || feature === 'live_cbt' ? 'studio' : 'pro';
  const error = new AppError(402, 'PLAN_REQUIRED', FEATURE_MESSAGES[feature]);
  error.details = { feature, requiredPlan };
  return error;
};

/** Refuse a write the plan does not include. Reads stay open, so a downgrade is never a data loss. */
export const assertFeature = (entitlements, feature) => {
  if (!entitlements?.[FEATURE_FIELDS[feature]]) throw planError(feature);
};

export const assertExamLimit = async (orgId, entitlements) => {
  if (entitlements?.maxExams == null) return;
  const count = await OrgExam.countDocuments({ organization: orgId, status: { $ne: 'archived' } });
  if (count >= entitlements.maxExams) throw planError('exam_limit');
};

const assertPublishLimit = async (orgId, entitlements, exam) => {
  if (entitlements?.maxExams == null || exam.status === 'published') return;
  const count = await OrgExam.countDocuments({ organization: orgId, status: 'published' });
  if (count >= entitlements.maxExams) throw planError('exam_limit');
};

const LOCKED_EXAM_FIELDS = Object.freeze(['questionIds', 'durationMinutes', 'negativeMarking']);
const RESULT_STATUSES = Object.freeze(['submitted', 'timed_out']);

const hasAttempts = async (orgId, examId) =>
  Boolean(await OrgAttempt.exists({ organization: orgId, exam: examId }));

/**
 * A published exam that has been sat may not have its paper, length or marking changed. Scores
 * already recorded were computed against those values, so changing them now would silently move
 * the goalposts. Title, instructions, access and corrections settings stay editable.
 */
const assertExamUnlocked = async (orgId, exam, patch = {}) => {
  if (exam.status !== 'published') return;
  const touchesLocked = LOCKED_EXAM_FIELDS.some((key) => patch[key] !== undefined);
  if (!touchesLocked) return;
  if (await hasAttempts(orgId, exam._id)) {
    throw new AppError(409, 'EXAM_LOCKED', 'This exam has already been sat. Its questions, duration and negative marking are locked.');
  }
};

/* ------------------------------------------------------------------ exams */

const toDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const toExamView = (exam) => ({
  id: String(exam._id),
  title: exam.title,
  instructions: exam.instructions ?? '',
  mode: exam.mode ?? 'anytime',
  startsAt: exam.startsAt ?? null,
  durationMinutes: exam.durationMinutes,
  questionCount: (exam.questionIds ?? []).length,
  questionIds: (exam.questionIds ?? []).map(String),
  access: exam.access ?? 'link',
  accessCode: exam.accessCode ?? '',
  showCorrections: exam.showCorrections ?? 'now',
  attemptsAllowed: exam.attemptsAllowed ?? 1,
  shuffleQuestions: Boolean(exam.shuffleQuestions),
  shuffleOptions: Boolean(exam.shuffleOptions),
  marksPerQuestion: exam.marksPerQuestion ?? 1,
  negativeMarking: exam.negativeMarking ?? 0,
  priceMinor: exam.priceMinor ?? 0,
  currency: exam.currency ?? 'NGN',
  status: exam.status ?? 'draft',
  createdAt: exam.createdAt ?? null,
  updatedAt: exam.updatedAt ?? null,
});

const examPatchFrom = (body) => {
  const patch = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.instructions !== undefined) patch.instructions = body.instructions;
  if (body.mode !== undefined) patch.mode = body.mode;
  if (body.startsAt !== undefined) patch.startsAt = toDate(body.startsAt);
  if (body.durationMinutes !== undefined) patch.durationMinutes = body.durationMinutes;
  if (body.questionIds !== undefined) patch.questionIds = body.questionIds;
  if (body.access !== undefined) patch.access = body.access;
  if (body.accessCode !== undefined) patch.accessCode = body.accessCode;
  if (body.showCorrections !== undefined) patch.showCorrections = body.showCorrections;
  if (body.attemptsAllowed !== undefined) patch.attemptsAllowed = body.attemptsAllowed;
  if (body.shuffleQuestions !== undefined) patch.shuffleQuestions = body.shuffleQuestions;
  if (body.shuffleOptions !== undefined) patch.shuffleOptions = body.shuffleOptions;
  if (body.marksPerQuestion !== undefined) patch.marksPerQuestion = body.marksPerQuestion;
  if (body.negativeMarking !== undefined) patch.negativeMarking = body.negativeMarking;
  if (body.priceMinor !== undefined) patch.priceMinor = body.priceMinor;
  if (body.currency !== undefined) patch.currency = body.currency;
  return patch;
};

export const listExams = async (orgId, { page = 1, limit = 20, status, q } = {}) => {
  const where = { organization: orgId };
  if (status) where.status = status;
  if (q) where.title = new RegExp(escapeRegExp(q), 'i');
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    OrgExam.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    OrgExam.countDocuments(where),
  ]);
  return { items: rows.map(toExamView), page, limit, pageCount: Math.max(1, Math.ceil(total / limit)), total };
};

export const createExam = async (org, body, actorId) => {
  const patch = examPatchFrom(body);
  const entitlements = await entitlementsFor(org._id);
  if (patch.mode === 'live') assertFeature(entitlements, 'live_cbt');
  if ((patch.priceMinor ?? 0) > 0) assertFeature(entitlements, 'paid_exams');
  await assertExamLimit(org._id, entitlements);
  requirePayoutForPrice(org, patch.priceMinor ?? 0);
  const exam = await OrgExam.create({
    organization: org._id,
    title: patch.title,
    instructions: patch.instructions ?? '',
    mode: patch.mode ?? 'anytime',
    startsAt: patch.startsAt ?? null,
    questionIds: patch.questionIds ?? [],
    durationMinutes: patch.durationMinutes,
    access: patch.access ?? 'link',
    accessCode: patch.accessCode ?? '',
    showCorrections: patch.showCorrections ?? 'now',
    attemptsAllowed: patch.attemptsAllowed ?? 1,
    shuffleQuestions: patch.shuffleQuestions ?? true,
    shuffleOptions: patch.shuffleOptions ?? false,
    marksPerQuestion: patch.marksPerQuestion ?? 1,
    negativeMarking: patch.negativeMarking ?? 0,
    priceMinor: patch.priceMinor ?? 0,
    currency: patch.currency ?? 'NGN',
    createdBy: actorId,
  });
  return toExamView(exam.toObject());
};

export const getExam = async (orgId, examId) => {
  const exam = await OrgExam.findOne({ _id: examId, organization: orgId }).lean();
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');
  return toExamView(exam);
};

/** The questions in this exam, in the order the owner arranged them. */
export const getExamQuestions = async (orgId, examId) => {
  const exam = await OrgExam.findOne({ _id: examId, organization: orgId }).select('questionIds').lean();
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');
  const ids = (exam.questionIds ?? []).map(String);
  if (!ids.length) return { items: [] };
  const rows = await OrgQuestion.find({ _id: { $in: ids }, organization: orgId, softDeleted: { $ne: true } }).lean();
  const byId = new Map(rows.map((q) => [String(q._id), q]));
  return { items: ids.map((id) => byId.get(id)).filter(Boolean).map(toQuestionView) };
};

/** Replace the exam's question list. Every id must be a question this organisation owns. */
export const setExamQuestions = async (orgId, examId, questionIds) => {
  const exam = await OrgExam.findOne({ _id: examId, organization: orgId }).lean();
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');
  await assertExamUnlocked(orgId, exam, { questionIds: questionIds ?? [] });
  const ids = [...new Set((questionIds ?? []).map(String))];
  if (ids.length) {
    const owned = await OrgQuestion.countDocuments({ _id: { $in: ids }, organization: orgId, softDeleted: { $ne: true } });
    if (owned !== ids.length) {
      throw new AppError(422, 'VALIDATION_ERROR', 'One of those questions does not exist.');
    }
  }
  const updated = await OrgExam.findOneAndUpdate(
    { _id: examId, organization: orgId },
    { $set: { questionIds: ids } },
    { new: true },
  ).lean();
  return toExamView(updated);
};

const studentNameOf = (student) => student?.fullName ?? student?.email ?? 'Student';

const resultRow = (attempt) => ({
  id: String(attempt._id),
  studentId: attempt.student?._id ? String(attempt.student._id) : String(attempt.student ?? ''),
  userId: attempt.student?._id ? String(attempt.student._id) : String(attempt.student ?? ''),
  studentName: studentNameOf(attempt.student),
  email: attempt.student?.email ?? '',
  examTitle: attempt.examTitle ?? '',
  scorePercent: attempt.scorePercent,
  correct: attempt.correctCount,
  total: attempt.total,
  timeMinutes: attempt.timeMinutes,
  submittedAt: attempt.submittedAt,
  status: attempt.status,
});

/** One paper with the snapshot it was marked against, for the organiser. */
export const toAttemptAdminView = (attempt) => {
  const answers = new Map((attempt.answers ?? []).map((answer) => [String(answer.question), answer]));
  return {
    ...resultRow(attempt),
    startedAt: attempt.startedAt,
    questions: (attempt.questions ?? []).map((question) => {
      const answer = answers.get(String(question.question));
      return {
        questionId: String(question.question),
        stem: question.stem,
        stemImageUrl: question.stemImageUrl ?? null,
        options: (question.options ?? []).map((option) => option.text ?? ''),
        optionImages: (question.options ?? []).map((option) => option.imageUrl ?? null),
        correctIndex: question.correctIndex,
        explanation: question.explanation ?? '',
        explanationImageUrl: question.explanationImageUrl ?? null,
        topic: question.topic ?? '',
        selectedIndex: answer?.selectedIndex ?? null,
        correct: Boolean(answer?.correct),
      };
    }),
  };
};

const membershipIdsForUsers = async (orgId, userIds) => {
  if (!userIds.length) return new Map();
  const rows = await OrgMembership.find({ organization: orgId, user: { $in: userIds } })
    .select('_id user')
    .lean();
  return new Map(rows.map((row) => [String(row.user), String(row._id)]));
};

/** How students did. Always the real score, whatever `showCorrections` says to students. */
export const getExamResults = async (orgId, examId, { page = 1, limit = 50 } = {}) => {
  const exam = await OrgExam.findOne({ _id: examId, organization: orgId }).select('_id').lean();
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');

  const where = { organization: orgId, exam: examId, status: { $in: RESULT_STATUSES } };
  const skip = (page - 1) * limit;
  const [rows, total, summaryRows] = await Promise.all([
    OrgAttempt.find(where)
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('student', 'fullName email')
      .lean(),
    OrgAttempt.countDocuments(where),
    OrgAttempt.aggregate([
      { $match: { organization: new mongoose.Types.ObjectId(String(orgId)), exam: new mongoose.Types.ObjectId(String(examId)), status: { $in: RESULT_STATUSES } } },
      {
        $group: {
          _id: null,
          attempts: { $sum: 1 },
          average: { $avg: '$scorePercent' },
          highest: { $max: '$scorePercent' },
          lowest: { $min: '$scorePercent' },
        },
      },
    ]),
  ]);

  const membershipIds = await membershipIdsForUsers(
    orgId,
    rows.map((row) => row.student?._id).filter(Boolean),
  );
  const summary = summaryRows[0] ?? {};
  return {
    items: rows.map((row) => ({
      ...resultRow(row),
      // The student page is keyed by the membership row, so link there when there is one.
      studentId: membershipIds.get(String(row.student?._id)) ?? resultRow(row).studentId,
    })),
    page,
    limit,
    total,
    summary: {
      attempts: summary.attempts ?? 0,
      average: summary.average == null ? 0 : Math.round(summary.average * 10) / 10,
      highest: summary.highest ?? 0,
      lowest: summary.lowest ?? 0,
    },
  };
};

/** The CSV body is streamed row by row; no whole history is held in memory. */
export const forEachExamResultRow = async (orgId, examId, visit) => {
  const exam = await OrgExam.findOne({ _id: examId, organization: orgId }).select('_id').lean();
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');
  const cursor = OrgAttempt.find({ organization: orgId, exam: examId, status: { $in: RESULT_STATUSES } })
    .sort({ submittedAt: 1 })
    .populate('student', 'fullName email')
    .lean()
    .cursor();
  for await (const attempt of cursor) await visit(resultRow(attempt));
};

/** One paper, for the organiser. Scoped to the organisation; another tenant gets a 404. */
export const getAttempt = async (orgId, attemptId) => {
  const attempt = await OrgAttempt.findOne({ _id: attemptId, organization: orgId })
    .populate('student', 'fullName email')
    .lean();
  if (!attempt) throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'That attempt does not exist.');
  return toAttemptAdminView(attempt);
};

export const updateExam = async (org, examId, body) => {
  const patch = examPatchFrom(body);
  const existing = await OrgExam.findOne({ _id: examId, organization: org._id }).lean();
  if (!existing) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');
  await assertExamUnlocked(org._id, existing, patch);

  // Only *switching to* a paid feature is blocked. A downgraded organisation can still edit the
  // live or paid exams it already has, as long as it does not republish them.
  const entitlements = await entitlementsFor(org._id);
  if (body.mode === 'live') assertFeature(entitlements, 'live_cbt');
  if (patch.priceMinor !== undefined && patch.priceMinor > 0) assertFeature(entitlements, 'paid_exams');

  const price = patch.priceMinor !== undefined ? patch.priceMinor : existing.priceMinor ?? 0;
  // A paid exam that is already live must keep a live payout; a still-draft one only needs it to publish.
  if (price > 0 && existing.status === 'published') requirePayoutForPrice(org, price);

  const updated = await OrgExam.findOneAndUpdate(
    { _id: examId, organization: org._id },
    { $set: patch },
    { new: true, runValidators: true },
  ).lean();
  return toExamView(updated);
};

export const setExamPublished = async (org, examId, publish) => {
  const exam = await OrgExam.findOne({ _id: examId, organization: org._id }).lean();
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');
  if (publish) {
    const questionCount = await OrgQuestion.countDocuments({
      _id: { $in: exam.questionIds ?? [] },
      organization: org._id,
      softDeleted: { $ne: true },
    });
    if (!questionCount) {
      throw new AppError(422, 'NO_QUESTIONS', 'Add at least one question before publishing.');
    }
    if (exam.mode === 'live') {
      if (!exam.startsAt || new Date(exam.startsAt).getTime() <= Date.now()) {
        throw new AppError(422, 'START_IN_PAST', 'A live exam needs a start time in the future.');
      }
    }
    const entitlements = await entitlementsFor(org._id);
    if (exam.mode === 'live') assertFeature(entitlements, 'live_cbt');
    if ((exam.priceMinor ?? 0) > 0) assertFeature(entitlements, 'paid_exams');
    await assertPublishLimit(org._id, entitlements, exam);
    requirePayoutForPrice(org, exam.priceMinor ?? 0);
  }
  const updated = await OrgExam.findOneAndUpdate(
    { _id: examId, organization: org._id },
    { $set: { status: publish ? 'published' : 'draft' } },
    { new: true },
  ).lean();
  return toExamView(updated);
};

/**
 * A draft that was never sat is deleted outright. Anything else is archived: results and attempts
 * stay, and the owner can still find the paper, but it leaves the active list.
 */
export const deleteExam = async (orgId, examId) => {
  const exam = await OrgExam.findOne({ _id: examId, organization: orgId }).lean();
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');
  if (exam.status === 'draft' && !(await hasAttempts(orgId, examId))) {
    await OrgExam.deleteOne({ _id: examId, organization: orgId });
    return { id: String(examId), deleted: true, archived: false };
  }
  await OrgExam.updateOne({ _id: examId, organization: orgId }, { $set: { status: 'archived' } });
  return { id: String(examId), deleted: false, archived: true };
};

/* -------------------------------------------------------------- questions */

export const toQuestionView = (q) => ({
  id: String(q._id),
  bankId: q.bank ? String(q.bank) : null,
  stem: q.stem,
  stemImageUrl: q.stemImageUrl ?? null,
  options: (q.options ?? []).map((o) => o.text ?? ''),
  optionImages: (q.options ?? []).map((o) => o.imageUrl ?? null),
  correctIndex: q.correctIndex,
  topic: q.topic ?? '',
  difficulty: q.difficulty ?? 'medium',
  explanation: q.explanation ?? '',
  explanationImageUrl: q.explanationImageUrl ?? null,
  createdAt: q.createdAt ?? null,
});

/**
 * The console sends options as strings with a parallel `optionImages` array, while the API's own
 * shape names each option's text and image together. Accept both, so neither client is wrong.
 */
const optionsFromBody = (body) => {
  const raw = body.options ?? [];
  return raw.map((option, index) =>
    typeof option === 'string'
      ? { text: option.trim(), imageUrl: body.optionImages?.[index] ?? null }
      : { text: (option?.text ?? '').trim(), imageUrl: option?.imageUrl ?? null },
  );
};

/** Throws a `VALIDATION_ERROR` with the same rules the console checks client-side. */
const assertQuestion = (body, { partial = false } = {}) => {
  if (body.stem !== undefined && !body.stem.trim()) throw new AppError(422, 'VALIDATION_ERROR', 'Write the question.');
  if (body.options === undefined) {
    if (partial) return;
    throw new AppError(422, 'VALIDATION_ERROR', 'Add at least two options.');
  }
  const options = optionsFromBody(body);
  if (options.length < 2 || options.length > 6) {
    throw new AppError(422, 'VALIDATION_ERROR', 'A question has between 2 and 6 options.');
  }
  const filled = options.filter((o) => o.text || o.imageUrl);
  if (filled.length < 2) throw new AppError(422, 'VALIDATION_ERROR', 'Add at least two options.');
  if (body.correctIndex === undefined || body.correctIndex < 0 || body.correctIndex >= options.length) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Mark the correct option.');
  }
  const texts = options.map((o) => o.text.toLowerCase()).filter(Boolean);
  if (new Set(texts).size !== texts.length) throw new AppError(422, 'VALIDATION_ERROR', 'Options must be different from each other.');
};

/** The document fields a validated body maps onto. */
const questionDoc = (body) => {
  const doc = {};
  if (body.stem !== undefined) doc.stem = body.stem;
  if (body.options !== undefined) doc.options = optionsFromBody(body);
  if (body.correctIndex !== undefined) doc.correctIndex = body.correctIndex;
  if (body.stemImageUrl !== undefined) doc.stemImageUrl = body.stemImageUrl;
  if (body.topic !== undefined) doc.topic = body.topic;
  if (body.difficulty !== undefined) doc.difficulty = body.difficulty;
  if (body.explanation !== undefined) doc.explanation = body.explanation;
  if (body.explanationImageUrl !== undefined) doc.explanationImageUrl = body.explanationImageUrl;
  return doc;
};

export const listQuestions = async (orgId, { page = 1, limit = 20, search, topic, difficulty, bankId } = {}) => {
  const where = { organization: orgId, softDeleted: { $ne: true } };
  if (bankId) where.bank = bankId;
  if (topic) where.topic = topic;
  if (difficulty) where.difficulty = difficulty;
  const needle = String(search ?? '').trim();
  if (needle) {
    const rx = new RegExp(escapeRegExp(needle), 'i');
    where.$or = [{ stem: rx }, { topic: rx }];
  }
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    OrgQuestion.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    OrgQuestion.countDocuments(where),
  ]);
  return { items: rows.map(toQuestionView), page, limit, pages: Math.max(1, Math.ceil(total / limit)), total };
};

export const createQuestion = async (orgId, body, actorId) => {
  assertQuestion(body);
  const { examId, bankId } = body;
  if (bankId) {
    assertFeature(await entitlementsFor(orgId), 'question_banks');
    const bank = await OrgQuestionBank.findOne({ _id: bankId, organization: orgId }).lean();
    if (!bank) throw new AppError(404, 'BANK_NOT_FOUND', 'That question bank does not exist.');
  }
  if (examId) {
    const exam = await OrgExam.findOne({ _id: examId, organization: orgId }).lean();
    if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');
  }
  const question = await OrgQuestion.create({
    organization: orgId,
    ...questionDoc(body),
    bank: bankId ?? null,
    createdBy: actorId,
  });
  if (examId) {
    await OrgExam.updateOne({ _id: examId, organization: orgId }, { $addToSet: { questionIds: question._id } });
  }
  return toQuestionView(question.toObject());
};

export const updateQuestion = async (orgId, questionId, body) => {
  assertQuestion(body, { partial: true });
  const updated = await OrgQuestion.findOneAndUpdate(
    { _id: questionId, organization: orgId, softDeleted: { $ne: true } },
    { $set: questionDoc(body) },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw new AppError(404, 'QUESTION_NOT_FOUND', 'That question does not exist.');
  return toQuestionView(updated);
};

/** Question ids that a published, already-sat exam relies on. Those may only be soft-deleted. */
const lockedQuestionIds = async (orgId, questionIds) => {
  if (!questionIds.length) return new Set();
  const published = await OrgExam.find({
    organization: orgId,
    status: 'published',
    questionIds: { $in: questionIds },
  })
    .select('_id questionIds')
    .lean();
  if (!published.length) return new Set();
  const satExamIds = await OrgAttempt.distinct('exam', {
    organization: orgId,
    exam: { $in: published.map((exam) => exam._id) },
  });
  const sat = new Set(satExamIds.map(String));
  const locked = new Set();
  for (const exam of published) {
    if (!sat.has(String(exam._id))) continue;
    for (const id of exam.questionIds) if (questionIds.some((q) => String(q) === String(id))) locked.add(String(id));
  }
  return locked;
};

export const deleteQuestion = async (orgId, questionId) => {
  const existing = await OrgQuestion.findOne({ _id: questionId, organization: orgId, softDeleted: { $ne: true } })
    .select('_id')
    .lean();
  if (!existing) throw new AppError(404, 'QUESTION_NOT_FOUND', 'That question does not exist.');

  const locked = await lockedQuestionIds(orgId, [questionId]);
  if (locked.has(String(questionId))) {
    // The paper is kept for past attempts; it simply disappears from the bank and new sittings.
    await OrgQuestion.updateOne({ _id: questionId, organization: orgId }, { $set: { softDeleted: true } });
    return { id: String(questionId), deleted: false, softDeleted: true };
  }

  await OrgQuestion.deleteOne({ _id: questionId, organization: orgId });
  // An exam keeps only ids it can resolve, and a report dies with the question it is about.
  await Promise.all([
    OrgExam.updateMany({ organization: orgId, questionIds: questionId }, { $pull: { questionIds: questionId } }),
    OrgQuestionFlag.deleteMany({ organization: orgId, question: questionId }),
  ]);
  return { id: String(questionId), deleted: true, softDeleted: false };
};

/**
 * Import up to 500 rows at once. A bad row never sinks the batch: it comes back in `failed` with
 * the messages the console would have shown, and everything valid is written.
 */
export const bulkQuestions = async (orgId, rows, actorId, { examId, bankId } = {}) => {
  if (bankId) {
    assertFeature(await entitlementsFor(orgId), 'question_banks');
    const bank = await OrgQuestionBank.findOne({ _id: bankId, organization: orgId }).lean();
    if (!bank) throw new AppError(404, 'BANK_NOT_FOUND', 'That question bank does not exist.');
  }
  if (examId) {
    const exam = await OrgExam.findOne({ _id: examId, organization: orgId }).lean();
    if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');
  }

  const failed = [];
  const docs = [];
  rows.forEach((row, index) => {
    try {
      assertQuestion(row);
      docs.push({ organization: orgId, ...questionDoc(row), bank: bankId ?? null, createdBy: actorId });
    } catch (error) {
      failed.push({ row: index + 1, problems: [error.message] });
    }
  });
  const inserted = docs.length ? await OrgQuestion.insertMany(docs) : [];
  if (examId && inserted.length) {
    await OrgExam.updateOne(
      { _id: examId, organization: orgId },
      { $addToSet: { questionIds: { $each: inserted.map((q) => q._id) } } },
    );
  }
  return { imported: inserted.length, failed };
};

const MAX_IMPORT_ROWS = 500;

/**
 * Write already-parsed rows (from CSV or a ZIP) as questions. Each row carries its original
 * spreadsheet line (`row`) so a failure points at the file the organiser uploaded, not at the
 * filtered subset that reached validation. `dryRun` validates without writing anything.
 */
export const importQuestionRows = async (orgId, entries, actorId, { examId, bankId, dryRun = false } = {}) => {
  if (!Array.isArray(entries) || !entries.length) {
    throw new AppError(422, 'VALIDATION_ERROR', 'The file has no question rows.');
  }
  if (entries.length > MAX_IMPORT_ROWS) {
    throw new AppError(422, 'TOO_MANY_ROWS', `Import at most ${MAX_IMPORT_ROWS} questions at a time.`);
  }
  if (bankId) {
    assertFeature(await entitlementsFor(orgId), 'question_banks');
    const bank = await OrgQuestionBank.findOne({ _id: bankId, organization: orgId }).lean();
    if (!bank) throw new AppError(404, 'BANK_NOT_FOUND', 'That question bank does not exist.');
  }
  if (examId) {
    const exam = await OrgExam.findOne({ _id: examId, organization: orgId }).lean();
    if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');
  }

  const failed = [];
  const docs = [];
  for (const entry of entries) {
    try {
      assertQuestion(entry.data);
      docs.push({ organization: orgId, ...questionDoc(entry.data), bank: bankId ?? null, createdBy: actorId });
    } catch (error) {
      failed.push({ row: entry.row, problems: [error.message] });
    }
  }

  if (dryRun) return { imported: 0, valid: docs.length, failed, dryRun: true };

  const inserted = docs.length ? await OrgQuestion.insertMany(docs) : [];
  if (examId && inserted.length) {
    await OrgExam.updateOne(
      { _id: examId, organization: orgId },
      { $addToSet: { questionIds: { $each: inserted.map((q) => q._id) } } },
    );
  }
  return { imported: inserted.length, valid: docs.length, failed, dryRun: false };
};

/* --------------------------------------------------------- question banks */

export const toBankView = (bank, questionCount = 0) => ({
  id: String(bank._id),
  name: bank.name,
  description: bank.description ?? '',
  questionCount,
  createdAt: bank.createdAt ?? null,
});

export const listBanks = async (orgId) => {
  const [rows, counts] = await Promise.all([
    OrgQuestionBank.find({ organization: orgId }).sort({ createdAt: -1 }).lean(),
    OrgQuestion.aggregate([
      { $match: { organization: orgId, bank: { $ne: null } } },
      { $group: { _id: '$bank', count: { $sum: 1 } } },
    ]),
  ]);
  const byBank = new Map(counts.map((c) => [String(c._id), c.count]));
  return { items: rows.map((b) => toBankView(b, byBank.get(String(b._id)) ?? 0)) };
};

export const createBank = async (orgId, body, actorId) => {
  assertFeature(await entitlementsFor(orgId), 'question_banks');
  const bank = await OrgQuestionBank.create({
    organization: orgId,
    name: body.name,
    description: body.description ?? '',
    createdBy: actorId,
  });
  return toBankView(bank.toObject(), 0);
};

export const updateBank = async (orgId, bankId, body) => {
  assertFeature(await entitlementsFor(orgId), 'question_banks');
  const doc = {};
  if (body.name !== undefined) doc.name = body.name;
  if (body.description !== undefined) doc.description = body.description;
  const updated = await OrgQuestionBank.findOneAndUpdate(
    { _id: bankId, organization: orgId },
    { $set: doc },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw new AppError(404, 'BANK_NOT_FOUND', 'That question bank does not exist.');
  const questionCount = await OrgQuestion.countDocuments({ organization: orgId, bank: bankId });
  return toBankView(updated, questionCount);
};

/** Deleting a bank deletes the questions filed in it, which is what the confirm dialog says. */
export const deleteBank = async (orgId, bankId) => {
  assertFeature(await entitlementsFor(orgId), 'question_banks');
  const removed = await OrgQuestionBank.findOneAndDelete({ _id: bankId, organization: orgId }).lean();
  if (!removed) throw new AppError(404, 'BANK_NOT_FOUND', 'That question bank does not exist.');
  const questions = await OrgQuestion.find({ organization: orgId, bank: bankId }).select('_id').lean();
  const ids = questions.map((q) => q._id);
  if (!ids.length) return { id: String(bankId), deleted: 0, softDeleted: 0 };

  const locked = await lockedQuestionIds(orgId, ids);
  const softIds = ids.filter((id) => locked.has(String(id)));
  const hardIds = ids.filter((id) => !locked.has(String(id)));

  if (softIds.length) {
    await OrgQuestion.updateMany(
      { organization: orgId, _id: { $in: softIds } },
      { $set: { softDeleted: true } },
    );
    // Remove the paper from exams that have not been sat; a sat published exam keeps its history.
    const satExams = await OrgExam.find({ organization: orgId, status: 'published', questionIds: { $in: softIds } })
      .select('_id')
      .lean();
    const attempts = await OrgAttempt.distinct('exam', {
      organization: orgId,
      exam: { $in: satExams.map((exam) => exam._id) },
    });
    const keep = new Set(attempts.map(String));
    const removable = satExams.filter((exam) => !keep.has(String(exam._id))).map((exam) => exam._id);
    if (removable.length) {
      await OrgExam.updateMany(
        { _id: { $in: removable }, organization: orgId },
        { $pull: { questionIds: { $in: softIds } } },
      );
    }
  }

  if (hardIds.length) {
    await Promise.all([
      OrgQuestion.deleteMany({ organization: orgId, _id: { $in: hardIds } }),
      OrgExam.updateMany(
        { organization: orgId, questionIds: { $in: hardIds } },
        { $pull: { questionIds: { $in: hardIds } } },
      ),
      OrgQuestionFlag.deleteMany({ organization: orgId, question: { $in: hardIds } }),
    ]);
  }

  return { id: String(bankId), deleted: hardIds.length, softDeleted: softIds.length };
};

export const listBankQuestions = async (orgId, bankId, query = {}) => {
  const bank = await OrgQuestionBank.findOne({ _id: bankId, organization: orgId }).select('_id').lean();
  if (!bank) throw new AppError(404, 'BANK_NOT_FOUND', 'That question bank does not exist.');
  return listQuestions(orgId, { ...query, bankId });
};

/* ----------------------------------------------------------------- books */

export const toBookView = (book) => ({
  id: String(book._id),
  title: book.title,
  code: book.code ?? '',
  description: book.description ?? '',
  color: book.color ?? 'ink',
  priceMinor: book.priceMinor ?? 0,
  currency: book.currency ?? 'NGN',
  visibility: book.visibility ?? 'all_students',
  previewPages: book.previewPages ?? 0,
  pages: book.pages ?? 0,
  fileName: book.fileName ?? '',
  published: Boolean(book.published),
  createdAt: book.createdAt ?? null,
});

export const listBooks = async (orgId) => {
  const rows = await OrgBook.find({ organization: orgId }).sort({ createdAt: -1 }).lean();
  return { items: rows.map(toBookView), total: rows.length };
};

const bookDoc = (body) => {
  const doc = {};
  for (const key of ['title', 'code', 'description', 'color', 'priceMinor', 'currency', 'visibility', 'previewPages', 'pages', 'fileName', 'published']) {
    if (body[key] !== undefined) doc[key] = body[key];
  }
  return doc;
};

export const createBook = async (org, body, actorId) => {
  const doc = bookDoc(body);
  if ((doc.priceMinor ?? 0) > 0) requirePayoutForPrice(org, doc.priceMinor);
  const book = await OrgBook.create({ organization: org._id, ...doc, createdBy: actorId });
  return toBookView(book.toObject());
};

export const updateBook = async (org, bookId, body) => {
  const existing = await OrgBook.findOne({ _id: bookId, organization: org._id }).lean();
  if (!existing) throw new AppError(404, 'BOOK_NOT_FOUND', 'That book does not exist.');
  const doc = bookDoc(body);
  const price = doc.priceMinor !== undefined ? doc.priceMinor : existing.priceMinor ?? 0;
  if (price > 0) requirePayoutForPrice(org, price);
  const updated = await OrgBook.findOneAndUpdate(
    { _id: bookId, organization: org._id },
    { $set: doc },
    { new: true, runValidators: true },
  ).lean();
  return toBookView(updated);
};

export const deleteBook = async (orgId, bookId) => {
  const removed = await OrgBook.findOneAndDelete({ _id: bookId, organization: orgId }).lean();
  if (!removed) throw new AppError(404, 'BOOK_NOT_FOUND', 'That book does not exist.');
  return { id: String(bookId), deleted: true };
};

/* -------------------------------------------------------------- students */

/**
 * The organisation's students, with the account fields the console shows. A search matches the
 * account first (so it works across the whole membership list), then the memberships are paged.
 */
export const listStudents = async (orgId, { page = 1, limit = 20, search, role = 'student' } = {}) => {
  const memberWhere = { organization: orgId, role };

  const needle = String(search ?? '').trim();
  if (needle) {
    const rx = new RegExp(escapeRegExp(needle), 'i');
    const users = await User.find({ $or: [{ fullName: rx }, { email: rx }] }).select('_id').lean();
    memberWhere.user = { $in: users.map((u) => u._id) };
  }

  const skip = (page - 1) * limit;
  const [rows, total, stats] = await Promise.all([
    OrgMembership.find(memberWhere).sort({ createdAt: 1 }).skip(skip).limit(limit).populate('user', 'fullName email username').lean(),
    OrgMembership.countDocuments(memberWhere),
    OrgAttempt.aggregate([
      { $match: { organization: new mongoose.Types.ObjectId(String(orgId)), status: { $in: RESULT_STATUSES } } },
      { $group: { _id: '$student', attempts: { $sum: 1 }, average: { $avg: '$scorePercent' } } },
    ]),
  ]);
  const byUser = new Map(stats.map((row) => [String(row._id), row]));

  return {
    items: rows.map((m) => {
      const stat = byUser.get(String(m.user?._id));
      return {
        id: String(m._id),
        userId: m.user?._id ? String(m.user._id) : null,
        fullName: m.user?.fullName ?? 'Student',
        email: m.user?.email ?? '',
        status: m.status === 'active' ? 'active' : 'invited',
        role: m.role,
        attempts: stat?.attempts ?? 0,
        average: stat?.average == null ? null : Math.round(stat.average * 10) / 10,
        joinedAt: m.joinedAt ?? m.createdAt ?? null,
      };
    }),
    page,
    limit,
    total,
  };
};

/** One student, and the papers they have taken. */
export const getStudent = async (orgId, studentId) => {
  const m = await OrgMembership.findOne({ _id: studentId, organization: orgId })
    .populate('user', 'fullName email username')
    .lean();
  if (!m) throw new AppError(404, 'STUDENT_NOT_FOUND', 'That student does not exist.');

  const attempts = m.user?._id
    ? await OrgAttempt.find({
        organization: orgId,
        student: m.user._id,
        status: { $in: RESULT_STATUSES },
      })
        .sort({ submittedAt: -1 })
        .populate('exam', 'title')
        .lean()
    : [];
  const stat = attempts.length
    ? attempts.reduce((sum, row) => sum + (row.scorePercent ?? 0), 0) / attempts.length
    : null;

  return {
    student: {
      id: String(m._id),
      userId: m.user?._id ? String(m.user._id) : null,
      fullName: m.user?.fullName ?? 'Student',
      email: m.user?.email ?? '',
      status: m.status === 'active' ? 'active' : 'invited',
      role: m.role,
      attempts: attempts.length,
      average: stat == null ? null : Math.round(stat * 10) / 10,
      joinedAt: m.joinedAt ?? m.createdAt ?? null,
    },
    attempts: attempts.map((row) => ({
      id: String(row._id),
      examId: String(row.exam?._id ?? row.exam),
      examTitle: row.examTitle || row.exam?.title || '',
      scorePercent: row.scorePercent,
      correct: row.correctCount,
      total: row.total,
      timeMinutes: row.timeMinutes,
      submittedAt: row.submittedAt,
      status: row.status,
    })),
  };
};

/* -------------------------------------------------------------- community */

/** The card reads `post.time`, so the view carries a short human date alongside the ISO timestamp. */
const shortDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

export const toPostView = (post) => ({
  id: String(post._id),
  type: post.type ?? 'announcement',
  text: post.text,
  pinned: Boolean(post.pinned),
  hidden: Boolean(post.hidden),
  time: shortDate(post.createdAt),
  createdAt: post.createdAt ?? null,
  updatedAt: post.updatedAt ?? null,
});

export const listPosts = async (orgId) => {
  const rows = await OrgPost.find({ organization: orgId }).sort({ pinned: -1, createdAt: -1 }).lean();
  return { items: rows.map(toPostView), total: rows.length };
};

export const createPost = async (orgId, body, actorId) => {
  assertFeature(await entitlementsFor(orgId), 'announcements');
  const post = await OrgPost.create({
    organization: orgId,
    type: body.type ?? 'announcement',
    text: body.text,
    pinned: Boolean(body.pinned),
    hidden: Boolean(body.hidden),
    createdBy: actorId,
  });
  return toPostView(post.toObject());
};

export const updatePost = async (orgId, postId, body) => {
  assertFeature(await entitlementsFor(orgId), 'announcements');
  const doc = {};
  for (const key of ['type', 'text', 'pinned', 'hidden']) {
    if (body[key] !== undefined) doc[key] = body[key];
  }
  const updated = await OrgPost.findOneAndUpdate(
    { _id: postId, organization: orgId },
    { $set: doc },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw new AppError(404, 'POST_NOT_FOUND', 'That post does not exist.');
  return toPostView(updated);
};

export const deletePost = async (orgId, postId) => {
  assertFeature(await entitlementsFor(orgId), 'announcements');
  const removed = await OrgPost.findOneAndDelete({ _id: postId, organization: orgId }).lean();
  if (!removed) throw new AppError(404, 'POST_NOT_FOUND', 'That post does not exist.');
  return { id: String(postId), deleted: true };
};

/** What a student sees on the tenant home page: visible posts, pinned first. */
export const listAnnouncements = async (orgId) => {
  const rows = await OrgPost.find({ organization: orgId, hidden: { $ne: true } })
    .sort({ pinned: -1, createdAt: -1 })
    .lean();
  return { items: rows.map(toPostView) };
};

/* -------------------------------------------------------- reported questions */

const flagQuestionKey = (flag) => (flag.question?._id ? String(flag.question._id) : String(flag.question ?? ''));

export const toFlagView = (flag, reportCount = 1) => ({
  id: String(flag._id),
  status: flag.status ?? 'open',
  reason: flag.reason ?? 'other',
  note: flag.note ?? '',
  resolution: flag.resolution ?? '',
  examTitle: flag.examTitle ?? '',
  reportCount,
  studentName: flag.reporter?.fullName || flag.student?.fullName || null,
  question: flag.question?.stem ? toQuestionView(flag.question) : null,
  createdAt: flag.createdAt ?? null,
  resolvedAt: flag.resolvedAt ?? null,
});

/**
 * The console queue. Every row carries how many students reported its question, because one
 * confused student and ten are different problems.
 */
export const listFlags = async (orgId) => {
  const rows = await OrgQuestionFlag.find({ organization: orgId })
    .sort({ status: 1, createdAt: -1 })
    .populate('question')
    .populate('student', 'fullName')
    .lean();
  const perQuestion = new Map();
  for (const row of rows) {
    const key = flagQuestionKey(row);
    perQuestion.set(key, (perQuestion.get(key) ?? 0) + 1);
  }
  const counts = { open: 0, resolved: 0, dismissed: 0 };
  for (const row of rows) {
    if (counts[row.status] !== undefined) counts[row.status] += 1;
  }
  return {
    items: rows.map((row) => toFlagView(row, perQuestion.get(flagQuestionKey(row)) ?? 1)),
    counts,
  };
};

export const updateFlag = async (orgId, flagId, body, actorId) => {
  assertFeature(await entitlementsFor(orgId), 'reports');
  const flag = await OrgQuestionFlag.findOne({ _id: flagId, organization: orgId });
  if (!flag) throw new AppError(404, 'FLAG_NOT_FOUND', 'That report does not exist.');
  flag.status = body.status;
  if (body.resolution !== undefined) flag.resolution = body.resolution;
  if (body.status === 'open') {
    flag.resolvedBy = null;
    flag.resolvedAt = null;
  } else {
    flag.resolvedBy = actorId ?? null;
    flag.resolvedAt = new Date();
  }
  await flag.save();
  await flag.populate([
    { path: 'question' },
    { path: 'student', select: 'fullName' },
  ]);
  const reportCount = await OrgQuestionFlag.countDocuments({ organization: orgId, question: flag.question?._id ?? null });
  return toFlagView(flag.toObject(), Math.max(1, reportCount));
};

/**
 * A student reports a question they were given. One row per student per question; a repeat
 * updates the note rather than piling up duplicates. Only a student who has actually seen the
 * question (it is on one of their papers) may report it.
 */
export const flagQuestion = async (org, user, questionId, body = {}) => {
  assertFeature(await entitlementsFor(org._id), 'reports');

  const question = await OrgQuestion.findOne({
    _id: questionId,
    organization: org._id,
    softDeleted: { $ne: true },
  })
    .select('_id')
    .lean();
  if (!question) throw new AppError(404, 'QUESTION_NOT_FOUND', 'That question does not exist.');

  const attempt = await OrgAttempt.findOne({
    organization: org._id,
    student: user._id,
    'questions.question': questionId,
  })
    .sort({ createdAt: -1 })
    .select('examTitle')
    .lean();
  if (!attempt) {
    throw new AppError(403, 'NOT_A_PARTICIPANT', 'You can only report a question you have seen in an exam.');
  }

  const flag = await OrgQuestionFlag.findOneAndUpdate(
    { organization: org._id, question: questionId, student: user._id },
    {
      $set: {
        reason: body.reason ?? 'other',
        note: body.note ?? '',
        examTitle: attempt.examTitle ?? '',
        reporter: { fullName: user.fullName ?? '', email: user.email ?? '' },
      },
      $setOnInsert: { status: 'open' },
    },
    { upsert: true, new: true, runValidators: true },
  ).lean();
  return { ok: true, flagId: String(flag._id) };
};
