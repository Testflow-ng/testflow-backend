import { Question } from '../models/Question.js';

/**
 * The one question shape the study screens, the admin report queue and the public question card
 * all read.
 *
 * The bank stores the key as `correctIndex` because that is what the admin editor's form posts;
 * every read path outside the bank names it `correctOption`, matching the exam result payload the
 * corrections review already reads. The rename happens here, in the API layer, rather than in
 * each screen.
 */
export const toQuestionCard = (question) => ({
  id: String(question._id),
  subjectCode: question.subject?.code ?? null,
  stem: question.stem,
  options: question.options,
  correctOption: question.correctIndex,
  explanation: question.explanation ?? null,
  topic: question.topic ?? null,
});

/** Every question in a session and a result carries an id; this is the study side's loader. */
const WITH_SUBJECT = { path: 'subject', select: 'code' };

/**
 * Cards for a set of question ids, keyed by id.
 *
 * A Map rather than an array so a caller keeps its own ordering, and so a question that has since
 * been deleted is simply missing rather than shifting every row after it.
 */
export const loadQuestionCards = async (ids) => {
  const unique = [...new Set(ids.map(String))].filter((value) => value);
  if (!unique.length) return new Map();

  const rows = await Question.find({ _id: { $in: unique } }).populate(WITH_SUBJECT).lean();
  return new Map(rows.map((row) => [String(row._id), toQuestionCard(row)]));
};

/** One card, or null when the question is gone. Used where the row must survive a deleted question. */
export const loadQuestionCard = async (id) => (await loadQuestionCards([id])).get(String(id)) ?? null;

/**
 * The public view of a question.
 *
 * The answer key and the explanation are dropped rather than left for each caller to remember to
 * hide: a question link exists so the recipient tries the question, and a payload that carries
 * the key is one careless spread away from being a payload that reveals it.
 */
export const toPublicQuestionCard = (question) => {
  const card = toQuestionCard(question);
  delete card.correctOption;
  delete card.explanation;
  // The admin's own title for the link, when they wrote one. Not answer data, and the share page
  // is the only reader.
  card.shareTitle = question.shareTitle ?? null;
  return card;
};
