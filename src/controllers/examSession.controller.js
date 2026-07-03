import { asyncHandler } from '../middleware/asyncHandler.js';
import * as sessionService from '../services/examSession.service.js';

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

export const submitSession = asyncHandler(async (req, res) => {
  const result = await sessionService.submitSession(req.user._id, req.params.id);
  res.json({ result });
});

export const getResult = asyncHandler(async (req, res) => {
  const result = await sessionService.getResult(req.user._id, req.params.id);
  res.json({ result });
});

export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await sessionService.listSessions(req.user._id);
  res.json({ sessions });
});

export const getStats = asyncHandler(async (req, res) => {
  const stats = await sessionService.getStats(req.user._id);
  res.json({ stats });
});
