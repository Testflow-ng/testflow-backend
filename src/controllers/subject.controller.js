import { asyncHandler } from '../middleware/asyncHandler.js';
import * as subjectService from '../services/subject.service.js';
import * as auditService from '../services/audit.service.js';

export const listSubjects = asyncHandler(async (req, res) => {
  const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
  const includeInactive = isAdmin && req.query.all === 'true';
  const subjects = await subjectService.listSubjects({ includeInactive });
  res.json({ subjects });
});

export const getSubject = asyncHandler(async (req, res) => {
  const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
  const subject = await subjectService.getSubjectByCode(req.params.code, { includeInactive: isAdmin });
  res.json({ subject });
});

export const deleteSubject = asyncHandler(async (req, res) => {
  await subjectService.deleteSubject(req.params.id);
  res.status(204).send();
});

export const createSubject = asyncHandler(async (req, res) => {
  const subject = await subjectService.createSubject(req.body);
  res.status(201).json({ subject });
});

export const updateSubject = asyncHandler(async (req, res) => {
  const subject = await subjectService.updateSubject(req.params.code, req.body);

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

export const deleteSubject = asyncHandler(async (req, res) => {
  await subjectService.deleteSubject(req.params.id);
  res.status(204).send();
});
