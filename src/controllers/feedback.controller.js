import { asyncHandler } from '../middleware/asyncHandler.js';
import * as feedbackService from '../services/feedback.service.js';

/**
 * Student-facing feedback. The author is always the authenticated user: `student` is not a
 * request field, and the validator would reject it if it were.
 */
export const listFeedback = asyncHandler(async (req, res) => {
  const feedback = await feedbackService.listForStudent(req.user._id);
  res.json({ feedback });
});

export const createFeedback = asyncHandler(async (req, res) => {
  const { kind, rating, screen, message } = req.body;
  const feedback = await feedbackService.createFeedback({
    student: req.user._id,
    kind,
    rating,
    screen,
    message,
  });
  res.status(201).json({ feedback });
});
