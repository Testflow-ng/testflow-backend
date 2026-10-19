import { OrgAttempt } from '../models/OrgAttempt.js';
import { OrgExam } from '../models/OrgExam.js';
import { OrgPayment } from '../models/OrgPayment.js';
import { OrgQuestion } from '../models/OrgQuestion.js';
import { AppError } from '../utils/AppError.js';
import { shuffle } from '../utils/shuffle.js';
import { entitlementsFor } from './entitlements.js';
import { assertFeature } from './orgContent.service.js';

/**
 * Taking an organisation's exam on its own tenant site.
 *
 * The server owns the clock: `endsAt` is written at start (for a live exam it is the same for
 * everyone), and every read, answer and submit checks it. A paper is marked exactly once. The
 * attempt keeps its own snapshot of the questions, so an edit to the bank after the sitting can
 * never move a past score or rewrite its corrections.
 *
 * What a student may see afterwards is decided by the exam's `showCorrections` setting, read at
 * request time; `hidden` never returns a score, in the submit response as well as in the result
 * endpoints.
 */

const LIVE_LATE_JOIN_MS = 10 * 60 * 1000;
const LIVE_CORRECTIONS_GRACE_MS = 10 * 60 * 1000;

const nowMs = () => Date.now();

const isExpired = (attempt) => new Date(attempt.endsAt).getTime() <= nowMs();

const remainingSeconds = (attempt) =>
  Math.max(0, Math.floor((new Date(attempt.endsAt).getTime() - nowMs()) / 1000));

const requirePlanFeature = async (orgId, feature) => {
  const ent = await entitlementsFor(orgId);
  assertFeature(ent, feature);
  return ent;
};

const requirePaidAccess = async (org, user, exam) => {
  if (!(exam.priceMinor > 0)) return;
  const paid = await OrgPayment.exists({
    organization: org._id,
    student: user._id,
    item: 'exam',
    itemRef: exam._id,
    status: 'paid',
  });
  if (!paid) {
    const error = new AppError(402, 'PAYMENT_REQUIRED', 'Pay for this exam before you start it.');
    error.details = { examId: String(exam._id), priceMinor: exam.priceMinor, currency: exam.currency ?? 'NGN' };
    throw error;
  }
};

const assertAccessCode = (exam, provided) => {
  if (exam.access !== 'code') return;
  const expected = String(exam.accessCode ?? '').trim().toLowerCase();
  const actual = String(provided ?? '').trim().toLowerCase();
  if (!expected || actual !== expected) {
    throw new AppError(403, 'INVALID_ACCESS_CODE', 'That access code is not correct.');
  }
};

/** Live exams only start at their announced time, and late joiners get 10 minutes. */
const assertLiveWindow = (exam) => {
  if (exam.mode !== 'live') return;
  const startsAt = exam.startsAt ? new Date(exam.startsAt).getTime() : null;
  if (!startsAt) throw new AppError(422, 'START_IN_PAST', 'This live exam has no start time.');
  if (nowMs() < startsAt) {
    const error = new AppError(409, 'EXAM_NOT_STARTED', 'This live exam has not started yet.');
    error.details = { startsAt: exam.startsAt };
    throw error;
  }
  if (nowMs() > startsAt + LIVE_LATE_JOIN_MS) {
    throw new AppError(409, 'EXAM_CLOSED', 'This live exam has already started and the join window has closed.');
  }
};

