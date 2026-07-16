import mongoose from 'mongoose';
import { Question } from '../models/Question.js';
import { Subject } from '../models/Subject.js';
import { AppError } from '../utils/AppError.js';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/** Resolve a subject reference (ObjectId or code like "PHY102") to its ObjectId. */
const resolveSubjectId = async (subjectRef, autoCreate = false) => {
  if (OBJECT_ID.test(subjectRef)) {
    // An id-shaped input is an id lookup; a miss is a hard 404 (don't reinterpret
    // a 24-char hex string as a subject code).
    const byId = await Subject.findById(subjectRef);
    if (!byId) {
      throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
    }
    return byId._id;
  }
  const code = String(subjectRef).toUpperCase();
  const byCode = await Subject.findOne({ code });

  if (!byCode) {
    if (autoCreate) {
      try {
        // Try to infer level from the first digit of the subject code (e.g., MTH101 -> 100)
        const match = code.match(/\d/);
        const level = match ? `${match[0]}00` : undefined;

        // Auto-create a placeholder subject so the bulk import doesn't fail.
        const newSubject = await Subject.create({
          code,
          title: `${code} Placeholder`,
          description: 'Created automatically via Bulk Import. Please update the title and description.',
          level,
          isActive: true
        });
        return newSubject._id;
      } catch (err) {
        // If we lost a race and it was created by a concurrent request, try fetching it one last time
        if (err.code === 11000) {
          const retry = await Subject.findOne({ code });
          if (retry) return retry._id;
        }
        throw err;
      }
    }
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
  return byCode._id;
};

export const createQuestion = async (data, adminId) => {
  const subject = await resolveSubjectId(data.subject);
  return Question.create({ ...data, subject, createdBy: adminId });
};

export const bulkCreateQuestions = async (questionsData, adminId) => {
  // Resolve subjects for all questions. Map of code/id -> ObjectId to avoid redundant DB calls.
  const subjectMap = new Map();
  const questions = [];

  for (const data of questionsData) {
    let subjectId = subjectMap.get(data.subject);
    if (!subjectId) {
      subjectId = await resolveSubjectId(data.subject, true); // Use autoCreate = true
      subjectMap.set(data.subject, subjectId);
    }
    questions.push({ ...data, subject: subjectId, createdBy: adminId });
  }

  return Question.insertMany(questions);
};

export const listQuestions = async ({ subject, difficulty, search, page = 1, limit = 20 }) => {
  const filter = {};
  if (subject) filter.subject = await resolveSubjectId(subject);
  if (difficulty) filter.difficulty = difficulty;
  if (search) {
    // Basic text search on the stem.
    filter.stem = { $regex: search, $options: 'i' };
  }

  const total = await Question.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages); // avoid runaway skip past the last page
  const items = await Question.find(filter)
    .populate('subject', 'code title')
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * limit)
    .limit(limit);

  return { items, total, page: safePage, limit, pages };
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

export const listSubjectTopics = async (subjectId) => {
  const aggregated = await Question.aggregate([
    {
      $match: {
        subject: new mongoose.Types.ObjectId(subjectId),
        isActive: true
      }
    },
    {
      $group: {
        _id: {
          topicId: '$topicId',
          topic: '$topic',
          subtopic: '$subtopic'
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: {
          topicId: '$_id.topicId',
          topic: '$_id.topic'
        },
        subtopics: {
          $push: {
            name: '$_id.subtopic',
            count: '$count'
          }
        },
        totalCount: { $sum: '$count' }
      }
    },
    { $sort: { '_id.topicId': 1 } }
  ]);

  return aggregated.map(t => ({
    id: t._id.topicId || 'T-OTHERS',
    name: t._id.topic || 'General Material',
    totalQuestions: t.totalCount,
    subtopics: t.subtopics
      .filter(st => st.name)
      .sort((a, b) => a.name.localeCompare(b.name))
  }));
};
