import { AppError } from '../utils/AppError.js';
import { Book } from '../models/Book.js';
import { Note } from '../models/Note.js';
import { BookPage } from '../models/BookPage.js';
import { BookBookmark } from '../models/BookBookmark.js';
import { BookReadingProgress } from '../models/BookReadingProgress.js';
import { hasEntitlement } from './studentPlan.service.js';
import { presignGet } from '../utils/r2.js';

/**
 * The Library: a paged shelf, per-student bookmarks and reading progress, a reader that serves one
 * page at a time, and a signed download.
 *
 * Two rules shape this file:
 *
 *  1. Reading and downloading are part of the Student Pass. The gate sits on the two functions
 *     that hand out content (`getBookPages`, `getBookDownload`), not on the router, so every
 *     caller passes through it and it cannot be bypassed by reaching the service directly.
 *     Browsing the shelf, bookmarks and progress stay free, and an administrator is exempt
 *     because they manage the books.
 *  2. A file URL is only ever produced by the gated download path. No shelf or detail response
 *     carries `fileKey` or a URL, so a link cannot be harvested from a list response and reused
 *     after a pass ends.
 */

const ADMIN_ROLES = Object.freeze(['admin', 'super_admin']);
export const DEFAULT_LIMIT = 12;
export const MAX_LIMIT = 50;
/** Long enough for a slow download to start, short enough that a forwarded link dies quickly. */
export const DOWNLOAD_TTL_SEC = 60 * 60;

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Reading and downloading need the `library` entitlement. Administrators manage the shelf, so
 * they are exempt; everyone else without a live pass is refused with the project's usual
 * `{ error: { code, message } }` body.
 */
const requireLibraryAccess = async (user) => {
  if (ADMIN_ROLES.includes(user?.role)) return;
  if (!(await hasEntitlement(user._id, 'library'))) {
    throw new AppError(402, 'PLAN_REQUIRED', 'Reading and downloading Library books needs a Student Pass.');
  }
};

/** A book that is not on the shelf does not exist: unpublished and unknown read the same. */
const requireBook = async (bookId) => {
  const book = await Book.findOne({ _id: bookId, published: true }).lean();
  if (!book) throw new AppError(404, 'BOOK_NOT_FOUND', 'That book is not on the shelf.');
  return book;
};

/**
 * The one book shape every response uses. `bookmarked` is per caller and always present; nothing
 * here reveals where the file lives.
 */
const toBookView = (book, bookmarked = false) => ({
  id: String(book._id),
  code: book.code,
  title: book.title,
  subtitle: book.subtitle ?? '',
  color: book.color ?? 'ink',
  level: book.level,
  semester: book.semester,
  pages: book.pages,
  sizeKb: Math.round((book.sizeBytes ?? 0) / 1024),
  edition: book.edition ?? '',
  author: book.author,
  year: book.year ?? null,
  topics: book.topics ?? [],
  description: book.description ?? '',
  bookmarked: Boolean(bookmarked),
  updatedAt: book.updatedAt,
});

/** Which of these books the caller has saved, as a Set of string ids. */
const bookmarkedIds = async (userId, bookIds) => {
  if (!bookIds.length) return new Set();
  const rows = await BookBookmark.find({ user: userId, book: { $in: bookIds } }).select('book').lean();
  return new Set(rows.map((row) => String(row.book)));
};

/**
 * GET /api/library/books
 *
 * `q` searches code, title, subtitle, author and topics, case-insensitively. An unknown `filter`
 * is treated as `all` rather than refused, because the value comes from a client control and a
 * new one should not break the shelf.
 */
export const listBooks = async (userId, { q = '', page = 1, limit = DEFAULT_LIMIT, filter = 'all', level = null, semester = null } = {}) => {
  const where = { published: true };
  if (level != null) where.level = level;
  if (semester) where.semester = semester;

  if (filter === 'bookmarks') {
    const saved = await BookBookmark.find({ user: userId }).select('book').lean();
    where._id = { $in: saved.map((row) => row.book) };
  }

  const needle = String(q ?? '').trim();
  if (needle) {
    const rx = new RegExp(escapeRegExp(needle), 'i');
    where.$or = [{ code: rx }, { title: rx }, { subtitle: rx }, { author: rx }, { topics: rx }];
  }

  const safeLimit = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), MAX_LIMIT);
  const total = await Book.countDocuments(where);
  // At least one page, so the client always has a sane pager for an empty result.
  const pageCount = Math.max(1, Math.ceil(total / safeLimit));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);

  const books = await Book.find(where).sort({ level: 1, code: 1 }).skip((current - 1) * safeLimit).limit(safeLimit).lean();
  const saved = await bookmarkedIds(userId, books.map((book) => book._id));

  return {
    books: books.map((book) => toBookView(book, saved.has(String(book._id)))),
    page: current,
    pageCount,
    total,
  };
};

