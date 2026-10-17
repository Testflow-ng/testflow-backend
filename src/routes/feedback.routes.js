import { Router } from 'express';
import * as feedback from '../controllers/feedback.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { sharedRateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { createFeedbackSchema } from '../validators/feedback.schema.js';

const router = Router();

router.use(authenticate);

/**
 * Ten an hour per account, counted in the database so the ceiling holds across instances.
 * The cost of being wrong is small in both directions: a student writes once or twice, and a
 * script cannot fill the admin queue. Duplicate words inside a day are collapsed by the
 * service, so a genuine retry does not consume the allowance twice.
 */
const submitLimiter = sharedRateLimit({
  name: 'feedback-submit',
  windowMs: 60 * 60 * 1000,
  max: 10,
  key: (req) => String(req.user?._id ?? req.ip),
});

router.get('/', feedback.listFeedback);
router.post('/', submitLimiter, validate(createFeedbackSchema), feedback.createFeedback);

export default router;
