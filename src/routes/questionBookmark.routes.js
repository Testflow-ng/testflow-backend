import { Router } from 'express';
import * as bookmark from '../controllers/questionBookmark.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { bookmarkIdSchema, bookmarkSchema } from '../validators/study.schema.js';

/**
 * Saved questions: the list, the toggle, and taking one out.
 *
 * Every route here is the student's own, so the router-level session check is the whole
 * authorization story. The prefix is this feature's alone, which is what makes it safe to apply
 * it at the router level.
 */
const router = Router();

router.use(authenticate);

router.get('/', bookmark.listBookmarks);
router.post('/', validate(bookmarkSchema), bookmark.toggleBookmark);
router.delete('/:id', validate(bookmarkIdSchema), bookmark.removeBookmark);

export default router;