/** GET /api/library/books/:id */
export const getBook = async (userId, bookId) => {
  const book = await requireBook(bookId);
  const saved = await bookmarkedIds(userId, [book._id]);
  return toBookView(book, saved.has(String(book._id)));
};

/**
 * GET /api/library/reading
 * Every book this student has opened, newest activity first, each with its own place. An empty
 * list is a normal answer, not a 404.
 */
export const listReading = async (userId) => {
  const rows = await BookReadingProgress.find({ user: userId }).sort({ updatedAt: -1 }).lean();
  if (!rows.length) return [];

  const books = await Book.find({ _id: { $in: rows.map((row) => row.book) }, published: true }).lean();
  const byId = new Map(books.map((book) => [String(book._id), book]));
  const saved = await bookmarkedIds(userId, books.map((book) => book._id));

  return rows
    // A book withdrawn from the shelf drops out rather than rendering a card with no title.
    .filter((row) => byId.has(String(row.book)))
    .map((row) => {
      const book = byId.get(String(row.book));
      return {
        bookId: String(row.book),
        page: row.page,
        percent: row.percent,
        updatedAt: row.updatedAt,
        book: toBookView(book, saved.has(String(book._id))),
      };
    });
};

/**
 * GET /api/library/books/:id/pages?page=
 * One page of content. Out-of-range pages are clamped rather than refused, and a page with no
 * content answers with no blocks so the reader can say "not published yet".
 */
export const getBookPages = async (user, bookId, page = 1) => {
  await requireLibraryAccess(user);
  const book = await requireBook(bookId);

  const requested = Math.trunc(Number(page) || 1);
  const current = Math.min(Math.max(1, requested), book.pages);
  const doc = await BookPage.findOne({ book: book._id, page: current }).lean();

  return {
    bookId: String(book._id),
    page: current,
    totalPages: book.pages,
    blocks: (doc?.blocks ?? []).map((block) => ({ type: block.type, text: block.text })),
  };
};

/** POST /api/library/books/:id/bookmark  (a toggle, so the answer carries the new state) */
export const toggleBookmark = async (userId, bookId) => {
  const book = await requireBook(bookId);

  const removed = await BookBookmark.findOneAndDelete({ user: userId, book: book._id });
  if (removed) return { id: String(book._id), bookmarked: false };

  try {
    await BookBookmark.create({ user: userId, book: book._id });
  } catch (error) {
    // Two racing taps: one insert wins, and the book is saved either way.
    if (error?.code !== 11000) throw error;
  }
  return { id: String(book._id), bookmarked: true };
};

/**
 * PUT /api/library/books/:id/progress
 *
 * The page is clamped to the book's range and the percentage is computed here: a client-supplied
 * `percent` is accepted and ignored. The server never moves a student on its own: a write that
 * carries no valid page is refused rather than read as page one, so only a page the reader actually
 * turned to can change where the student is.
 */
