import { Router } from 'express';
import * as flag from '../controllers/questionFlag.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { reportQuestionSchema } from '../validators/study.schema.js';

/**
 * Reporting a broken question.
 *
 * Mounted at `/questions` *before* the question bank router, because that one guards its whole
 * prefix with an admin check and would refuse a student before this route was ever reached.
 *
 * The auth is router-level but the mount is prefix-scoped, so it only ever runs for
 * `/questions/...`. That matters: a router mounted at `/` with `router.use(authenticate)` would
 * require a session for every request that flows past it, including the ones that are public on
 * purpose (the payment webhooks, the public question card).
 */
const router = Router();

router.use(authenticate);

router.post('/:id/flag', validate(reportQuestionSchema), flag.reportQuestion);

export default router;