const snapshotQuestions = async (orgId, exam) => {
  const ids = (exam.questionIds ?? []).map(String);
  if (!ids.length) throw new AppError(422, 'NO_QUESTIONS', 'This exam has no questions yet.');
  const rows = await OrgQuestion.find({
    _id: { $in: ids },
    organization: orgId,
    softDeleted: { $ne: true },
  }).lean();
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  let paper = ids.map((id) => byId.get(id)).filter(Boolean);

  if (!paper.length) throw new AppError(422, 'NO_QUESTIONS', 'This exam has no questions yet.');
  if (exam.shuffleQuestions) paper = shuffle(paper);

  return paper.map((question) => {
    let options = (question.options ?? []).map((option) => ({
      text: option.text ?? '',
      imageUrl: option.imageUrl ?? null,
    }));
    let correctIndex = question.correctIndex;
    if (exam.shuffleOptions && options.length) {
      const indexed = options.map((option, index) => ({ option, index }));
      const mixed = shuffle(indexed);
      options = mixed.map((entry) => entry.option);
      correctIndex = mixed.findIndex((entry) => entry.index === question.correctIndex);
    }
    return {
      question: question._id,
      stem: question.stem,
      stemImageUrl: question.stemImageUrl ?? null,
      options,
      correctIndex,
      explanation: question.explanation ?? '',
      explanationImageUrl: question.explanationImageUrl ?? null,
      topic: question.topic ?? '',
    };
  });
};

const markAttempt = (attempt, submittedAt = new Date()) => {
  const byQuestion = new Map((attempt.answers ?? []).map((answer) => [String(answer.question), answer]));
  let correctCount = 0;
  let wrongCount = 0;
  const answers = (attempt.questions ?? []).map((question) => {
    const answer = byQuestion.get(String(question.question));
    const selectedIndex = answer?.selectedIndex ?? null;
    const correct = selectedIndex !== null && selectedIndex === question.correctIndex;
    if (correct) correctCount += 1;
    else if (selectedIndex !== null) wrongCount += 1;
    return {
      question: question.question,
      selectedIndex,
      correct,
    };
  });

  const total = (attempt.questions ?? []).length;
  const marks = Math.max(0, Number(attempt.marksPerQuestion ?? 1));
  const negative = Math.max(0, Number(attempt.negativeMarking ?? 0));
  const raw = correctCount * marks - wrongCount * negative;
  const max = total * marks;
  attempt.answers = answers;
  attempt.correctCount = correctCount;
  attempt.total = total;
  attempt.scorePercent = max > 0 ? Math.max(0, Math.min(100, Math.round((raw / max) * 100))) : 0;
  attempt.status = submittedAt.getTime() >= new Date(attempt.endsAt).getTime() ? 'timed_out' : 'submitted';
  attempt.submittedAt = submittedAt;
  attempt.timeMinutes = Math.max(1, Math.round((submittedAt.getTime() - new Date(attempt.startedAt).getTime()) / 60000));
  return attempt;
};

const finalize = async (attempt, submittedAt = new Date()) => {
  markAttempt(attempt, submittedAt);
  await attempt.save();
  return attempt;
};

const toSittingView = (attempt) => ({
  id: String(attempt._id),
  examId: String(attempt.exam),
  examTitle: attempt.examTitle,
  status: attempt.status,
  startedAt: attempt.startedAt,
  endsAt: attempt.endsAt,
  remainingSeconds: remainingSeconds(attempt),
  totalQuestions: (attempt.questions ?? []).length,
  questions: (attempt.questions ?? []).map((question, index) => ({
    id: String(question.question),
    index,
    stem: question.stem,
    stemImageUrl: question.stemImageUrl ?? null,
    options: (question.options ?? []).map((option) => option.text ?? ''),
    optionImages: (question.options ?? []).map((option) => option.imageUrl ?? null),
    topic: question.topic ?? '',
  })),
});

/** Whether the exam is closed, for `after_exam` corrections. Anytime exams close on unpublish. */
const examClosed = (exam) => {
  if (!exam || exam.status !== 'published') return true;
  if (exam.mode !== 'live') return false;
  if (!exam.startsAt) return true;
  return nowMs() >= new Date(exam.startsAt).getTime() + exam.durationMinutes * 60_000 + LIVE_CORRECTIONS_GRACE_MS;
};

const canShowCorrections = (exam) => {
  const setting = exam?.showCorrections ?? 'now';
  if (setting === 'now') return true;
  if (setting === 'after_exam') return examClosed(exam);
  return false;
};

