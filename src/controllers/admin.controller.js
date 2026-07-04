import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/User.js';
import { Subject } from '../models/Subject.js';
import { Question } from '../models/Question.js';
import { ExamSession } from '../models/ExamSession.js';
import * as auditService from '../services/audit.service.js';
import { AppError } from '../utils/AppError.js';

export const getDashboardStats = asyncHandler(async (req, res) => {
  const [
    totalStudents,
    totalAdmins,
    totalSubjects,
    totalQuestions,
    totalSessions,
    completedSessions,
    recentUsers,
    activeSessionsCount
  ] = await Promise.all([
    User.countDocuments({ role: 'student' }),
    User.countDocuments({ role: 'admin' }),
    Subject.countDocuments(),
    Question.countDocuments(),
    ExamSession.countDocuments(),
    ExamSession.countDocuments({ status: 'submitted' }),
    User.find({ role: 'student' }).sort({ createdAt: -1 }).limit(5),
    // Sessions started in the last hour and still in progress
    ExamSession.countDocuments({
      status: 'in_progress',
      createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) }
    })
  ]);

  res.json({
    stats: {
      users: {
        total: totalStudents + totalAdmins,
        students: totalStudents,
        admins: totalAdmins
      },
      content: {
        subjects: totalSubjects,
        questions: totalQuestions
      },
      usage: {
        totalSessions,
        completedSessions,
        activeNow: activeSessionsCount
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
