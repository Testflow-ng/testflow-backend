import mongoose from 'mongoose';
import { Subject } from '../models/Subject.js';
import { Question } from '../models/Question.js';
import { ExamSession } from '../models/ExamSession.js';
import { AppError } from '../utils/AppError.js';

/** List subjects (active by default), each annotated with its active question count. */
export const listSubjects = async ({ includeInactive = false, level, department } = {}) => {
  const filter = includeInactive ? {} : { isActive: true };

  if (level) {
    filter.level = level;
  }

  if (department) {
    // Show departmental subjects OR general subjects
    filter.$or = [
      { department: department },
      { isGeneral: true }
    ];
  }

  const subjects = await Subject.find(filter).sort({ code: 1 });

  const counts = await Question.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$subject', count: { $sum: 1 } } },
  ]);
  const countBySubject = new Map(counts.map((entry) => [String(entry._id), entry.count]));

  return subjects.map((subject) => ({
    ...subject.toJSON(),
    questionCount: countBySubject.get(String(subject._id)) ?? 0,
  }));
};

export const getSubjectByCode = async (code, { includeInactive = false } = {}) => {
  const filter = { code: code.toUpperCase() };
  if (!includeInactive) filter.isActive = true;
  const subject = await Subject.findOne(filter);
  if (!subject) {
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
  return subject;
};

export const deleteSubject = async (id) => {
  // Cascading delete for questions only.
  // We preserve ExamSessions (student history) even if the subject is removed,
  // as the sessions store the subjectCode for display purposes.
  await Question.deleteMany({ subject: id });

  const subject = await Subject.findByIdAndDelete(id);
  if (!subject) {
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
};

export const createSubject = async (data) => {
  if (data.level === 'post-utme' && !data.code) {
    // Auto-generate code for Post-UTME if missing
    // e.g., "Use of English" -> "PUTME-ENG"
    const slug = data.title
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
    data.code = `PUTME-${slug || Date.now().toString(36).toUpperCase()}`;
  }
  return Subject.create(data);
};

export const updateSubject = async (id, updates) => {
  const subject = await Subject.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  });
  if (!subject) {
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
  return subject;
};

/**
 * The subject board: each student's best submitted score for one subject, ranked with the same
 * tie-breaks as the Hall of Fame (score, then questions, then time, then date). The caller's own
 * row and rank ride along in `me`, even when they are below the visible top ten.
 */
export const getSubjectLeaderboard = async (subjectId, userId = null) => {
  const rows = await ExamSession.aggregate([
    {
      $match: {
        subject: new mongoose.Types.ObjectId(subjectId),
        status: 'submitted'
      }
    },
    {
      $sort: { score: -1, totalQuestions: -1, timeTakenSeconds: 1, submittedAt: 1 }
    },
    {
      $group: {
        _id: '$student',
        bestScore: { $first: '$score' },
        totalQuestions: { $first: '$totalQuestions' },
        timeTakenSeconds: { $first: '$timeTakenSeconds' },
        date: { $first: '$submittedAt' }
      }
    },
    { $sort: { bestScore: -1, totalQuestions: -1, timeTakenSeconds: 1 } },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'studentInfo'
      }
    },
    { $unwind: '$studentInfo' },
    // Filter out users who opted out of the leaderboard
    { $match: { 'studentInfo.showOnLeaderboard': { $ne: false } } }
  ]);

  const ranked = rows.map((row, index) => ({
    rank: index + 1,
    studentId: String(row._id),
    username: row.studentInfo.username ?? null,
    fullName: row.studentInfo.fullName,
    score: row.bestScore,
    totalQuestions: row.totalQuestions,
    timeTakenSeconds: row.timeTakenSeconds,
    date: row.date,
  }));

  const leaderboard = ranked.slice(0, 10).map((row) => ({
    rank: row.rank,
    username: row.username,
    fullName: row.fullName,
    score: row.score,
    totalQuestions: row.totalQuestions,
    timeTakenSeconds: row.timeTakenSeconds,
    date: row.date,
  }));
  const mine = userId ? ranked.find((row) => row.studentId === String(userId)) : null;
  const me = mine
    ? {
        rank: mine.rank,
        username: mine.username,
        fullName: mine.fullName,
        score: mine.score,
        totalQuestions: mine.totalQuestions,
        timeTakenSeconds: mine.timeTakenSeconds,
      }
    : null;

  return { leaderboard, me };
};

