import { asyncHandler } from '../middleware/asyncHandler.js';
import * as sessionService from '../services/examSession.service.js';
import { mintShare } from '../services/resultShare.service.js';
import { requestOrigin } from '../utils/requestOrigin.js';

export const startSession = asyncHandler(async (req, res) => {
  const session = await sessionService.startSession(req.user._id, req.body);
  res.status(201).json({ session });
});

export const getSession = asyncHandler(async (req, res) => {
  const session = await sessionService.getSession(req.user._id, req.params.id);
  res.json({ session });
});

export const saveAnswer = asyncHandler(async (req, res) => {
  const answer = await sessionService.saveAnswer(req.user._id, req.params.id, req.body);
  res.json({ answer });
});

export const recordStrike = asyncHandler(async (req, res) => {
  const result = await sessionService.recordStrike(req.user._id, req.params.id);
  res.json({ result });
});

export const submitSession = asyncHandler(async (req, res) => {
  const result = await sessionService.submitSession(req.user._id, req.params.id);
  res.json({ result });
});

export const getResult = asyncHandler(async (req, res) => {
  const result = await sessionService.getResult(req.user._id, req.params.id);
  res.json({ result });
});

/**
 * The public link for a finished attempt.
 *
 * The origin comes off the request rather than config, because the link has to point at the host
 * the student is actually using.
 */
export const shareSession = asyncHandler(async (req, res) => {
  const share = await mintShare(req.user._id, req.params.id, requestOrigin(req));
  res.json({ share });
});

export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await sessionService.listSessions(req.user._id);
  res.json({ sessions });
});

export const getStats = asyncHandler(async (req, res) => {
  const stats = await sessionService.getStats(req.user._id);
  res.json({ stats });
});
