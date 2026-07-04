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

export const getSubjectByCode = async (code, { includeInactive = false } = {}) => {
  const filter = { code: code.toUpperCase() };
  if (!includeInactive) filter.isActive = true;
  const subject = await Subject.findOne(filter);
  if (!subject) {
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
  return subject;
};

export const deleteSubject = async (id) => {
  const subject = await Subject.findByIdAndDelete(id);
  if (!subject) {
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
};

export const createSubject = async (data) => {
  return Subject.create(data);
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