const correctionsFor = (attempt) =>
  (attempt.questions ?? []).map((question) => {
    const answer = (attempt.answers ?? []).find((row) => String(row.question) === String(question.question));
    const selectedIndex = answer?.selectedIndex ?? null;
    return {
      questionId: String(question.question),
      stem: question.stem,
      stemImageUrl: question.stemImageUrl ?? null,
      options: (question.options ?? []).map((option) => option.text ?? ''),
      optionImages: (question.options ?? []).map((option) => option.imageUrl ?? null),
      correctIndex: question.correctIndex,
      selectedIndex,
      correct: selectedIndex !== null && selectedIndex === question.correctIndex,
      explanation: question.explanation ?? '',
      explanationImageUrl: question.explanationImageUrl ?? null,
      topic: question.topic ?? '',
    };
  });

/** A result the student is allowed to see. `hidden` carries no score at all. */
const toStudentResult = (attempt, exam) => {
  const base = {
    id: String(attempt._id),
    examId: String(attempt.exam),
    examTitle: attempt.examTitle,
    status: attempt.status,
    submittedAt: attempt.submittedAt,
  };
  if ((exam?.showCorrections ?? 'now') === 'hidden') return { ...base, hidden: true };

  const corrections = canShowCorrections(exam) ? correctionsFor(attempt) : null;
  return {
    ...base,
    hidden: false,
    scorePercent: attempt.scorePercent,
    correct: attempt.correctCount,
    total: attempt.total,
    timeMinutes: attempt.timeMinutes,
    corrections,
    correctionsAvailable: Boolean(corrections),
  };
};

const toStudentResultRow = (attempt, exam) => {
  const base = {
    id: String(attempt._id),
    examId: String(attempt.exam),
    examTitle: attempt.examTitle,
    status: attempt.status,
    submittedAt: attempt.submittedAt,
  };
  if ((exam?.showCorrections ?? 'now') === 'hidden') return { ...base, hidden: true };
  return {
    ...base,
    hidden: false,
    scorePercent: attempt.scorePercent,
    correct: attempt.correctCount,
    total: attempt.total,
    timeMinutes: attempt.timeMinutes,
  };
};

const examsByIds = async (orgId, attempts) => {
  const ids = [...new Set(attempts.map((attempt) => String(attempt.exam)))];
  if (!ids.length) return new Map();
  const rows = await OrgExam.find({ _id: { $in: ids }, organization: orgId })
    .select('showCorrections status mode startsAt durationMinutes')
    .lean();
  return new Map(rows.map((row) => [String(row._id), row]));
};

export const startAttempt = async (org, user, examId, { accessCode } = {}) => {
  const exam = await OrgExam.findOne({ _id: examId, organization: org._id, status: 'published' }).lean();
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');

  if (exam.mode === 'live') {
    await requirePlanFeature(org._id, 'live_cbt');
    assertLiveWindow(exam);
  }
  assertAccessCode(exam, accessCode);
  await requirePaidAccess(org, user, exam);

  const count = await OrgAttempt.countDocuments({ organization: org._id, exam: exam._id, student: user._id });
  const existing = await OrgAttempt.findOne({
    organization: org._id,
    exam: exam._id,
    student: user._id,
    status: 'in_progress',
  });

  if (existing) {
    if (!isExpired(existing)) return { attempt: toSittingView(existing) };
    await finalize(existing, new Date(existing.endsAt));
  }

  if (count >= (exam.attemptsAllowed ?? 1)) {
    throw new AppError(409, 'ATTEMPTS_EXHAUSTED', 'You have used all the attempts for this exam.');
  }

  const paper = await snapshotQuestions(org._id, exam);
  const now = new Date();
  const startsAt = exam.startsAt ? new Date(exam.startsAt) : now;
  const endsAt =
    exam.mode === 'live'
      ? new Date(startsAt.getTime() + exam.durationMinutes * 60_000)
      : new Date(now.getTime() + exam.durationMinutes * 60_000);

  let attempt;
  try {
    attempt = await OrgAttempt.create({
      organization: org._id,
      exam: exam._id,
      student: user._id,
      examTitle: exam.title,
      attemptNumber: count + 1,
      questions: paper,
      answers: paper.map((question) => ({ question: question.question, selectedIndex: null, correct: false })),
      marksPerQuestion: exam.marksPerQuestion ?? 1,
      negativeMarking: exam.negativeMarking ?? 0,
      startedAt: now,
      endsAt,
    });
  } catch (error) {
    // Lost a race with a second start request: return the paper the other request created.
    if (error?.code === 11000) {
      const resumed = await OrgAttempt.findOne({
        organization: org._id,
        exam: exam._id,
        student: user._id,
        status: 'in_progress',
      });
      if (resumed) return { attempt: toSittingView(resumed) };
    }
    throw error;
  }

  return { attempt: toSittingView(attempt) };
};

