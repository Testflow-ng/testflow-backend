import { Router } from 'express';
import * as subject from '../controllers/subject.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { overallLeaderboardSchema } from '../validators/subject.schema.js';

/**
 * The Hall of Fame overall board: every student's best score summed across subjects.
 *
 * It lives at the root rather than under `/subjects` because it is not about one subject, and the
 * caller's own rank (`me`) is only meaningful to a signed-in student.
 */
const router = Router();

router.use(authenticate);
router.get('/', validate(overallLeaderboardSchema), subject.getOverallLeaderboard);

export default router;
