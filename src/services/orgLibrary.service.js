import { OrgBook } from '../models/OrgBook.js';
import { OrgMembership } from '../models/OrgMembership.js';
import { OrgPayment } from '../models/OrgPayment.js';
import { AppError } from '../utils/AppError.js';
import { presignGet } from '../utils/r2.js';

/**
 * The organisation's Library, as its own students see it.
 *
 * The console owns the shelf (`orgContent.listBooks/createBook/...`); this file is the student
 * surface: browse, read the metadata, and download the PDF.
 *
 * The rules:
 *
 *  1. Only an active member of the organisation may see its shelf at all. The organisation comes
 *     from the tenant address, never from the request body.
 *  2. Only `published` books with a supported visibility are listed. `paid` is shown but `locked`
 *     until a verified `book` payment exists; that is what lets a student see what they are buying.
 *  3. A file URL is only ever minted here, after the access check, and `fileKey` is never
 *     serialised. A free book is open to any member; a priced book needs its own paid row.
 *  4. `group` visibility predates the student surface and no group model exists to honour it, so
 *     such rows are not served to students rather than being shown to everyone.
 */

export const STUDENT_VISIBILITIES = Object.freeze(['all_students', 'paid']);
export const DEFAULT_LIMIT = 12;
export const MAX_LIMIT = 50;
/** Long enough for a slow download to start, short enough that a forwarded link dies quickly. */
export const DOWNLOAD_TTL_SEC = 60 * 60;

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Active membership is the whole authorization story for the shelf. */
export const requireActiveMember = async (orgId, user) => {
  const membership = await OrgMembership.findOne({
    organization: orgId,
    user: user?._id,
    status: 'active',
  }).lean();
  if (!membership) {
    throw new AppError(403, 'NO_MEMBERSHIP', 'This account is not a student of this organisation.');
  }
  return membership;
};

const isPriced = (book) => Number(book.priceMinor ?? 0) > 0;

/** Which of these books the student has already bought, as a Set of string ids. */
const ownedIds = async (orgId, userId, bookIds) => {
  const priced = bookIds.filter(Boolean);
  if (!priced.length) return new Set();
  const rows = await OrgPayment.find({
    organization: orgId,
    student: userId,
    item: 'book',
    itemRef: { $in: priced },
    status: 'paid',
  })
    .select('itemRef')
    .lean();
  return new Set(rows.map((row) => String(row.itemRef)));
};

/**
 * The student's view of a book. `fileKey` is absent by construction; `locked` is what the client
 * turns into "Unlock for ₦X", and a free book reports `owned: true` so the client has one rule.
 */
export const toStudentBookView = (book, { owned = false } = {}) => {
  const priced = isPriced(book);
  return {
    id: String(book._id),
    title: book.title,
    code: book.code ?? '',
    description: book.description ?? '',
    color: book.color ?? 'ink',
    priceMinor: book.priceMinor ?? 0,
    currency: book.currency ?? 'NGN',
    previewPages: book.previewPages ?? 0,
    pages: book.pages ?? 0,
    hasFile: Boolean(book.fileKey),
    sizeKb: Math.round((book.sizeBytes ?? 0) / 1024),
    locked: priced && !owned,
    owned: priced ? owned : true,
    updatedAt: book.updatedAt ?? null,
  };
};

/** A book students may see: published, and not a legacy `group` row. */
const studentWhere = (orgId, extra = {}) => ({
  organization: orgId,
  published: true,
  visibility: { $in: STUDENT_VISIBILITIES },
  ...extra,
});

/**
 * GET /api/v1/public/library/books
 * The shelf is the same catalogue for every student; only the `owned` flag differs per book.
 */
