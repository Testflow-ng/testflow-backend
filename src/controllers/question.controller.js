import { asyncHandler } from '../middleware/asyncHandler.js';
import * as questionService from '../services/question.service.js';
import * as auditService from '../services/audit.service.js';

export const createQuestion = asyncHandler(async (req, res) => {
  const question = await questionService.createQuestion(req.body, req.user._id);
  res.status(201).json({ question });
});

export const bulkCreateQuestions = asyncHandler(async (req, res) => {
  const questions = await questionService.bulkCreateQuestions(req.body, req.user._id);

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'BULK_IMPORT',
    metadata: { count: questions.length },
    req
  });

  res.status(201).json({ count: questions.length });
});

export const listQuestions = asyncHandler(async (req, res) => {
  const result = await questionService.listQuestions(req.query);
  res.json(result);
});

export const getQuestion = asyncHandler(async (req, res) => {
  const question = await questionService.getQuestion(req.params.id);
  res.json({ question });
});

export const updateQuestion = asyncHandler(async (req, res) => {
  const question = await questionService.updateQuestion(req.params.id, req.body);
  res.json({ question });
});

export const deleteQuestion = asyncHandler(async (req, res) => {
  await questionService.deleteQuestion(req.params.id);

  await auditService.recordAction({
    actorId: req.user._id,
    action: 'DELETE_QUESTION',
    targetId: req.params.id,
    targetType: 'Question',
    req
  });

  res.status(204).send();
});
