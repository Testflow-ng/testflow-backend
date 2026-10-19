import { asyncHandler } from '../middleware/asyncHandler.js';
import * as bookmarkService from '../services/questionBookmark.service.js';

export const listBookmarks = asyncHandler(async (req, res) => {
  const bookmarks = await bookmarkService.listForStudent(req.user._id);
  res.json({ bookmarks });
});

/**
 * Toggle. The button does not know whether it is saving or unsaving, so neither does the client:
 * the answer carries the new state and the caller draws it.
 */
export const toggleBookmark = asyncHandler(async (req, res) => {
  const result = await bookmarkService.toggle({
    studentId: req.user._id,
    questionId: req.body.questionId,
  });
  res.json(result);
});

export const removeBookmark = asyncHandler(async (req, res) => {
  const result = await bookmarkService.remove({ studentId: req.user._id, id: req.params.id });
  res.json(result);
});
