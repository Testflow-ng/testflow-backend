import { Question } from '../models/Question.js';
import { Subject } from '../models/Subject.js';
import { AppError } from '../utils/AppError.js';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/** Resolve a subject reference (ObjectId or code like "PHY102") to its ObjectId. */
const resolveSubjectId = async (subjectRef) => {
  if (OBJECT_ID.test(subjectRef)) {
    const byId = await Subject.findById(subjectRef);
    if (byId) return byId._id;
  }
  const byCode = await Subject.findOne({ code: String(subjectRef).toUpperCase() });
  if (!byCode) {
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
  return byCode._id;
};

export const createQuestion = async (data, adminId) => {
  const subject = await resolveSubjectId(data.subject);
  return Question.create({ ...data, subject, createdBy: adminId });
};

export const listQuestions = async ({ subject, difficulty, page = 1, limit = 20 }) => {
  const filter = {};
  if (subject) filter.subject = await resolveSubjectId(subject);
  if (difficulty) filter.difficulty = difficulty;

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Question.find(filter)
      .populate('subject', 'code title')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Question.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
};

export const getQuestion = async (id) => {
  const question = await Question.findById(id).populate('subject', 'code title');
  if (!question) {
    throw new AppError(404, 'QUESTION_NOT_FOUND', 'Question not found.');
  }
  return question;
};

export const updateQuestion = async (id, updates) => {
  const question = await Question.findById(id);
  if (!question) {
    throw new AppError(404, 'QUESTION_NOT_FOUND', 'Question not found.');
  }
  Object.assign(question, updates);
  await question.save(); // runs the correctIndex cross-field validation
  return question;
};

export const deleteQuestion = async (id) => {
  const question = await Question.findByIdAndDelete(id);
  if (!question) {
    throw new AppError(404, 'QUESTION_NOT_FOUND', 'Question not found.');
  }
};
