import { asyncHandler } from '../middleware/asyncHandler.js';
import { studentQuery } from '../utils/identity.js';
import { User } from '../models/User.js';
import { Question } from '../models/Question.js';
import { ExamSession } from '../models/ExamSession.js';
import { Subject } from '../models/Subject.js';
import { Settings } from '../models/Settings.js';
import { PublicResponse } from '../models/PublicResponse.js';
import { AppError } from '../utils/AppError.js';
import { config } from '../config/env.js';
import { requestOrigin } from '../utils/requestOrigin.js';
import { questionPageHtml } from '../utils/shareHtml.js';
import { toPublicQuestionCard } from '../services/questionCard.service.js';
import { questionCardPng } from '../services/ogImage.service.js';

const QUESTION_ID = /^[0-9a-fA-F]{24}$/;

/**
 * A shareable question by id, or null when there is none.
 *
 * The shape check comes first because Mongoose turns a malformed id into a CastError, and a typo
 * in a link should be a 404 rather than a server fault. `isShareable` and `isActive` are part of
 * the lookup, not a check after it: a question that has been unpublished is not public.
 */
const findShareableQuestion = async (id) =>
  QUESTION_ID.test(String(id))
    ? Question.findOne({ _id: id, isShareable: true, isActive: true })
        .populate('subject', 'code')
        .lean()
    : null;

export const getPublicStats = asyncHandler(async (req, res) => {
  const [questions, students, exams, subjects] = await Promise.all([
    Question.countDocuments({ isActive: true }),
    User.countDocuments(studentQuery()),
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
  const question = await findShareableQuestion(req.params.id);

  if (!question) {
    throw new AppError(404, 'NOT_FOUND', 'Question not found or is not publicly available.');
  }

  // Safety: the initial view is the card without its answer. The client reveals the key only
  // after the visitor has committed to one, which is the whole point of a challenge link.
  res.json({ question: toPublicQuestionCard(question) });
});

export const submitPublicResponse = asyncHandler(async (req, res) => {
  const selectedOption = Number(req.body?.selectedOption);

  if (!Number.isInteger(selectedOption) || selectedOption < 0) {
    throw new AppError(400, 'INVALID_INPUT', 'selectedOption is required.');
  }

  const question = await findShareableQuestion(req.params.id);
  if (!question) {
    throw new AppError(404, 'NOT_FOUND', 'Question not found.');
  }

  const isCorrect = question.correctIndex === selectedOption;

  await PublicResponse.create({
    question: req.params.id,
    selectedOption,
    isCorrect,
    metadata: {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
  });

  res.json({
    isCorrect,
    // Named the same as every other read path: the bank calls it `correctIndex`, the API does not.
    correctOption: question.correctIndex,
    explanation: question.explanation,
  });
});

/**
 * The share page for a question.
 *
 * A crawler does not run JavaScript, so this page is the preview: the tags have to be in the first
 * response, which is why nothing here is rendered by the app. A question that is not shareable is
 * a 404 rather than a redirect, because redirecting a crawler to the marketing site advertises a
 * link that does not resolve.
 */
export const generateSharePage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const question = await findShareableQuestion(id);

  if (!question) {
    throw new AppError(404, 'NOT_FOUND', 'Question not found or is not publicly available.');
  }

  const origin = requestOrigin(req);
  res
    .type('html')
    .set('Cache-Control', 'no-store')
    .send(
      questionPageHtml({
        question: toPublicQuestionCard(question),
        url: `${origin}${req.originalUrl}`,
        imageUrl: `${origin}/api/public/questions/${id}/og.png`,
        clientUrl: config.CLIENT_URL,
        appUrl: `${config.CLIENT_URL}/question/${id}`,
      }),
    );
});

/**
 * The question preview image, rendered rather than static.
 *
 * The old card was a generic TestFlow image, which told a reader nothing about the link. This one
 * carries the stem and the options, and never the answer: the recipient is meant to try it.
 */
export const getPublicQuestionCard = asyncHandler(async (req, res) => {
  const question = await findShareableQuestion(req.params.id);

  if (!question) {
    throw new AppError(404, 'NOT_FOUND', 'Question not found or is not publicly available.');
  }

  const png = await questionCardPng(toPublicQuestionCard(question));

  res
    .type('png')
    .set('Cache-Control', 'public, max-age=3600')
    .set('Cross-Origin-Resource-Policy', 'cross-origin')
    .send(png);
});

/**
 * Public Live CBT landing: title, host, instructions, live counts.
 * No auth required so a shared link always resolves; join itself requires auth.
 * Never exposes question content, answer keys, emails, or internal IDs.
 */
export const getLiveCbtLanding = asyncHandler(async (req, res) => {
  const { getLanding } = await import('../services/liveCbt.service.js');
  const landing = await getLanding(req.params.code);
  res.json({ exam: landing });
});