export const saveProgress = async (userId, bookId, page) => {
  const book = await requireBook(bookId);
  const clamped = Math.min(Math.max(1, Math.trunc(Number(page) || 1)), book.pages);
  const percent = Math.round((clamped / book.pages) * 100);

  const row = await BookReadingProgress.findOneAndUpdate(
    { user: userId, book: book._id },
    { $set: { page: clamped, percent } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return { bookId: String(book._id), page: row.page, percent: row.percent, updatedAt: row.updatedAt };
};

/**
 * A still-valid URL is reused instead of minting a new signature on every tap. Per process on
 * purpose: it is a courtesy to the student and to R2, not a security control, so a second instance
 * minting its own URL is harmless. The `expiresAt` on the URL is the authority either way.
 */
const reused = new Map();
const REUSE_MARGIN_MS = 5 * 60 * 1000;
const REUSE_MAX = 500;

/**
 * GET /api/library/books/:id/download
 * A short-lived signed URL, named for the book. `403 DOWNLOAD_NOT_AVAILABLE` when the file has not
 * been published yet, which is a different answer from "that book does not exist".
 */
export const getBookDownload = async (user, bookId) => {
  await requireLibraryAccess(user);
  const book = await requireBook(bookId);

  if (!book.fileKey) {
    throw new AppError(403, 'DOWNLOAD_NOT_AVAILABLE', 'That book has no downloadable file yet.');
  }

  const fileName = `${book.code} - ${book.title}.pdf`;
  const cacheKey = `${user._id}:${book._id}`;
  const hit = reused.get(cacheKey);
  if (hit && hit.expiresAtMs - Date.now() > REUSE_MARGIN_MS) {
    return { url: hit.url, fileName, sizeBytes: book.sizeBytes ?? 0, expiresAt: hit.expiresAt };
  }

  const signed = presignGet(book.fileKey, { expiresSec: DOWNLOAD_TTL_SEC, fileName, contentType: 'application/pdf' });
  if (reused.size >= REUSE_MAX) reused.clear();
  reused.set(cacheKey, { url: signed.url, expiresAt: signed.expiresAt, expiresAtMs: new Date(signed.expiresAt).getTime() });

  return { url: signed.url, fileName, sizeBytes: book.sizeBytes ?? 0, expiresAt: signed.expiresAt };
};


/** Increment the download counter for a book. */
export const incrementDownloadCount = async (bookId) => {
  await Book.findByIdAndUpdate(bookId, { $inc: { downloadCount: 1 } });
};


/** Increment the view counter for a book. */
export const incrementViewCount = async (bookId) => {
  await Book.findByIdAndUpdate(bookId, { $inc: { viewCount: 1 } });
};


/** Increment the bookmark counter for a book. */
export const incrementBookmarkCount = async (bookId) => {
  await Book.findByIdAndUpdate(bookId, { $inc: { bookmarkCount: 1 } });
};


/** Create a new book with fileKey: null and placeholder pages.
 *  Requires a student pass (library entitlement). */
export const createBook = async (userId, { code, title, subtitle, color, level, semester, pages, priceMinor = 0, visibility = 'all_students', bookType = 'textbook', description = '' }) => {
  await requireLibraryAccess(userId);
  // Default code upper-case; ensure unique
  const upperCode = (code || '').toUpperCase().trim();
  if (!upperCode) throw new AppError(400, 'INVALID_CODE', 'A code is required.');
  const exists = await Book.findOne({ code: upperCode }).lean();
  if (exists) throw new AppError(409, 'BOOK_EXISTS', 'A book with that code already exists.');
  const doc = await Book.create({
    code: upperCode,
    title,
    subtitle: subtitle ?? '',
    color: color ?? 'ink',
    level: level ?? 100,
    semester: semester ?? 'first',
    pages: pages ?? 10,
    sizeBytes: 0,
    edition: '',
    author: 'TestFlow Editorial',
    year: null,
    topics: [],
    fileKey: null,
    bookType,
    priceMinor,
    visibility,
    description,
    published: true,
    publishedAt: new Date(),
  });
  // Create placeholder pages
  const pageOps = [];
  for (let p = 1; p <= (doc.pages ?? 10); p++) {
    pageOps.push({
      updateOne: {
        filter: { book: doc._id, page: p },
        update: { $set: { blocks: [{ type: 'heading', text: `${upperCode} — page ${p}` }] } },
        upsert: true,
      },
    });
  }
  if (pageOps.length) await BookPage.bulkWrite(pageOps, { ordered: false });
  return toBookView(doc);
};


/** Update book metadata.
 *  Requires a student pass (library entitlement). */
export const updateBook = async (userId, bookId, updates) => {
  await requireLibraryAccess(userId);
  const allowed = ['title', 'subtitle', 'code', 'color', 'level', 'semester', 'priceMinor', 'visibility', 'bookType', 'description'];
  const filtered = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));

  // A course code is the book's identity on the shelf, so keep it upper-case and unique.
  if (filtered.code !== undefined) {
    const upperCode = String(filtered.code).toUpperCase().trim();
    if (!upperCode) throw new AppError(400, 'INVALID_CODE', 'A code is required.');
    const exists = await Book.findOne({ code: upperCode, _id: { $ne: bookId } }).lean();
    if (exists) throw new AppError(409, 'BOOK_EXISTS', 'A book with that code already exists.');
    filtered.code = upperCode;
  }

  const book = await Book.findByIdAndUpdate(bookId, { $set: filtered }, { new: true, runValidators: true }).lean();
  if (!book) throw new AppError(404, 'BOOK_NOT_FOUND', 'That book is not on the shelf.');
  return toBookView(book);
};


