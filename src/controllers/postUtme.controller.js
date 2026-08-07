import { asyncHandler } from '../middleware/asyncHandler.js';
import * as postUtmeService from '../services/postUtmeSession.service.js';

export const startSession = asyncHandler(async (req, res) => {
  const session = await postUtmeService.startSession(req.user._id, req.body);
  res.status(201).json({ session });
});

export const saveAnswer = asyncHandler(async (req, res) => {
  const result = await postUtmeService.saveAnswer(req.user._id, req.params.id, req.body);
  res.json(result);
});

export const submitSession = asyncHandler(async (req, res) => {
  const session = await postUtmeService.submitSession(req.user._id, req.params.id);
  res.json({ session });
});

export const recordStrike = asyncHandler(async (req, res) => {
  const result = await postUtmeService.recordStrike(req.user._id, req.params.id);
  res.json(result);
});

export const getStats = asyncHandler(async (req, res) => {
  const stats = await postUtmeService.getStats(req.user._id);
  res.json({ stats });
});
