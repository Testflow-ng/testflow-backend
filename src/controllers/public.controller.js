import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/User.js';
import { Question } from '../models/Question.js';
import { ExamSession } from '../models/ExamSession.js';
import { Subject } from '../models/Subject.js';
import { Settings } from '../models/Settings.js';

export const getPublicStats = asyncHandler(async (req, res) => {
  const [questions, students, exams, subjects] = await Promise.all([
    Question.countDocuments({ isActive: true }),
    User.countDocuments({ role: 'student' }),
    ExamSession.countDocuments({ status: 'submitted' }),
    Subject.countDocuments({ isActive: true })
  ]);

  res.json({
    totalQuestions: questions,
    totalStudents: students,
    totalExams: exams,
    totalSubjects: subjects
  });
});

export const getConfig = asyncHandler(async (req, res) => {
  const settings = await Settings.getInstance();
  res.json({
    isPostUtmeActive: settings.isPostUtmeActive,
    postUtmePrice: settings.postUtmePrice,
    paymentInfo: {
      accountNumber: settings.paymentAccountNumber,
      bankName: settings.paymentBankName,
      accountName: settings.paymentAccountName
    }
  });
});
