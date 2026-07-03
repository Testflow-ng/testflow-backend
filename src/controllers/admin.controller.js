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
