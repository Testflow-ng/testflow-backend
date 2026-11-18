import { asyncHandler } from '../middleware/asyncHandler.js';
import * as library from '../services/library.service.js';
import { mintBookShare, mintNoteShare } from '../services/libraryShare.service.js';
import { requestOrigin } from '../utils/requestOrigin.js';
import { contentDisposition } from '../utils/contentDisposition.js';

/**
 * The Library. Every route is a student's own, and the shelf is the same for everyone, so the
 * router-level session check is the whole authorization story except for the pass gate, which the
 * service applies to reading and downloading.
 */

export const listBooks = asyncHandler(async (req, res) => {
  res.json(await library.listBooks(req.user._id, req.query));
});

export const getBook = asyncHandler(async (req, res) => {
  res.json({ book: await library.getBook(req.user._id, req.params.id) });
});

export const listReading = asyncHandler(async (req, res) => {
  res.json({ reading: await library.listReading(req.user._id) });
});

export const getBookPages = asyncHandler(async (req, res) => {
  res.json(await library.getBookPages(req.user, req.params.id, req.query.page));
});

export const toggleBookmark = asyncHandler(async (req, res) => {
  res.json(await library.toggleBookmark(req.user._id, req.params.id));
});

export const saveProgress = asyncHandler(async (req, res) => {
  res.json({ progress: await library.saveProgress(req.user._id, req.params.id, req.body.page) });
});

export const downloadBook = asyncHandler(async (req, res) => {
  res.json(await library.getBookDownload(req.user, req.params.id));
});

/** GET /api/library/books/:id/file — the PDF bytes, inline, for the reader. */
export const getBookFile = asyncHandler(async (req, res) => {
  const { buffer, fileName } = await library.getBookFile(req.user, req.params.id);
  res
    .set({
      'Content-Type': 'application/pdf',
      'Content-Length': buffer.length,
      'Content-Disposition': contentDisposition('inline', fileName),
      'Cache-Control': 'private, no-store',
    })
    .send(buffer);
});

/** GET /api/library/books/:id/share — mint (or return) the public link for this book. */
export const getBookShare = asyncHandler(async (req, res) => {
  res.json(await mintBookShare(req.user, req.params.id, requestOrigin(req)));
});

/** GET /api/library/notes/:id/share — mint (or return) the public link for this note. */
export const getNoteShare = asyncHandler(async (req, res) => {
  res.json(await mintNoteShare(req.user, req.params.id, requestOrigin(req)));
});


export const createBook = asyncHandler(async (req, res) => {
  res.json(await library.createBook(req.user._id, req.body));
});

export const updateBook = asyncHandler(async (req, res) => {
  res.json(await library.updateBook(req.user._id, req.params.id, req.body));
});

export const deleteBook = asyncHandler(async (req, res) => {
  res.json(await library.deleteBook(req.user._id, req.params.id));
});

export const uploadBookFile = asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });
  res.json(await library.uploadBookFile(req.user._id, req.params.id, file));
});


export const listNotes = asyncHandler(async (req, res) => {
  res.json(await library.listNotes(req.user._id, req.query));
});

export const createNote = asyncHandler(async (req, res) => {
  res.status(201).json(await library.createNote(req.user._id, req.body));
});

export const uploadNoteImages = asyncHandler(async (req, res) => {
  res.json(await library.uploadNoteImages(req.user._id, req.params.id, req.files));
});

export const deleteNote = asyncHandler(async (req, res) => {
  res.json(await library.deleteNote(req.user._id, req.params.id));
});

export const getNote = asyncHandler(async (req, res) => {
  res.json(await library.getNote(req.user._id, req.params.id));
});

export const downloadNote = asyncHandler(async (req, res) => {
  const file = await library.downloadNote(req.user._id, req.params.id);
  res.json(file);
});
