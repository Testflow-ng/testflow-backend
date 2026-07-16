import { ExamSession } from '../models/ExamSession.js';
import { Question } from '../models/Question.js';
import { Subject } from '../models/Subject.js';
import { User } from '../models/User.js';
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

export const startSession = async (
  studentId,
  { subject: subjectRef, questionCount, durationMinutes: requestedDuration, topicId },
) => {
  const subject = await resolveSubject(subjectRef);

  // Resume an existing live session for this subject, or retire it if expired.
  // Note: if a student starts a session with a specific topic, resuming will give them that.
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

  const query = { subject: subject._id, isActive: true };
  if (topicId) {
    query.topicId = topicId;
  }

  const available = await Question.countDocuments(query);
  if (available === 0) {
    throw new AppError(409, 'NO_QUESTIONS', `This subject ${topicId ? `(topicId: ${topicId})` : ''} has no questions yet.`);
  }

  const count = Math.min(
    questionCount ?? EXAM_CONFIG.defaultQuestionCount,
    EXAM_CONFIG.maxQuestionCount,
    available,
  );

  const sampled = await Question.aggregate([
    { $match: query },
    { $sample: { size: count } },
  ]);

  if (!sampled.length) {
    throw new AppError(500, 'SAMPLING_FAILED', 'Could not retrieve questions. Please try again.');
  }

  const questions = shuffle(
    sampled.map((question) => {
      const shuffledOptions = shuffle(question.options.map((option, i) => ({ option, i })));
      return {
        question: question._id,
        stem: question.stem,
        options: shuffledOptions.map((entry) => entry.option),
        correctOption: shuffledOptions.findIndex((entry) => entry.i === question.correctIndex),
        explanation: question.explanation,
        selectedOption: null,
        markedForReview: false,
      };
    }),
  );

  // Use the student's chosen time if provided (clamped), else default to
  // one minute per question.
  const durationMinutes = Math.min(
    Math.max(
      EXAM_CONFIG.minDurationMinutes,
      requestedDuration ?? count * EXAM_CONFIG.minutesPerQuestion,
    ),
    EXAM_CONFIG.maxDurationMinutes,
  );
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);

  try {
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
  } catch (caught) {
    // Lost a race with a concurrent start (partial unique index): resume theirs.
    if (caught.code === 11000) {
      const existing = await ExamSession.findOne({
        student: studentId,
        subject: subject._id,
        status: 'in_progress',
      });
      if (existing) return toExamView(existing);
    }
    throw caught;
  }
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

  const updates = {};
  if (selectedOption !== undefined) {
    updates[`questions.${questionIndex}.selectedOption`] = selectedOption;
  }
  if (markedForReview !== undefined) {
    updates[`questions.${questionIndex}.markedForReview`] = markedForReview;
  }

  // Targeted atomic write: concurrent autosaves on different questions must not
  // clobber each other (a full-document save would). The filter re-checks
  // status + expiry to close the check-to-write window.
  await ExamSession.updateOne(
    { _id: id, student: studentId, status: 'in_progress', expiresAt: { $gt: new Date() } },
    { $set: updates },
  );

  return {
    index: questionIndex,
    selectedOption: selectedOption !== undefined ? selectedOption : question.selectedOption,
    markedForReview: markedForReview !== undefined ? markedForReview : question.markedForReview,
  };
};

export const recordStrike = async (studentId, id) => {
  const session = await loadOwned(studentId, id);

  if (session.status !== 'in_progress' || isExpired(session)) {
    return { status: session.status };
  }

  session.strikes = (session.strikes ?? 0) + 1;

  // Professional rule: auto-submit on 3 strikes
  if (session.strikes >= 3) {
    finalize(session);
  }

  await session.save();
  return { strikes: session.strikes, status: session.status };
};

export const submitSession = async (studentId, id) => {
  const session = await loadOwned(studentId, id);
  if (session.status === 'in_progress') {
    finalize(session, isExpired(session) ? session.expiresAt : undefined);
    await session.save();

    // Update Streak logic
    try {
      const user = await User.findById(studentId);
      if (user) {
        const now = new Date();
        const lastActive = user.lastActiveAt;

        if (!lastActive) {
          user.streakCount = 1;
        } else {
          const diffDays = Math.floor((now - lastActive) / (1000 * 60 * 60 * 24));
          if (diffDays === 0) {
            // Already active today, streak stays the same
          } else if (diffDays === 1) {
            // Consecutive day, increment streak
            user.streakCount += 1;
          } else {
            // Broke the streak, reset to 1
            user.streakCount = 1;
          }
        }
        user.lastActiveAt = now;
        await user.save();
      }
    } catch (err) {
      console.error('Streak update failed:', err);
      // Don't crash submission if streak update fails
    }
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

export const getStats = async (studentId) => {
  const match = { student: studentId, status: 'submitted' };

  const [overall] = await ExamSession.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalExams: { $sum: 1 },
        averageScore: { $avg: '$score' },
        bestScore: { $max: '$score' },
        totalCorrect: { $sum: '$correctCount' },
        totalAnswered: { $sum: '$totalQuestions' },
      },
    },
  ]);

  const perSubject = await ExamSession.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$subjectCode',
        attempts: { $sum: 1 },
        averageScore: { $avg: '$score' },
        bestScore: { $max: '$score' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    totalExams: overall?.totalExams ?? 0,
    averageScore: overall ? Math.round(overall.averageScore) : 0,
    bestScore: overall?.bestScore ?? 0,
    totalCorrect: overall?.totalCorrect ?? 0,
    totalAnswered: overall?.totalAnswered ?? 0,
    perSubject: perSubject.map((entry) => ({
      subjectCode: entry._id,
      attempts: entry.attempts,
      averageScore: Math.round(entry.averageScore),
      bestScore: entry.bestScore,
    })),
  };
};
