import { Router } from 'express';
import * as session from '../controllers/examSession.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireVerified } from '../middleware/requireVerified.js';
import { validate } from '../middleware/validate.js';
import {
  startSessionSchema,
  sessionIdSchema,
  answerSchema,
} from '../validators/examSession.schema.js';

const router = Router();

router.use(authenticate);

router.get('/', session.listSessions);
router.get('/stats', session.getStats); // must precede '/:id'
// Starting an exam requires a verified email (integrity of graded attempts).
router.post('/', requireVerified, validate(startSessionSchema), session.startSession);
router.get('/:id', validate(sessionIdSchema), session.getSession);
router.patch('/:id/answer', validate(answerSchema), session.saveAnswer);
router.post('/:id/submit', validate(sessionIdSchema), session.submitSession);
router.get('/:id/result', validate(sessionIdSchema), session.getResult);

export default router;
