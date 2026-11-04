import { QuestionFlag, FLAG_STATUSES } from '../models/QuestionFlag.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { loadQuestionCard, loadQuestionCards } from './questionCard.service.js';

/**
 * Reporting a question, and the queue that works the reports.
 *
 * The two jobs here pull in opposite directions on purpose. A report is written by one student
 * about one question and must never inflate: reporting twice updates the row, so `reportCount`
 * counts students rather than taps. The queue is read by an admin who has to judge the claim
 * without opening the bank, so it carries the question, the marked answer and the explanation,
 * and the counts describe the whole queue rather than the filter in front of it.
 */

const identityOf = (user) => ({
  fullName: user?.fullName ?? null,
  username: user?.username ?? null,
  matricNumber: user?.matricNumber ?? null,
});

const toView = ({ flag, question, reportCount }) => ({
  id: String(flag._id),
  questionId: String(flag.question),
  reason: flag.reason,
  note: flag.note ?? '',
  status: flag.status,
  createdAt: flag.createdAt,
  // Present once decided. Kept when a report is reopened, so the next admin reads the reasoning.
  resolution: flag.resolution ?? '',
  reportCount,
  // The reporter as they were at report time, not as their profile reads now.
  student: identityOf(flag.reporter),
  question: question ?? null,
});

/**
 * Report a question, or update the report this student already has.
 *
 * A student who reports the same question again is correcting themselves, not adding evidence, so
 * the upsert rides the `{ question, student }` unique index and the reporter snapshot is written
 * once, on insert.
 */
export const reportQuestion = async ({ studentId, questionId, reason, note }) => {
  const question = await loadQuestionCard(questionId);
  if (!question) {
    throw new AppError(404, 'QUESTION_NOT_FOUND', 'That question no longer exists.');
  }

  const text = String(note ?? '').trim();
  if (reason === 'other' && !text) {
    throw new AppError(422, 'NOTE_REQUIRED', 'Tell us what is wrong in the note.');
  }

  const student = await User.findById(studentId).select('fullName username matricNumber').lean();

  const flag = await QuestionFlag.findOneAndUpdate(
    { question: questionId, student: studentId },
    {
      $set: { reason, note: text },
      $setOnInsert: { reporter: identityOf(student) },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const reportCount = await QuestionFlag.countDocuments({ question: questionId });
  return toView({ flag, question, reportCount });
};

/**
 * The queue, whole.
 *
 * The screen filters open/resolved/dismissed client-side, so this returns every report with the
 * counts and lets one request draw both the list and the filter labels. `questionCount` is the
 * number of distinct questions ever reported, which is the number an admin can act on.
 */
export const listForAdmin = async ({ limit = 500 } = {}) => {
  const [flags, byStatus, byQuestion] = await Promise.all([
    QuestionFlag.find().sort({ createdAt: -1 }).limit(limit).lean(),
    QuestionFlag.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    QuestionFlag.aggregate([{ $group: { _id: '$question', count: { $sum: 1 } } }]),
  ]);

  const cards = await loadQuestionCards(flags.map((flag) => flag.question));
  const statusCounts = new Map(byStatus.map((entry) => [entry._id, entry.count]));
  const reportCounts = new Map(byQuestion.map((entry) => [String(entry._id), entry.count]));

  return {
    flags: flags.map((flag) =>
      toView({
        flag,
        question: cards.get(String(flag.question)) ?? null,
        reportCount: reportCounts.get(String(flag.question)) ?? 0,
      }),
    ),
    counts: {
      open: statusCounts.get('open') ?? 0,
      resolved: statusCounts.get('resolved') ?? 0,
      dismissed: statusCounts.get('dismissed') ?? 0,
      questionCount: byQuestion.length,
    },
  };
};

/**
 * Decide a report.
 *
 * `resolved` and `dismissed` stay distinct: one means the bank was changed, the other means the
 * question was fine, and the next admin reads that difference. Reopening clears the decision
 * bookkeeping but keeps the note, because the note is usually why it was reopened.
 */
export const resolveForAdmin = async (id, { status, resolution }, actorId) => {
  if (!FLAG_STATUSES.includes(status)) {
    throw new AppError(422, 'INVALID_STATUS', `Status must be one of: ${FLAG_STATUSES.join(', ')}.`);
  }

  const flag = await QuestionFlag.findById(id);
  if (!flag) {
    throw new AppError(404, 'FLAG_NOT_FOUND', 'That report no longer exists.');
  }

  flag.status = status;
  if (resolution !== undefined) {
    flag.resolution = String(resolution ?? '').trim();
  }
  if (status === 'open') {
    flag.resolvedBy = null;
    flag.resolvedAt = null;
  } else {
    flag.resolvedBy = actorId;
    flag.resolvedAt = new Date();
  }

  await flag.save();

  const question = await loadQuestionCard(flag.question);
  const reportCount = await QuestionFlag.countDocuments({ question: flag.question });
  return toView({ flag, question, reportCount });
};
