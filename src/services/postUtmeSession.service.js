import { PostUtmeSession } from '../models/PostUtmeSession.js';
import { Question } from '../models/Question.js';
import { Subject } from '../models/Subject.js';
import { User } from '../models/User.js';
import { Settings } from '../models/Settings.js';
import { AppError } from '../utils/AppError.js';
import { shuffle } from '../utils/shuffle.js';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const resolveSubjects = async (subjectRefs) => {
  const ids = subjectRefs.map(ref => OBJECT_ID.test(ref) ? ref : null).filter(Boolean);
  const codes = subjectRefs.filter(ref => !OBJECT_ID.test(ref)).map(c => c.toUpperCase());

  const subjects = await Subject.find({
    $or: [
      { _id: { $in: ids } },
      { code: { $in: codes } }
    ],
    isActive: true
  });

  if (subjects.length !== subjectRefs.length) {
    throw new AppError(404, 'SUBJECTS_NOT_FOUND', 'One or more selected subjects were not found.');
  }
  return subjects;
};

const finalize = (session, submittedAt = new Date()) => {
  const scores = new Map();
  let totalCorrect = 0;

  session.questions.forEach(q => {
    const isCorrect = q.selectedOption === q.correctOption;
    if (isCorrect) totalCorrect++;

    const subjectId = String(q.subject);
    const currentScore = scores.get(subjectId) ?? 0;
    scores.set(subjectId, currentScore + (isCorrect ? 1 : 0));
  });

  session.scores = scores;
  session.totalScore = totalCorrect; // Max 40 usually
  session.status = 'submitted';
  session.submittedAt = submittedAt;

  const startedAt = new Date(session.startedAt);
  const timeTakenMs = submittedAt.getTime() - startedAt.getTime();
  session.timeTakenSeconds = Math.max(1, Math.floor(timeTakenMs / 1000));
};

export const startSession = async (studentId, { subjects: subjectRefs }) => {
  const settings = await Settings.getInstance();
  if (!settings.isPostUtmeActive) {
    throw new AppError(403, 'FEATURE_DISABLED', 'Post-UTME mock tests are currently closed.');
  }

  const user = await User.findById(studentId);
  if (!user.isPostUtmePaid) {
    throw new AppError(403, 'PAYMENT_REQUIRED', 'Please pay for Post-UTME access to use this feature.');
  }

  if (!Array.isArray(subjectRefs) || subjectRefs.length !== 3) {
    throw new AppError(400, 'INVALID_SUBJECT_COUNT', 'You must select exactly 3 elective subjects. General Knowledge is compulsory.');
  }

  // Find the compulsory subject (General Knowledge)
  const compulsory = await Subject.findOne({ isCompulsoryUtme: true, isActive: true });
  if (!compulsory) {
    throw new AppError(500, 'CONFIG_ERROR', 'Compulsory Post-UTME subject not found. Contact Admin.');
  }

  const subjects = await resolveSubjects([...subjectRefs, compulsory._id]);

  // Resume or finalize existing
  const existing = await PostUtmeSession.findOne({ student: studentId, status: 'in_progress' });
  if (existing) {
    if (new Date(existing.expiresAt) > new Date()) {
      return existing;
    }
    finalize(existing, existing.expiresAt);
    await existing.save();
  }

  const allQuestions = [];
  for (const subject of subjects) {
    const sampled = await Question.aggregate([
      { $match: { subject: subject._id, isActive: true } },
      { $sample: { size: 10 } }
    ]);

    if (sampled.length < 10) {
      throw new AppError(409, 'INSUFFICIENT_QUESTIONS', `Subject ${subject.code} does not have enough questions (need 10).`);
    }

    sampled.forEach(q => {
      const shuffledOptions = shuffle(q.options.map((option, i) => ({ option, i })));
      allQuestions.push({
        question: q._id,
        subject: subject._id,
        stem: q.stem,
        options: shuffledOptions.map(o => o.option),
        correctOption: shuffledOptions.findIndex(o => o.i === q.correctIndex),
        explanation: q.explanation,
        selectedOption: null,
        markedForReview: false
      });
    });
  }

  // Shuffle the final set of 40 questions so subjects are mixed together
  const questions = shuffle(allQuestions);

  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + 60 * 60 * 1000); // 60 minutes default

  return PostUtmeSession.create({
    student: studentId,
    subjects: subjects.map(s => s._id),
    subjectCodes: subjects.map(s => s.code),
    expiresAt,
    questions,
    totalQuestions: questions.length
  });
};

export const saveAnswer = async (studentId, id, { questionIndex, selectedOption, markedForReview }) => {
  const session = await PostUtmeSession.findById(id);
  if (!session || String(session.student) !== String(studentId)) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  }

  if (session.status !== 'in_progress') throw new AppError(409, 'SESSION_CLOSED', 'Exam already submitted.');
  if (new Date(session.expiresAt) <= new Date()) {
    finalize(session, session.expiresAt);
    await session.save();
    throw new AppError(409, 'SESSION_EXPIRED', 'Time is up.');
  }

  const updates = {};
  if (selectedOption !== undefined) updates[`questions.${questionIndex}.selectedOption`] = selectedOption;
  if (markedForReview !== undefined) updates[`questions.${questionIndex}.markedForReview`] = markedForReview;

  await PostUtmeSession.updateOne({ _id: id }, { $set: updates });
  return { success: true };
};

export const submitSession = async (studentId, id) => {
  const session = await PostUtmeSession.findById(id);
  if (!session || String(session.student) !== String(studentId)) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  }

  if (session.status === 'in_progress') {
    finalize(session, new Date(session.expiresAt) <= new Date() ? session.expiresAt : new Date());
    await session.save();
  }
  return session;
};

export const recordStrike = async (studentId, id) => {
  const session = await PostUtmeSession.findById(id);
  if (!session || String(session.student) !== String(studentId)) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  }

  if (session.status !== 'in_progress') return { status: session.status };

  session.strikes = (session.strikes ?? 0) + 1;
  if (session.strikes >= 3) {
    finalize(session);
  }
  await session.save();
  return { strikes: session.strikes, status: session.status };
};

export const getStats = async (studentId) => {
  const sessions = await PostUtmeSession.find({ student: studentId, status: 'submitted' }).sort({ createdAt: -1 });
  return sessions;
};
