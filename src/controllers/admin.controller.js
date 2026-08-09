import { User } from '../models/User.js';
import { Subject } from '../models/Subject.js';
import { Question } from '../models/Question.js';
import { ExamSession } from '../models/ExamSession.js';
import { Settings } from '../models/Settings.js';
import { AuditLog } from '../models/AuditLog.js';
import { PublicResponse } from '../models/PublicResponse.js';
import * as auditService from '../services/audit.service.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import mongoose from 'mongoose';

export const getDashboardStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const todayStart = new Date(now.setHours(0, 0, 0, 0));
  const yesterdayStart = new Date(new Date(todayStart).setDate(todayStart.getDate() - 1));
  const weekAgoStart = new Date(new Date(todayStart).setDate(todayStart.getDate() - 7));
  const prevWeekAgoStart = new Date(new Date(weekAgoStart).setDate(weekAgoStart.getDate() - 7));
  const monthAgoStart = new Date(new Date(todayStart).setMonth(todayStart.getMonth() - 1));
  const prevMonthAgoStart = new Date(new Date(monthAgoStart).setMonth(monthAgoStart.getMonth() - 1));

  const [
    totalStudents,
    totalAdmins,
    totalPostUtmePaid,
    totalSubjects,
    totalQuestions,
    totalSessions,
    completedSessions,
    recentUsers,
    activeSessionsCount,
    avgScoreResult,
    topSubjectResult,
    levelStats,
    dau,
    wau,
    mau,
    newStudentsToday,
    newStudentsYesterday,
    newStudentsWeek,
    newStudentsPrevWeek,
    newStudentsMonth,
    newStudentsPrevMonth
  ] = await Promise.all([
    User.countDocuments({ role: 'student' }),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ role: 'student', isPostUtmePaid: true }),
    Subject.countDocuments(),
    Question.countDocuments(),
    ExamSession.countDocuments(),
    ExamSession.countDocuments({ status: 'submitted' }),
    User.find({ role: 'student' }).sort({ createdAt: -1 }).limit(5).lean(),
    // Sessions started in the last hour and still in progress
    ExamSession.countDocuments({
      status: 'in_progress',
      createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) }
    }),
    ExamSession.aggregate([
      { $match: { status: 'submitted' } },
      { $group: { _id: null, avg: { $avg: '$score' } } }
    ]),
    ExamSession.aggregate([
      { $group: { _id: '$subjectCode', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]),
    Subject.aggregate([
      { $group: { _id: '$level', count: { $sum: 1 } } }
    ]),
    User.countDocuments({ role: 'student', lastActiveAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    User.countDocuments({ role: 'student', lastActiveAt: { $gt: weekAgoStart } }),
    User.countDocuments({ role: 'student', lastActiveAt: { $gt: monthAgoStart } }),

    // Growth metrics
    User.countDocuments({ role: 'student', createdAt: { $gte: todayStart } }),
    User.countDocuments({ role: 'student', createdAt: { $gte: yesterdayStart, $lt: todayStart } }),
    User.countDocuments({ role: 'student', createdAt: { $gte: weekAgoStart } }),
    User.countDocuments({ role: 'student', createdAt: { $gte: prevWeekAgoStart, $lt: weekAgoStart } }),
    User.countDocuments({ role: 'student', createdAt: { $gte: monthAgoStart } }),
    User.countDocuments({ role: 'student', createdAt: { $gte: prevMonthAgoStart, $lt: monthAgoStart } })
  ]);

  const calculateGrowth = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  res.json({
    stats: {
      users: {
        total: totalStudents + totalAdmins,
        students: totalStudents,
        postUtmePaid: totalPostUtmePaid,
        uniStudents: totalStudents - totalPostUtmePaid,
        admins: totalAdmins,
        activity: {
          daily: dau,
          weekly: wau,
          monthly: mau
        },
        growth: {
          today: newStudentsToday,
          yesterday: newStudentsYesterday,
          todayPercent: calculateGrowth(newStudentsToday, newStudentsYesterday),

          week: newStudentsWeek,
          prevWeek: newStudentsPrevWeek,
          weekPercent: calculateGrowth(newStudentsWeek, newStudentsPrevWeek),

          month: newStudentsMonth,
          prevMonth: newStudentsPrevMonth,
          monthPercent: calculateGrowth(newStudentsMonth, newStudentsPrevMonth)
        }
      },
      content: {
        subjects: totalSubjects,
        questions: totalQuestions,
        levels: levelStats.reduce((acc, curr) => ({ ...acc, [curr._id || 'Unleveled']: curr.count }), {})
      },
      usage: {
        totalSessions,
        completedSessions,
        activeNow: activeSessionsCount,
        averageScore: avgScoreResult[0]?.avg ? Math.round(avgScoreResult[0].avg) : 0,
        topSubject: topSubjectResult[0]?._id || 'N/A'
      }
    },
    recentUsers
  });
});

