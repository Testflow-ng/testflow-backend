import mongoose from 'mongoose';
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
  // Cascading delete for questions only.
  // We preserve ExamSessions (student history) even if the subject is removed,
  // as the sessions store the subjectCode for display purposes.
  await Question.deleteMany({ subject: id });

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

export const getSubjectLeaderboard = async (subjectId) => {
  const leaderboard = await ExamSession.aggregate([
    {
      $match: {
        subject: new mongoose.Types.ObjectId(subjectId),
        status: 'submitted'
      }
    },
    {
      $sort: { score: -1, totalQuestions: -1, timeTakenSeconds: 1, submittedAt: 1 }
    },
    {
      $group: {
        _id: '$student',
        bestScore: { $first: '$score' },
        totalQuestions: { $first: '$totalQuestions' },
        timeTakenSeconds: { $first: '$timeTakenSeconds' },
        date: { $first: '$submittedAt' }
      }
    },
    { $sort: { bestScore: -1, totalQuestions: -1, timeTakenSeconds: 1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'studentInfo'
      }
    },
    { $unwind: '$studentInfo' },
    // Filter out users who opted out of the leaderboard
    { $match: { 'studentInfo.showOnLeaderboard': { $ne: false } } },
    {
      $project: {
        _id: 0,
        username: '$studentInfo.username',
        fullName: '$studentInfo.fullName',
        score: '$bestScore',
        totalQuestions: 1,
        timeTakenSeconds: 1,
        date: 1
      }
    }
  ]);

  return leaderboard;
};

export const togglePinSubject = async (userId, subjectId) => {
  const user = await mongoose.model('User').findById(userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  const index = user.pinnedSubjects.indexOf(subjectId);
  if (index > -1) {
    user.pinnedSubjects.splice(index, 1);
  } else {
    user.pinnedSubjects.push(subjectId);
  }

  await user.save();
  return user;
};
