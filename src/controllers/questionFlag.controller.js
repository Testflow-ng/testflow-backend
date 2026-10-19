import { asyncHandler } from '../middleware/asyncHandler.js';
import * as flagService from '../services/questionFlag.service.js';

/**
 * Report a question, or update the report this student already has.
 *
 * The service owns the shape it answers with, because the same row is read back by the admin
 * queue and the two must agree about what a report looks like.
 */
export const reportQuestion = asyncHandler(async (req, res) => {
  const flag = await flagService.reportQuestion({
    studentId: req.user._id,
    questionId: req.params.id,
    reason: req.body.reason,
    note: req.body.note,
  });

  res.status(201).json({ flag });
});
