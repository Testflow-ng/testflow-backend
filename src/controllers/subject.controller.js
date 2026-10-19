import { asyncHandler } from '../middleware/asyncHandler.js';
import * as subjectService from '../services/subject.service.js';
import * as questionService from '../services/question.service.js';
import * as auditService from '../services/audit.service.js';

export const listSubjects = asyncHandler(async (req, res) => {
  const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
  const includeInactive = isAdmin && req.query.all === 'true';
  const { level, department } = req.query;

  const subjects = await subjectService.listSubjects({
    includeInactive,
    level,
    department
  });
  res.json({ subjects });
});

export const getSubject = asyncHandler(async (req, res) => {
  const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
  const subject = await subjectService.getSubjectByCode(req.params.code, { includeInactive: isAdmin });
  res.json({ subject });
});

export const listTopics = asyncHandler(async (req, res) => {
  const topics = await questionService.listSubjectTopics(req.params.id);
  res.json({ topics });
});

export const getLeaderboard = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { leaderboard, me } = await subjectService.getSubjectLeaderboard(id, req.user._id);
  res.json({ leaderboard, me });
});

/** GET /api/leaderboard — the Hall of Fame overall board. */
export const getOverallLeaderboard = asyncHandler(async (req, res) => {
  const { limit, level, period } = req.query;
  const { leaderboard, me } = await subjectService.getOverallLeaderboard(
    { limit, level, period },
    req.user._id,
  );
  res.json({ leaderboard, me });
});

export const togglePin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = await subjectService.togglePinSubject(req.user._id, id);
  res.json({ pinnedSubjects: user.pinnedSubjects });
});

export const deleteSubject = asyncHandler(async (req, res) => {
  const subject = await subjectService.getSubjectById(req.params.id);
  if (!subject) return res.status(204).send();

  await subjectService.deleteSubject(req.params.id);

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'DELETE_SUBJECT',
    targetId: req.params.id,
    targetType: 'Subject',
    metadata: { code: subject.code, title: subject.title },
    req
  });

  res.status(204).send();
});

export const createSubject = asyncHandler(async (req, res) => {
  const subject = await subjectService.createSubject(req.body);

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'CREATE_SUBJECT',
    targetId: subject._id,
    targetType: 'Subject',
    metadata: { code: subject.code, title: subject.title, level: subject.level },
    req
  });

  res.status(201).json({ subject });
});

export const updateSubject = asyncHandler(async (req, res) => {
  const subject = await subjectService.updateSubject(req.params.id, req.body);

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'UPDATE_SUBJECT',
    targetId: subject._id,
    targetType: 'Subject',
    metadata: { code: subject.code, updates: req.body },
    req
  });

  res.json({ subject });
});