export const listStudentBooks = async (orgId, user, { q = '', page = 1, limit = DEFAULT_LIMIT } = {}) => {
  await requireActiveMember(orgId, user);

  const where = studentWhere(orgId);
  const needle = String(q ?? '').trim();
  if (needle) {
    const rx = new RegExp(escapeRegExp(needle), 'i');
    where.$or = [{ title: rx }, { code: rx }, { description: rx }];
  }

  const safeLimit = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), MAX_LIMIT);
  const total = await OrgBook.countDocuments(where);
  const pageCount = Math.max(1, Math.ceil(total / safeLimit));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);

  const books = await OrgBook.find(where)
    .sort({ createdAt: -1 })
    .skip((current - 1) * safeLimit)
    .limit(safeLimit)
    .lean();
  const owned = await ownedIds(orgId, user._id, books.filter(isPriced).map((book) => book._id));

  return {
    items: books.map((book) => toStudentBookView(book, { owned: owned.has(String(book._id)) })),
    page: current,
    pageCount,
    total,
  };
};

/** GET /api/v1/public/library/books/:bookId */
export const getStudentBook = async (orgId, user, bookId) => {
  await requireActiveMember(orgId, user);
  const book = await OrgBook.findOne(studentWhere(orgId, { _id: bookId })).lean();
  if (!book) throw new AppError(404, 'BOOK_NOT_FOUND', 'That book is not on this shelf.');

  const owned = isPriced(book) ? (await ownedIds(orgId, user._id, [book._id])).has(String(book._id)) : true;
  return toStudentBookView(book, { owned });
};

const assertBookAccess = async (orgId, user, book) => {
  await requireActiveMember(orgId, user);
  if (!isPriced(book)) return;
  const paid = await OrgPayment.exists({
    organization: orgId,
    student: user._id,
    item: 'book',
    itemRef: book._id,
    status: 'paid',
  });
  if (!paid) {
    const error = new AppError(402, 'PAYMENT_REQUIRED', 'Buy this book before downloading it.');
    error.details = { bookId: String(book._id), priceMinor: book.priceMinor, currency: book.currency ?? 'NGN' };
    throw error;
  }
};

/**
 * A still-valid URL is reused instead of minting a new signature on every tap. Per process on
 * purpose: it is a courtesy to the student and to R2, not a security control. The URL's own
 * `expiresAt` is the authority.
 */
const reused = new Map();
const REUSE_MARGIN_MS = 5 * 60 * 1000;
const REUSE_MAX = 500;

/**
 * GET /api/v1/public/library/books/:bookId/download
 * A short-lived signed URL, named for the book. `403 DOWNLOAD_NOT_AVAILABLE` when the console has
 * not attached a file yet, which is a different answer from "that book does not exist".
 */
export const getStudentBookFile = async (orgId, user, bookId) => {
  const book = await OrgBook.findOne(studentWhere(orgId, { _id: bookId })).lean();
  if (!book) throw new AppError(404, 'BOOK_NOT_FOUND', 'That book is not on this shelf.');
  await assertBookAccess(orgId, user, book);

  if (!book.fileKey) {
    throw new AppError(403, 'DOWNLOAD_NOT_AVAILABLE', 'That book has no downloadable file yet.');
  }

  const fileName = book.fileName || `${book.title}.pdf`;
  const cacheKey = `${orgId}:${user._id}:${book._id}`;
  const hit = reused.get(cacheKey);
  if (hit && hit.expiresAtMs - Date.now() > REUSE_MARGIN_MS) {
    return { url: hit.url, fileName, sizeBytes: book.sizeBytes ?? 0, expiresAt: hit.expiresAt };
  }

  const signed = presignGet(book.fileKey, { expiresSec: DOWNLOAD_TTL_SEC, fileName, contentType: 'application/pdf' });
  if (reused.size >= REUSE_MAX) reused.clear();
  reused.set(cacheKey, { url: signed.url, expiresAt: signed.expiresAt, expiresAtMs: new Date(signed.expiresAt).getTime() });

  return { url: signed.url, fileName, sizeBytes: book.sizeBytes ?? 0, expiresAt: signed.expiresAt };
};
