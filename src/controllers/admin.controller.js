import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/User.js';
import { Subject } from '../models/Subject.js';
import { Question } from '../models/Question.js';
import { ExamSession } from '../models/ExamSession.js';

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