/** A tiny process-local cache; the overall board is read-heavy and changes slowly. */
const OVERALL_TTL_MS = 3 * 60 * 1000;
const overallCache = new Map();
const cacheKey = (options) => `${options.limit}|${options.level ?? ''}|${options.period}`;

const periodStart = (period) => {
  if (period === 'week') return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (period === 'month') return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return null;
};

const computeOverall = async ({ level = null, period = 'all' } = {}) => {
  const match = { status: 'submitted' };
  const start = periodStart(period);
  if (start) match.submittedAt = { $gte: start };

  const rows = await ExamSession.aggregate([
    { $match: match },
    // Best attempt per (student, subject) first, so `points` sums the best per subject.
    { $sort: { score: -1, totalQuestions: -1, timeTakenSeconds: 1, submittedAt: 1 } },
    {
      $group: {
        _id: { student: '$student', subject: '$subject' },
        bestScore: { $first: '$score' },
        attempts: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.student',
        points: { $sum: '$bestScore' },
        subjectsCount: { $sum: 1 },
        averageScore: { $avg: '$bestScore' },
        examsCount: { $sum: '$attempts' },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'studentInfo',
      },
    },
    { $unwind: '$studentInfo' },
    // The board shows usernames, and privacy is opt-out.
    {
      $match: {
        'studentInfo.showOnLeaderboard': { $ne: false },
        'studentInfo.username': { $type: 'string' },
        ...(level ? { 'studentInfo.level': String(level) } : {}),
      },
    },
    { $sort: { points: -1, subjectsCount: -1, averageScore: -1, 'studentInfo.username': 1 } },
  ]);

  return rows.map((row, index) => ({
    rank: index + 1,
    studentId: String(row._id),
    username: row.studentInfo.username,
    fullName: row.studentInfo.fullName,
    points: row.points,
    subjectsCount: row.subjectsCount,
    averageScore: Math.round(row.averageScore * 10) / 10,
    examsCount: row.examsCount,
  }));
};

/** The Hall of Fame overall board: the sum of each student's best score per subject. */
export const getOverallLeaderboard = async ({ limit = 10, level = null, period = 'all' } = {}, userId = null) => {
  const options = { limit: Math.min(Math.max(Number(limit) || 10, 1), 50), level, period };
  const key = cacheKey(options);
  const cached = overallCache.get(key);
  let ranked;
  if (cached && cached.expiresAt > Date.now()) {
    ranked = cached.ranked;
  } else {
    ranked = await computeOverall(options);
    overallCache.set(key, { ranked, expiresAt: Date.now() + OVERALL_TTL_MS });
  }

  const leaderboard = ranked.slice(0, options.limit).map((row) => ({
    rank: row.rank,
    username: row.username,
    fullName: row.fullName,
    points: row.points,
    subjectsCount: row.subjectsCount,
    averageScore: row.averageScore,
    examsCount: row.examsCount,
  }));
  const mine = userId ? ranked.find((row) => row.studentId === String(userId)) : null;
  const me = mine
    ? { rank: mine.rank, points: mine.points, subjectsCount: mine.subjectsCount, averageScore: mine.averageScore, examsCount: mine.examsCount }
    : null;

  return { leaderboard, me };
};

export const togglePinSubject = async (userId, subjectId) => {
  const user = await mongoose.model('User').findById(userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  const index = user.pinnedSubjects.indexOf(subjectId);
  if (index > -1) {
    user.pinnedSubjects.splice(index, 1);
  } else {
    user.pinnedSubjects.push(subjectId);
  }

  await user.save();
  return user;
};
