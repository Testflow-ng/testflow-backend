import { Router } from 'express';
import * as library from '../controllers/library.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { sharedRateLimit } from '../middleware/rateLimit.js';
import { bookIdSchema, bookPagesSchema, bookProgressSchema, listBooksSchema, listNotesSchema, noteIdSchema, createNoteSchema } from '../validators/library.schema.js';
import { singleBookFile, noteImages } from '../middleware/uploadImage.js';

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

/** POST /api/library/books — create a new book (title, code, etc.) with fileKey: null and placeholder pages.
 *  Library entitlement; administrators are exempt. */
router.post('/books', library.createBook);

/** PUT /api/library/books/:id — update book metadata (title, code, price, visibility, bookType).
 *  Library entitlement; administrators are exempt. */
router.put('/books/:id', validate(bookIdSchema), library.updateBook);

/** DELETE /api/library/books/:id — remove a book from the shelf.
 *  Library entitlement; administrators are exempt. */
router.delete('/books/:id', validate(bookIdSchema), library.deleteBook);

/* ------------------------------------------------------------- file upload */

/** POST /api/library/books/:id/upload — upload a PDF for the book.
 *  Validates the file starts with `%PDF-`, stores to R2, creates placeholder pages.
 *  Library entitlement; administrators are exempt. */
const uploadLimiter = sharedRateLimit({
  name: 'library-upload',
  windowMs: 60 * 60 * 1000,
  max: 10,
  key: (req) => `${req.user?._id ?? req.ip}:${req.params?.id ?? ''}`,
});
router.post(
  '/books/:id/upload',
  uploadLimiter,
  singleBookFile(),
  validate(bookIdSchema),
  library.uploadBookFile,
);


/* ------------------------------------------------------------- notes */

/** GET /api/library/notes — paged notes, filterable by course (`subject`), level and semester.
 *  Library entitlement; administrators are exempt. */
router.get('/notes', validate(listNotesSchema), library.listNotes);

/** POST /api/library/notes — create a note; images are attached next, against the new id.
 *  Library entitlement; administrators are exempt. */
router.post('/notes', validate(createNoteSchema), library.createNote);

/** POST /api/library/notes/:id/images — attach up to 10 images (2 MB each) to a note.
 *  Library entitlement; administrators are exempt. */
const noteImagesLimiter = sharedRateLimit({
  name: 'library-note-images',
  windowMs: 60 * 60 * 1000,
  max: 12,
  key: (req) => `${req.user?._id ?? req.ip}:${req.params?.id ?? ''}`,
});
router.post('/notes/:id/images', noteImagesLimiter, noteImages(), validate(noteIdSchema), library.uploadNoteImages);

/** DELETE /api/library/notes/:id — remove a note and its images from the media store.
 *  Library entitlement; administrators are exempt. */
router.delete('/notes/:id', validate(noteIdSchema), library.deleteNote);

/** GET /api/library/notes/:id — note detail with short-lived URLs for its images */
router.get('/notes/:id', validate(noteIdSchema), library.getNote);

/** GET /api/library/notes/:id/download — download note image */
router.get('/notes/:id/download', library.downloadNote);

export default router;
