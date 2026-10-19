import { Router } from 'express';
import * as live from '../controllers/liveCbt.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireVerified } from '../middleware/requireVerified.js';
import { validate } from '../middleware/validate.js';
import {
  createLiveExamSchema,
  saveLiveAnswerSchema,
  shareCodeParamSchema,
  submitLiveExamSchema,
  targetUserSchema,
} from '../validators/liveCbt.schema.js';

const router = Router();

router.use(authenticate);

router.post('/', requireVerified, validate(createLiveExamSchema), live.createExam);

// Room / waiting-room
router.get('/:code', validate(shareCodeParamSchema), live.myMembership);
router.get('/:code/host', validate(shareCodeParamSchema), live.hostRoom);
router.post('/:code/join', validate(shareCodeParamSchema), live.requestJoin);
router.post('/:code/approve', validate(targetUserSchema), live.approveParticipant);
router.post('/:code/reject', validate(targetUserSchema), live.rejectParticipant);
router.post('/:code/approve-all', validate(shareCodeParamSchema), live.approveAll);

// Lifecycle (host)
router.post('/:code/start', validate(shareCodeParamSchema), live.startExam);
router.post('/:code/end', validate(shareCodeParamSchema), live.endExam);
router.post('/:code/publish', validate(shareCodeParamSchema), live.publishResults);
router.post('/:code/cancel', validate(shareCodeParamSchema), live.cancelExam);

// Exam delivery
router.get('/:code/questions', validate(shareCodeParamSchema), live.getQuestions);
router.patch('/:code/answer', validate(saveLiveAnswerSchema), live.saveAnswer);
router.post('/:code/submit', validate(submitLiveExamSchema), live.submitExam);

// Results
router.get('/:code/result', validate(shareCodeParamSchema), live.getMyResult);
router.get('/:code/dashboard', validate(shareCodeParamSchema), live.hostDashboard);
router.get('/:code/export.csv', validate(shareCodeParamSchema), live.exportCsv);

// Realtime event stream (SSE)
router.get('/:code/stream', validate(shareCodeParamSchema), live.stream);

export default router;
