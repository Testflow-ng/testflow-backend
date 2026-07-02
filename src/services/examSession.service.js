import { ExamSession } from '../models/ExamSession.js';
import { Question } from '../models/Question.js';
import { Subject } from '../models/Subject.js';
import { AppError } from '../utils/AppError.js';
import { shuffle } from '../utils/shuffle.js';
import { EXAM_CONFIG } from '../config/exam.js';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const resolveSubject = async (subjectRef) => {
  const filter = OBJECT_ID.test(subjectRef)
    ? { _id: subjectRef, isActive: true }
    : { code: String(subjectRef).toUpperCase(), isActive: true };
  const subject = await Subject.findOne(filter);
  if (!subject) {
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
  return subject;
};

const loadOwned = async (studentId, id) => {
  const session = await ExamSession.findById(id);
  // 404 for both missing and not-owned, so ownership can't be probed.
  if (!session || String(session.student) !== String(studentId)) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Exam session not found.');
  }
  return session;
};

const isExpired = (session) => new Date(session.expiresAt).getTime() <= Date.now();

const finalize = (session, submittedAt = new Date()) => {
  const correctCount = session.questions.reduce(
    (sum, question) => sum + (question.selectedOption === question.correctOption ? 1 : 0),
    0,
  );
  session.correctCount = correctCount;
  session.totalQuestions = session.questions.length;
  session.score = session.totalQuestions
    ? Math.round((correctCount / session.totalQuestions) * 100)
    : 0;
  session.status = 'submitted';
  session.submittedAt = submittedAt;
};

const remainingSeconds = (session) =>
  Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000));

/** Exam-taking view: never includes correctOption/explanation. */
const toExamView = (session) => ({
  id: String(session._id),
  subjectCode: session.subjectCode,
  status: session.status,
  durationMinutes: session.durationMinutes,
  startedAt: session.startedAt,
  expiresAt: session.expiresAt,
  remainingSeconds: remainingSeconds(session),
  totalQuestions: session.totalQuestions,
  questions: session.questions.map((question, index) => ({
    index,
    stem: question.stem,
    options: question.options,
    selectedOption: question.selectedOption,
    markedForReview: question.markedForReview,
  })),
});

/** Result view: full corrections, only used after submission. */
const toResultView = (session) => ({
  id: String(session._id),
  subjectCode: session.subjectCode,
  status: session.status,
  startedAt: session.startedAt,
  submittedAt: session.submittedAt,
  durationMinutes: session.durationMinutes,
  score: session.score,
  correctCount: session.correctCount,
  totalQuestions: session.totalQuestions,
  questions: session.questions.map((question, index) => ({
    index,
    stem: question.stem,
    options: question.options,
    selectedOption: question.selectedOption,
    correctOption: question.correctOption,
    explanation: question.explanation ?? null,
    isCorrect: question.selectedOption === question.correctOption,
  })),
});

const toSummary = (session) => ({
  id: String(session._id),
  subjectCode: session.subjectCode,
  status: session.status,
  score: session.score ?? null,
  correctCount: session.correctCount ?? null,
  totalQuestions: session.totalQuestions,
  startedAt: session.startedAt,
  submittedAt: session.submittedAt ?? null,
});

export const startSession = async (studentId, { subject: subjectRef, questionCount }) => {
  const subject = await resolveSubject(subjectRef);

  // Resume an existing live session for this subject, or retire it if expired.
  const existing = await ExamSession.findOne({
    student: studentId,
    subject: subject._id,
    status: 'in_progress',
  });
  if (existing) {
    if (!isExpired(existing)) {
      return toExamView(existing);
    }
    finalize(existing, existing.expiresAt);
    await existing.save();
  }

  const available = await Question.countDocuments({ subject: subject._id, isActive: true });
  if (available === 0) {
    throw new AppError(409, 'NO_QUESTIONS', 'This subject has no questions yet.');
  }

  const count = Math.min(
    questionCount ?? EXAM_CONFIG.defaultQuestionCount,
    EXAM_CONFIG.maxQuestionCount,
    available,
  );

  const sampled = await Question.aggregate([
    { $match: { subject: subject._id, isActive: true } },
    { $sample: { size: count } },
  ]);

  const questions = sampled.map((question) => {
    const shuffled = shuffle(question.options.map((option, i) => ({ option, i })));
    return {
      question: question._id,
      stem: question.stem,
      options: shuffled.map((entry) => entry.option),
      correctOption: shuffled.findIndex((entry) => entry.i === question.correctIndex),
      explanation: question.explanation,
      selectedOption: null,
      markedForReview: false,
    };
  });

  const durationMinutes = Math.max(1, count * EXAM_CONFIG.minutesPerQuestion);
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);

  const session = await ExamSession.create({
    student: studentId,
    subject: subject._id,
    subjectCode: subject.code,
    durationMinutes,
    startedAt,
    expiresAt,
    questions,
    totalQuestions: questions.length,
  });

  return toExamView(session);
};

export const getSession = async (studentId, id) => {
  const session = await loadOwned(studentId, id);
  if (session.status === 'in_progress' && isExpired(session)) {
    finalize(session, session.expiresAt);
    await session.save();
  }
  return toExamView(session);
};

export const saveAnswer = async (studentId, id, { questionIndex, selectedOption, markedForReview }) => {
  const session = await loadOwned(studentId, id);

  if (session.status !== 'in_progress') {
    throw new AppError(409, 'SESSION_CLOSED', 'This exam has already been submitted.');
  }
  if (isExpired(session)) {
    finalize(session, session.expiresAt);
    await session.save();
    throw new AppError(409, 'SESSION_EXPIRED', 'Time is up. Your exam has been submitted.');
  }

  const question = session.questions[questionIndex];
  if (!question) {
    throw new AppError(400, 'INVALID_QUESTION_INDEX', 'Invalid question.');
  }
  if (
    selectedOption !== undefined &&
    selectedOption !== null &&
    (selectedOption < 0 || selectedOption >= question.options.length)
  ) {
    throw new AppError(400, 'INVALID_OPTION', 'Invalid option.');
  }

  if (selectedOption !== undefined) question.selectedOption = selectedOption;
  if (markedForReview !== undefined) question.markedForReview = markedForReview;
  await session.save();

  return {
    index: questionIndex,
    selectedOption: question.selectedOption,
    markedForReview: question.markedForReview,
  };
};

export const submitSession = async (studentId, id) => {
  const session = await loadOwned(studentId, id);
  if (session.status === 'in_progress') {
    finalize(session);
    await session.save();
  }
  return toResultView(session);
};

export const getResult = async (studentId, id) => {
  const session = await loadOwned(studentId, id);
  if (session.status === 'in_progress') {
    if (!isExpired(session)) {
      throw new AppError(409, 'SESSION_IN_PROGRESS', 'This exam has not been submitted yet.');
    }
    finalize(session, session.expiresAt);
    await session.save();
  }
  return toResultView(session);
};

export const listSessions = async (studentId) => {
  const sessions = await ExamSession.find({ student: studentId }).sort({ createdAt: -1 }).limit(50);
  return sessions.map(toSummary);
};
