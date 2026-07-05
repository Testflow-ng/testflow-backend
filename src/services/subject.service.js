import { Subject } from '../models/Subject.js';
import { Question } from '../models/Question.js';
import { ExamSession } from '../models/ExamSession.js';
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
  // Cascading delete: Remove all questions and exam sessions associated with this subject.
  // This is irreversible and essential for data integrity.
  await Promise.all([
    Question.deleteMany({ subject: id }),
    ExamSession.deleteMany({ subject: id }),
  ]);

  const subject = await Subject.findByIdAndDelete(id);
  if (!subject) {
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
};

export const createSubject = async (data) => {
  return Subject.create(data);
};

export const updateSubject = async (id, updates) => {
  const subject = await Subject.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  });
  if (!subject) {
    throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }
  return subject;
};
