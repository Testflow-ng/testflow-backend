import { Subject } from '../models/Subject.js';
import { Question } from '../models/Question.js';
import { AppError } from '../utils/AppError.js';

/** List subjects (active by default), each annotated with its active question count. */
export const listSubjects = async ({ includeInactive = false } = {}) => {
  const filter = includeInactive ? {} : { isActive: true };
  const subjects = await Subject.find(filter).sort({ code: 1 });

  const counts = await Question.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$subject', count: { $sum: 1 } } },
  ]);
  const countBySubject = new Map(counts.map((entry) => [String(entry._id), entry.count]));

  return subjects.map((subject) => ({
    ...subject.toJSON(),
    questionCount: countBySubject.get(String(subject._id)) ?? 0,
  }));
};

export const getSubjectByCode = async (code) => {
  const subject = await Subject.findOne({ code: code.toUpperCase() });
  if (!subject) {
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
  return subject;
};

export const updateSubject = async (code, updates) => {
  const subject = await Subject.findOneAndUpdate({ code: code.toUpperCase() }, updates, {
    new: true,
    runValidators: true,
  });
  if (!subject) {
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
  return subject;
};