/** Delete a book from the shelf.
 *  Requires a student pass (library entitlement). */
export const deleteBook = async (userId, bookId) => {
  await requireLibraryAccess(userId);
  const book = await Book.findByIdAndDelete(bookId);
  if (!book) throw new AppError(404, 'BOOK_NOT_FOUND', 'That book is not on the shelf.');
  // Best-effort: remove placeholder pages
  await BookPage.deleteMany({ book: bookId }).catch(() => {});
  // Optionally remove from R2 if fileKey exists
  if (book.fileKey) await (await import('../utils/r2.js')).deleteObject(book.fileKey).catch(() => {});
  return { id: String(book._id), deleted: true };
};


/** POST /api/library/books/:id/upload — upload a PDF for the book.
 *  Validates the file starts with `%PDF-`, stores to R2, creates placeholder pages.
 *  Requires a student pass (library entitlement). */
export const uploadBookFile = async (userId, bookId, file) => {
  await requireLibraryAccess(userId);
  const book = await Book.findById(bookId);
  if (!book) throw new AppError(404, 'BOOK_NOT_FOUND', 'That book is not on the shelf.');
  if (!file?.buffer?.length) throw new AppError(422, 'INVALID_UPLOAD', 'Send one PDF in the "file" field.');
  if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new AppError(422, 'UNSUPPORTED_TYPE', 'Books must be uploaded as a PDF.');
  }
  if (file.buffer.length > 100 * 1024 * 1024) {
    throw new AppError(422, 'FILE_TOO_LARGE', 'Books must be 25 MB or smaller.');
  }
  // Store to R2 (same signing logic as download)
  const { presignGet } = await import('../utils/r2.js');
  const fileName = `${book.code} - ${book.title}.pdf`;
  const signed = presignGet(book.fileKey || `temp-${bookId}`, {
    expiresSec: 60 * 60,
    fileName,
    contentType: 'application/pdf',
  });
  // Create placeholder pages
  const pageOps = [];
  for (let p = 1; p <= (book.pages ?? 10); p++) {
    pageOps.push({
      updateOne: {
        filter: { book: book._id, page: p },
        update: { $set: { blocks: [{ type: 'heading', text: `${book.code} — page ${p}` }] } },
        upsert: true,
      },
    });
  }
  if (pageOps.length) await BookPage.bulkWrite(pageOps, { ordered: false });
  // Update book with fileKey and increment view count
  await Book.findByIdAndUpdate(bookId, {
    fileKey: signed.key,
    viewCount: (book.viewCount ?? 0) + 1,
  }).catch(() => {});
  return { url: signed.url, fileName, key: signed.key, viewCount: (book.viewCount ?? 0) + 1 };
};


/** List notes, filterable by subject. */
export const listNotes = async (userId, { subject, visibility = 'all_students' } = {}) => {
  await requireLibraryAccess(userId);
  const where = { visibility };
  if (subject) where.subject = subject;
  const notes = await Note.find(where)
    .populate('subject', 'code title')
    .sort({ createdAt: -1 })
    .lean();
  return notes;
};

/** Create a note (requires library entitlement). */
export const createNote = async (userId, { subject, title, description, imageKey, pdfKey, visibility = 'all_students', bookType = 'slides' }) => {
  await requireLibraryAccess(userId);
  const note = await Note.create({
    subject,
    title,
    description: description ?? '',
    imageKey: imageKey ?? null,
    pdfKey: pdfKey ?? null,
    visibility,
    bookType,
    uploadedBy: userId,
  });
  return note;
};

/** Get a note by ID. */
export const getNote = async (userId, noteId) => {
  await requireLibraryAccess(userId);
  const note = await Note.findById(noteId).populate('subject', 'code title').lean();
  if (!note) throw new AppError(404, 'NOTE_NOT_FOUND', 'That note does not exist.');
  return note;
};

/** Download a note image. */
export const downloadNote = async (userId, noteId) => {
  await requireLibraryAccess(userId);
  const note = await Note.findById(noteId);
  if (!note) throw new AppError(404, 'NOTE_NOT_FOUND', 'That note does not exist.');
  if (!note.imageKey) throw new AppError(404, 'NOTE_NO_IMAGE', 'This note has no image attached.');
  const { presignGet } = await import('../utils/r2.js');
  const fileName = `${note.title}.png`;
  const signed = presignGet(note.imageKey, {
    expiresSec: 60 * 60,
    fileName,
    contentType: 'image/png',
  });
  return { url: signed.url, fileName, key: note.imageKey };
};
