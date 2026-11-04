import { Router } from 'express';
import * as library from '../controllers/library.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { sharedRateLimit } from '../middleware/rateLimit.js';
import { bookIdSchema, bookPagesSchema, bookProgressSchema, listBooksSchema } from '../validators/library.schema.js';

/**
 * The Library shelf, the reader, bookmarks, reading progress and the file download.
 *
 * Every route needs a session, so the check is applied at the router level. The Student Pass gate
 * is not here on purpose: it belongs to the two service functions that return content, and keeping
 * it there means the download cannot be reached without it however the route is wired.
 */
const router = Router();

router.use(authenticate);

// Downloading signs a URL, so it is limited per student and per book rather than per IP: one
// student cannot turn the reader into a signing oracle, and one book cannot be hammered.
const downloadLimiter = sharedRateLimit({
  name: 'library-download',
  windowMs: 60 * 60 * 1000,
  max: 60,
  key: (req) => `${req.user?._id ?? req.ip}:${req.params?.id ?? ''}`,
});

router.get('/books', validate(listBooksSchema), library.listBooks);
router.get('/reading', library.listReading);
router.get('/books/:id', validate(bookIdSchema), library.getBook);
router.get('/books/:id/pages', validate(bookPagesSchema), library.getBookPages);
router.post('/books/:id/bookmark', validate(bookIdSchema), library.toggleBookmark);
router.put('/books/:id/progress', validate(bookProgressSchema), library.saveProgress);
router.get('/books/:id/download', downloadLimiter, validate(bookIdSchema), library.downloadBook);

export default router;