export const listStudents = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const filter = { role: 'student' };

  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { matricNumber: { $regex: search, $options: 'i' } }
    ];
  }

  const total = await User.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages);

  const items = await User.find(filter)
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * limit)
    .limit(limit);

  res.json({ items, total, page: safePage, limit, pages });
});

export const createStudent = asyncHandler(async (req, res) => {
  const { fullName, email, matricNumber, password } = req.body;

  const existing = await User.findOne({
    $or: [{ email }, { matricNumber: matricNumber || undefined }]
  });

  if (existing) {
    throw new AppError(409, 'CONFLICT', 'User with this email or matric number already exists.');
  }

  const user = await User.create({
    fullName,
    email,
    matricNumber,
    passwordHash: password,
    role: 'student',
    isEmailVerified: true
  });

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'CREATE_STUDENT',
    targetId: user._id,
    targetType: 'User',
    req
  });

  res.status(201).json({ user });
});

export const createAdmin = asyncHandler(async (req, res) => {
  const { fullName, email, password } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    throw new AppError(409, 'CONFLICT', 'User with this email already exists.');
  }

  const user = await User.create({
    fullName,
    email,
    passwordHash: password,
    role: 'admin',
    isEmailVerified: true // Admins created by super admin are verified by default
  });

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'CREATE_ADMIN',
    targetId: user._id,
    targetType: 'User',
    req
  });

  res.status(201).json({ user });
});

export const listAdmins = asyncHandler(async (req, res) => {
  const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).sort({ role: 1, fullName: 1 });
  res.json({ admins });
});

export const promoteToAdmin = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    throw new AppError(400, 'INVALID_INPUT', 'Email is required.');
  }

  const user = await User.findOne({ email });
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found with that email.');
  }

  if (user.role !== 'student') {
    throw new AppError(400, 'ALREADY_STAFF', 'This user is already an admin or super admin.');
  }

  user.role = 'admin';
  user.tokenVersion = (user.tokenVersion ?? 0) + 1; // force logout to pick up new role
  await user.save();

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'PROMOTE_ADMIN',
    targetId: user._id,
    targetType: 'User',
    metadata: { email: user.email },
    req
  });

  res.json({ user });
});

export const demoteAdmin = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  if (user.role === 'super_admin') {
    throw new AppError(403, 'FORBIDDEN', 'Super Admins cannot be demoted.');
  }

  user.role = 'student';
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'DEMOTE_ADMIN',
    targetId: user._id,
    targetType: 'User',
    metadata: { email: user.email },
    req
  });

  res.json({ user });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  if (user.role === 'super_admin') {
    throw new AppError(403, 'FORBIDDEN', 'Super Admins cannot be deleted.');
  }

  // Also cleanup their exam sessions
  await ExamSession.deleteMany({ student: user._id });
  await User.findByIdAndDelete(req.params.id);

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'DELETE_USER',
    targetId: user._id,
    targetType: 'User',
    metadata: { email: user.email, role: user.role },
    req
  });

  res.status(204).send();
});

export const resetUserPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password) {
    throw new AppError(400, 'INVALID_INPUT', 'Password is required.');
  }

  const user = await User.findById(req.params.id).select('+tokenVersion');
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  user.passwordHash = password; // pre-save hook hashes it
  user.tokenVersion = (user.tokenVersion ?? 0) + 1; // invalidate all sessions
  await user.save();

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'RESET_PASSWORD',
    targetId: user._id,
    targetType: 'User',
    req
  });

  res.json({ message: 'Password reset successfully.' });
});

export const toggleUserStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  user.isEmailVerified = !user.isEmailVerified; // We'll use this as an active/inactive toggle
  await user.save();

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'TOGGLE_USER_STATUS',
    targetId: user._id,
    targetType: 'User',
    metadata: { status: user.isEmailVerified ? 'active' : 'suspended' },
    req
  });

  res.json({ user });
});

export const verifyPostUtme = asyncHandler(async (req, res) => {
  const { verificationCode } = req.body;
  if (!verificationCode) {
    throw new AppError(400, 'INVALID_INPUT', 'Verification code is required.');
  }

  const user = await User.findOne({ verificationCode: verificationCode.toUpperCase() });
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'No user found with this verification code.');
  }

  if (user.isPostUtmePaid) {
    throw new AppError(400, 'ALREADY_PAID', 'This user is already verified for Post-UTME.');
  }

  user.isPostUtmePaid = true;
  await user.save();

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'VERIFY_POST_UTME',
    targetId: user._id,
    targetType: 'User',
    metadata: { code: verificationCode, email: user.email },
    req
  });

  res.json({ user });
});

