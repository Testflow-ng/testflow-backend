import { Question } from '../models/Question.js';
import { QuestionBookmark } from '../models/QuestionBookmark.js';
import { AppError } from '../utils/AppError.js';
import { loadQuestionCards } from './questionCard.service.js';

/**
 * Saved questions.
 *
 * A bookmark outlives the attempt it came from and comes back with its answer and explanation,
 * because a study list without the answer key is a list of things to re-answer blind. A question
 * that has since been deleted answers with `question: null` instead of dropping the row: the
 * screen says so, which is better than an entry that silently disappears.
 */

const toView = (row, cards) => ({
  id: String(row._id),
  questionId: String(row.question),
  createdAt: row.createdAt,
  question: cards.get(String(row.question)) ?? null,
});

export const listForStudent = async (studentId, { limit = 500 } = {}) => {
  const rows = await QuestionBookmark.find({ student: studentId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  if (!rows.length) return [];
  const cards = await loadQuestionCards(rows.map((row) => row.question));
  return rows.map((row) => toView(row, cards));
};

/**
 * Toggle by question id, so the button on a question never has to know whether it is saving or
 * unsaving: the server is the one place that knows, and it answers with the new state.
 *
 * Two taps racing are harmless. The unique index means the second insert fails, which is the
 * correct outcome: the question is saved either way, and that is what the answer says.
 */
export const toggle = async ({ studentId, questionId }) => {
  const exists = await Question.exists({ _id: questionId });
  if (!exists) {
    throw new AppError(404, 'QUESTION_NOT_FOUND', 'That question no longer exists.');
  }

  const removed = await QuestionBookmark.findOneAndDelete({ student: studentId, question: questionId });
  if (removed) return { questionId, bookmarked: false };

  try {
    await QuestionBookmark.create({ student: studentId, question: questionId });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  return { questionId, bookmarked: true };
};

/** The explicit removal, for taking a row out of the list. */
export const remove = async ({ studentId, id }) => {
  const removed = await QuestionBookmark.findOneAndDelete({ _id: id, student: studentId });
  if (!removed) {
    throw new AppError(404, 'BOOKMARK_NOT_FOUND', 'That saved question is no longer there.');
  }
  return { id, bookmarked: false };
};
