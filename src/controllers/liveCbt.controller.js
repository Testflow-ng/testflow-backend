import { asyncHandler } from '../middleware/asyncHandler.js';
import * as liveCbt from '../services/liveCbt.service.js';

export const createExam = asyncHandler(async (req, res) => {
  const exam = await liveCbt.createExam(req.user._id, req.body);
  res.status(201).json({ exam });
});

export const myMembership = asyncHandler(async (req, res) => {
  const room = await liveCbt.myMembership(req.user._id, req.params.code);
  res.json({ room });
});

export const hostRoom = asyncHandler(async (req, res) => {
  const room = await liveCbt.hostRoom(req.user._id, req.params.code);
  res.json({ room });
});

export const requestJoin = asyncHandler(async (req, res) => {
  const result = await liveCbt.requestJoin(req.user._id, req.params.code);
  res.status(result.duplicate ? 200 : 201).json(result);
});

export const approveParticipant = asyncHandler(async (req, res) => {
  const result = await liveCbt.approveParticipant(req.user._id, req.params.code, req.body.userId);
  res.json(result);
});

export const rejectParticipant = asyncHandler(async (req, res) => {
  const result = await liveCbt.rejectParticipant(req.user._id, req.params.code, req.body.userId);
  res.json(result);
});

export const approveAll = asyncHandler(async (req, res) => {
  const result = await liveCbt.approveAll(req.user._id, req.params.code);
  res.json(result);
});

export const startExam = asyncHandler(async (req, res) => {
  const exam = await liveCbt.startExam(req.user._id, req.params.code);
  res.json({ exam });
});

export const endExam = asyncHandler(async (req, res) => {
  const exam = await liveCbt.endExam(req.user._id, req.params.code);
  res.json({ exam });
});

export const publishResults = asyncHandler(async (req, res) => {
  const exam = await liveCbt.publishResults(req.user._id, req.params.code);
  res.json({ exam });
});

export const cancelExam = asyncHandler(async (req, res) => {
  const exam = await liveCbt.cancelExam(req.user._id, req.params.code);
  res.json({ exam });
});

export const getQuestions = asyncHandler(async (req, res) => {
  const exam = await liveCbt.getQuestions(req.user._id, req.params.code);
  res.json({ exam });
});

export const saveAnswer = asyncHandler(async (req, res) => {
  const answer = await liveCbt.saveAnswer(req.user._id, req.params.code, req.body);
  res.json({ answer });
});

export const submitExam = asyncHandler(async (req, res) => {
  const result = await liveCbt.submitExam(req.user._id, req.params.code, req.body?.answers ?? []);
  res.json({ result });
});

export const getMyResult = asyncHandler(async (req, res) => {
  const result = await liveCbt.getMyResult(req.user._id, req.params.code);
  res.json({ result });
});

export const participantResult = asyncHandler(async (req, res) => {
  const result = await liveCbt.getParticipantResult(req.user._id, req.params.code, req.params.userId);
  res.json({ result });
});

export const hostDashboard = asyncHandler(async (req, res) => {
  const dashboard = await liveCbt.hostDashboard(req.user._id, req.params.code);
  res.json({ dashboard });
});

export const exportCsv = asyncHandler(async (req, res) => {
  const csv = await liveCbt.exportCsv(req.user._id, req.params.code);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="live-cbt-${req.params.code}.csv"`);
  res.send(csv);
});

export const stream = asyncHandler(async (req, res) => {
  const { subscribe, unsubscribe } = await import('../services/liveEvents.js');
  const { LiveExam } = await import('../models/LiveExam.js');
  const { LiveParticipant } = await import('../models/LiveParticipant.js');

  const exam = await LiveExam.findOne({ shareCode: req.params.code });
  if (!exam) {
    return res.status(404).json({ error: { code: 'LIVE_EXAM_NOT_FOUND', message: 'Examination not found.' } });
  }
  const isHost = String(exam.host) === String(req.user._id);
  const membership = await LiveParticipant.findOne({ liveExam: exam._id, user: req.user._id }).lean();
  if (!isHost && !membership) {
    return res.status(403).json({ error: { code: 'NOT_A_PARTICIPANT', message: 'Join this examination to receive live updates.' } });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ shareCode: exam.shareCode, status: exam.status, serverTime: new Date().toISOString() })}\n\n`);

  subscribe(exam.shareCode, res);
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ serverTime: new Date().toISOString() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe(exam.shareCode, res);
  });
});