export const getSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getInstance();
  res.json({ settings });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getInstance();
  Object.assign(settings, req.body);
  await settings.save();

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'UPDATE_SETTINGS',
    targetId: settings._id,
    targetType: 'Settings',
    metadata: req.body,
    req
  });

  res.json({ settings });
});

export const exportResults = asyncHandler(async (req, res) => {
  const sessions = await ExamSession.find({ status: 'submitted' })
    .populate('student', 'fullName email matricNumber')
    .sort({ submittedAt: -1 });

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'EXPORT_RESULTS',
    req
  });

  const rows = [
    ['Full Name', 'Email', 'Matric Number', 'Subject', 'Score (%)', 'Correct', 'Total', 'Date'],
    ...sessions.map(s => [
      s.student?.fullName || 'Unknown',
      s.student?.email || 'N/A',
      s.student?.matricNumber || 'N/A',
      s.subjectCode,
      s.score,
      s.correctCount,
      s.totalQuestions,
      s.submittedAt?.toISOString()
    ])
  ];

  const csv = rows.map(r => r.join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=testflow-results.csv');
  res.status(200).send(csv);
});

export const getPostUtmeRankings = asyncHandler(async (req, res) => {
  const { limit = 100 } = req.query;

  const rankings = await User.aggregate([
    { $match: { role: 'student' } },
    {
      $lookup: {
        from: 'examsessions',
        let: { userId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$student', '$$userId'] },
                  { $eq: ['$status', 'submitted'] }
                ]
              }
            }
          }
        ],
        as: 'mockSessions'
      }
    },
    {
      $addFields: {
        avgMockScore: {
          $cond: {
            if: { $gt: [{ $size: '$mockSessions' }, 0] },
            then: { $avg: '$mockSessions.score' },
            else: 0
          }
        },
        jambScore: { $ifNull: ['$utmeData.jambScore', 0] },
        oLevelPoints: { $ifNull: ['$utmeData.oLevelPoints', 0] }
      }
    },
    {
      $addFields: {
        aggregate: {
          $add: [
            { $divide: ['$jambScore', 8] },
            '$oLevelPoints',
            '$avgMockScore'
          ]
        }
      }
    },
    { $sort: { aggregate: -1 } },
    { $limit: parseInt(limit, 10) },
    {
      $project: {
        fullName: 1,
        email: 1,
        username: 1,
        jambScore: 1,
        oLevelPoints: 1,
        avgMockScore: 1,
        aggregate: 1,
        isPostUtmePaid: 1
      }
    }
  ]);

  res.json({ rankings });
});

export const getActivityFeed = asyncHandler(async (req, res) => {
  const { limit = 20 } = req.query;
  const logs = await AuditLog.find()
    .sort({ createdAt: -1 })
    .limit(parseInt(limit, 10))
    .populate('actor', 'fullName')
    .lean();

  res.json({ logs });
});

export const bulkDeleteQuestions = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError(400, 'INVALID_INPUT', 'List of question IDs is required.');
  }

  const result = await Question.deleteMany({ _id: { $in: ids } });

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'BULK_DELETE_QUESTIONS',
    metadata: { count: result.deletedCount, ids },
    req
  });

  res.json({ message: `Successfully deleted ${result.deletedCount} questions.` });
});

export const bulkToggleQuestions = asyncHandler(async (req, res) => {
  const { ids, isActive } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError(400, 'INVALID_INPUT', 'List of question IDs is required.');
  }

  const result = await Question.updateMany(
    { _id: { $in: ids } },
    { $set: { isActive: !!isActive } }
  );

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'BULK_TOGGLE_QUESTIONS',
    metadata: { count: result.modifiedCount, isActive, ids },
    req
  });

  res.json({ message: `Successfully updated ${result.modifiedCount} questions.` });
});

export const getQuestionAnalytics = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [totalResponses, optionStats, accuracyStats] = await Promise.all([
    PublicResponse.countDocuments({ question: id }),
    PublicResponse.aggregate([
      { $match: { question: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$selectedOption', count: { $sum: 1 } } }
    ]),
    PublicResponse.aggregate([
      { $match: { question: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$isCorrect', count: { $sum: 1 } } }
    ])
  ]);

  res.json({
    total: totalResponses,
    options: optionStats,
    accuracy: accuracyStats
  });
});
