import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/User.js';
import { Question } from '../models/Question.js';
import { ExamSession } from '../models/ExamSession.js';
import { Subject } from '../models/Subject.js';

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
