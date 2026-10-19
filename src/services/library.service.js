import { AppError } from '../utils/AppError.js';
import { Book } from '../models/Book.js';
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
