import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/User.js';
import { Question } from '../models/Question.js';
import { ExamSession } from '../models/ExamSession.js';
import { Subject } from '../models/Subject.js';
import { Settings } from '../models/Settings.js';
import { PublicResponse } from '../models/PublicResponse.js';
import { AppError } from '../utils/AppError.js';
import { config } from '../config/env.js';

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

export const getPublicQuestion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const question = await Question.findOne({ _id: id, isShareable: true, isActive: true })
    .populate('subject', 'code title')
    .lean();

  if (!question) {
    throw new AppError(404, 'NOT_FOUND', 'Question not found or is not publicly available.');
  }

  // Safety: Strip correct answer and explanation for the initial view
  const { correctIndex, explanation, ...publicData } = question;
  res.json({ question: publicData });
});

export const submitPublicResponse = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { selectedOption } = req.body;

  if (selectedOption === undefined) {
    throw new AppError(400, 'INVALID_INPUT', 'selectedOption is required.');
  }

  const question = await Question.findOne({ _id: id, isShareable: true, isActive: true });
  if (!question) {
    throw new AppError(404, 'NOT_FOUND', 'Question not found.');
  }

  const isCorrect = question.correctIndex === selectedOption;

  await PublicResponse.create({
    question: id,
    selectedOption,
    isCorrect,
    metadata: {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
  });

  res.json({
    isCorrect,
    correctIndex: question.correctIndex,
    explanation: question.explanation,
  });
});

export const generateSharePage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const question = await Question.findOne({ _id: id, isShareable: true, isActive: true });

  if (!question) {
    return res.redirect(config.CLIENT_URL);
  }

  const title = question.shareTitle || 'TestFlow Question Challenge';
  // Strip LaTeX for the description to keep it readable in social apps
  const description = question.stem.replace(/\\\\\(|\\\\\)|\$|\\\\\[|\\\\\]/g, '').slice(0, 150) + '...';
  const shareUrl = `${config.CLIENT_URL}/question/${id}`;
  const imageUrl = 'https://ik.imagekit.io/oluwadaredaniel/testflow-share-card.png'; // Fallback to a branded card

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <meta property="og:title" content="${title}">
      <meta property="og:description" content="${description}">
      <meta property="og:image" content="${imageUrl}">
      <meta property="og:url" content="${shareUrl}">
      <meta property="og:type" content="website">
      <meta name="twitter:card" content="summary_large_image">
      <script>window.location.href = "${shareUrl}";</script>
    </head>
    <body>
      Redirecting to question...
    </body>
    </html>
  `);
});