const loadOwnAttempt = async (orgId, userId, attemptId) => {
  const attempt = await OrgAttempt.findOne({ _id: attemptId, organization: orgId, student: userId });
  if (!attempt) throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'That attempt does not exist.');
  return attempt;
};

export const saveAnswer = async (orgId, userId, attemptId, { questionId, selectedIndex }) => {
  const attempt = await loadOwnAttempt(orgId, userId, attemptId);
  if (attempt.status !== 'in_progress') {
    throw new AppError(409, 'ATTEMPT_CLOSED', 'This paper has already been submitted.');
  }
  if (isExpired(attempt)) {
    await finalize(attempt, new Date(attempt.endsAt));
    throw new AppError(409, 'EXAM_ENDED', 'Time is up. Your paper has been submitted.');
  }
  const question = attempt.questions.find((row) => String(row.question) === String(questionId));
  if (!question) throw new AppError(422, 'QUESTION_NOT_IN_ATTEMPT', 'That question is not on this paper.');
  if (selectedIndex !== null && selectedIndex !== undefined) {
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= question.options.length) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Choose one of the options on this question.');
    }
  }
  const answer = attempt.answers.find((row) => String(row.question) === String(questionId));
  if (answer) answer.selectedIndex = selectedIndex ?? null;
  else attempt.answers.push({ question: question.question, selectedIndex: selectedIndex ?? null, correct: false });
  await attempt.save();
  return { ok: true, questionId: String(questionId), selectedIndex: selectedIndex ?? null };
};

export const submitAttempt = async (orgId, userId, attemptId) => {
  const attempt = await loadOwnAttempt(orgId, userId, attemptId);
  const exam = await OrgExam.findOne({ _id: attempt.exam, organization: orgId }).lean();
  if (attempt.status === 'in_progress') {
    await finalize(attempt, isExpired(attempt) ? new Date(attempt.endsAt) : new Date());
  }
  return { result: toStudentResult(attempt, exam) };
};

export const getMyResults = async (orgId, userId, { page = 1, limit = 20 } = {}) => {
  const where = { organization: orgId, student: userId, status: { $in: ['submitted', 'timed_out'] } };
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    OrgAttempt.find(where).sort({ submittedAt: -1 }).skip(skip).limit(limit).lean(),
    OrgAttempt.countDocuments(where),
  ]);
  const exams = await examsByIds(orgId, rows);
  return {
    items: rows.map((attempt) => toStudentResultRow(attempt, exams.get(String(attempt.exam)))),
    page,
    limit,
    total,
  };
};

export const getMyResult = async (orgId, userId, attemptId) => {
  const attempt = await loadOwnAttempt(orgId, userId, attemptId);
  if (attempt.status === 'in_progress') {
    if (isExpired(attempt)) {
      await finalize(attempt, new Date(attempt.endsAt));
    } else {
      throw new AppError(409, 'ATTEMPT_IN_PROGRESS', 'Finish this paper before viewing its result.');
    }
  }
  const exam = await OrgExam.findOne({ _id: attempt.exam, organization: orgId }).lean();
  return toStudentResult(attempt, exam);
};
