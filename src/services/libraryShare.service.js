import { AppError } from '../utils/AppError.js';
import { Book } from '../models/Book.js';
import { Note } from '../models/Note.js';
import { generateShareToken } from '../utils/shareToken.js';
import { requireLibraryAccess, usableFileKey } from './library.service.js';

/**
 * Public share links for Library books and notes.
 *
 * Same contract as the result cards: the token is the whole credential, minted once and reused, so
 * re-sharing a link never produces a second URL saying the same thing. Revoking is clearing the
 * field on the document, which nothing else is keyed on.
 *
 * A link grants exactly what the person sharing it could already do:
 *  - books: the title page and the PDF, if one is uploaded and the book is published;
 *  - notes: the images, in order.
 * It never carries the storage keys, the uploader's identity or anything about who else has read it.
 */

const ensureShareToken = async (doc) => {
  if (doc.shareToken) return doc.shareToken;
  // The sparse unique index keeps two documents from ever sharing a token. A collision is
  // vanishingly unlikely; retrying is cheaper than reasoning about it.
  for (let attempt = 0; attempt < 3 && !doc.shareToken; attempt += 1) {
    doc.shareToken = generateShareToken();
    try {
      await doc.save();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      doc.shareToken = undefined;
    }
  }
  if (!doc.shareToken) {
    throw new AppError(500, 'SHARE_TOKEN_FAILED', 'Could not create a share link. Please try again.');
  }
  return doc.shareToken;
};

/** Paid content is never publishable through a public link: the token would be a free pass. */
const assertShareable = (doc, kind) => {
  if ((doc?.visibility ?? 'all_students') === 'paid') {
    throw new AppError(403, 'SHARE_NOT_ALLOWED', `Only free ${kind}s can be shared publicly.`);
  }
};

/**
 * Mint (or return) the public link for a book. The gate is the same one the reader uses: an
 * administrator, or anyone holding the library entitlement, may share; a student without a pass
 * may not — they cannot open the book themselves either. Paid books cannot be shared at all.
 */
export const mintBookShare = async (user, bookId, origin) => {
  await requireLibraryAccess(user);
  const book = await Book.findOne({ _id: bookId, published: true });
  if (!book) throw new AppError(404, 'BOOK_NOT_FOUND', 'That book is not on the shelf.');
  assertShareable(book, 'book');
  const token = await ensureShareToken(book);
  return { token, shareUrl: `${origin}/s/book/${token}` };
};

/** Mint (or return) the public link for a note. Same gates as a book: entitlement, and not paid. */
export const mintNoteShare = async (user, noteId, origin) => {
  await requireLibraryAccess(user);
  const note = await Note.findById(noteId);
  if (!note) throw new AppError(404, 'NOTE_NOT_FOUND', 'That note does not exist.');
  assertShareable(note, 'note');
  const token = await ensureShareToken(note);
  return { token, shareUrl: `${origin}/s/note/${token}` };
};

/** Everything the public book page and its card print. Null for an unknown or unpublished token. */
export const findBookShare = async (token) => {
  const book = await Book.findOne({ shareToken: token, published: true, visibility: { $ne: 'paid' } }).lean();
  if (!book) return null;
  return {
    code: book.code,
    title: book.title,
    subtitle: book.subtitle ?? '',
    description: book.description ?? '',
    author: book.author ?? '',
    level: book.level,
    semester: book.semester,
    pages: book.pages,
    sizeBytes: book.sizeBytes ?? 0,
    hasFile: Boolean(usableFileKey(book)),
    fileKey: usableFileKey(book),
    id: String(book._id),
  };
};

/** The storage key for the image at `index` in reading order, or null when there is no such image. */
export const noteShareImageKey = (note, index) => {
  const keys = [...(note.images ?? []), ...(note.imageKey ? [note.imageKey] : [])];
  return keys[index] ?? null;
};

/** Everything the public note page and its card print. Null for an unknown token. */
export const findNoteShare = async (token) => {
  const note = await Note.findOne({ shareToken: token, visibility: { $ne: 'paid' } }).populate('subject', 'code title').lean();
  if (!note) return null;
  return {
    title: note.title,
    description: note.description ?? '',
    subjectCode: note.subject?.code ?? '',
    subjectTitle: note.subject?.title ?? '',
    level: note.level,
    semester: note.semester,
    imageCount: (note.images?.length ?? 0) + (note.imageKey ? 1 : 0),
    id: String(note._id),
  };
};

/** The raw note document for the image and card handlers: keys are needed to serve the bytes. */
export const findNoteShareDoc = (token) => Note.findOne({ shareToken: token, visibility: { $ne: 'paid' } }).populate('subject', 'code title').lean();
