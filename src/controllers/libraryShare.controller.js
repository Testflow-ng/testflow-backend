import sharp from 'sharp';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { config } from '../config/env.js';
import { requestOrigin } from '../utils/requestOrigin.js';
import { getObjectBuffer } from '../utils/r2.js';
import { logger } from '../utils/logger.js';
import { missingPageHtml } from '../utils/shareHtml.js';
import { contentDisposition } from '../utils/contentDisposition.js';
import { bookPageHtml, notePageHtml } from '../utils/libraryShareHtml.js';
import * as share from '../services/libraryShare.service.js';
import { libraryShareCardPng } from '../services/ogImage.service.js';
import { bookFileName } from '../services/library.service.js';
import { Book } from '../models/Book.js';

/**
 * The public library links.
 *
 * No session, no cookies, no CSRF token: the token in the path is the whole credential, exactly like
 * the result cards. A revoked or unknown token gets an HTML 404, because a person tapping a stale
 * link should read a sentence, not an API error.
 */

const notFoundPage = (res, clientUrl) =>
  res
    .status(404)
    .type('html')
    .set('Cache-Control', 'no-store')
    .send(
      missingPageHtml({
        title: 'Link not active',
        message: 'This link is not valid anymore. Ask whoever shared it for a fresh one.',
        clientUrl,
      }),
    );

const originOf = (req) => requestOrigin(req);

/** GET /s/book/:token — the public book page, with the Open Graph tags a crawler reads. */
export const bookPage = asyncHandler(async (req, res) => {
  const book = await share.findBookShare(req.params.token);
  if (!book) return notFoundPage(res, config.CLIENT_URL);

  const origin = originOf(req);
  const url = `${origin}/s/book/${req.params.token}`;
  return res
    .type('html')
    .set('Cache-Control', 'no-store')
    .send(
      bookPageHtml({
        book,
        url,
        cardUrl: `${url}/card.png`,
        fileUrl: `${url}/file`,
        downloadUrl: `${url}/file?download=1`,
        clientUrl: config.CLIENT_URL,
      }),
    );
});

/** GET /s/book/:token/card.png — the image a chat preview shows for a book link. */
export const bookCard = asyncHandler(async (req, res) => {
  const book = await share.findBookShare(req.params.token);
  if (!book) {
    return res.status(404).type('text/plain').send('Not found');
  }
  const png = await libraryShareCardPng({
    code: book.code,
    title: book.title,
    meta: [book.author, book.level ? `${book.level} level` : null].filter(Boolean).join(' · '),
    label: 'TestFlow Library',
  });
  res
    .type('png')
    .set('Cache-Control', 'public, max-age=31536000, immutable')
    .set('Cross-Origin-Resource-Policy', 'cross-origin')
    .send(png);
});

/** GET /s/book/:token/file[?download=1] — the PDF itself, streamed through us so no bucket access is needed. */
export const bookFile = asyncHandler(async (req, res) => {
  const book = await share.findBookShare(req.params.token);
  if (!book) return notFoundPage(res, config.CLIENT_URL);
  if (!book.fileKey) {
    return res.status(404).type('text/plain').send('No file has been uploaded for this book yet.');
  }

  let object;
  try {
    object = await getObjectBuffer(book.fileKey);
  } catch (err) {
    logger.warn('Share: book file missing from the media store', { key: book.fileKey, err: err?.message });
    return res.status(404).type('text/plain').send('The file for this book could not be found.');
  }

  const wantDownload = ['1', 'true'].includes(String(req.query.download ?? '').toLowerCase());
  if (wantDownload) {
    await Book.updateOne({ _id: book.id }, { $inc: { downloadCount: 1 } }).catch(() => {});
  }

  const fileName = bookFileName(book);
  res
    .set({
      'Content-Type': 'application/pdf',
      'Content-Length': object.buffer.length,
      'Content-Disposition': contentDisposition(wantDownload ? 'attachment' : 'inline', fileName),
      'Cache-Control': wantDownload ? 'private, max-age=0' : 'public, max-age=3600',
    })
    .send(object.buffer);
});

/** GET /s/note/:token — the public note page: every image the note holds, in reading order. */
export const notePage = asyncHandler(async (req, res) => {
  const note = await share.findNoteShare(req.params.token);
  if (!note) return notFoundPage(res, config.CLIENT_URL);

  const origin = originOf(req);
  const url = `${origin}/s/note/${req.params.token}`;
  return res
    .type('html')
    .set('Cache-Control', 'no-store')
    .send(
      notePageHtml({
        note,
        url,
        ogImageUrl: `${url}/og.png`,
        clientUrl: config.CLIENT_URL,
      }),
    );
});

/**
 * GET /s/note/:token/og.png — what a chat preview shows for a note link.
 *
 * The note's first image, re-encoded as a PNG so old preview crawlers that refuse WebP still render
 * it. A note with no images falls back to a generated text card.
 */
export const noteOg = asyncHandler(async (req, res) => {
  const note = await share.findNoteShareDoc(req.params.token);
  if (!note) return res.status(404).type('text/plain').send('Not found');

  const firstKey = share.noteShareImageKey(note, 0);
  if (firstKey) {
    try {
      const object = await getObjectBuffer(firstKey);
      const png = await sharp(object.buffer)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      return res
        .type('png')
        .set('Cache-Control', 'public, max-age=31536000, immutable')
        .set('Cross-Origin-Resource-Policy', 'cross-origin')
        .send(png);
    } catch (err) {
      logger.warn('Share: note og image fell back to a text card', { err: err?.message });
    }
  }

  const meta = [note.title, note.level ? `${note.level} level` : null].filter(Boolean).join(' · ');
  const png = await libraryShareCardPng({ code: note.subject?.code ?? 'NOTE', title: note.title, meta, label: 'TestFlow Notes' });
  res
    .type('png')
    .set('Cache-Control', 'public, max-age=31536000, immutable')
    .set('Cross-Origin-Resource-Policy', 'cross-origin')
    .send(png);
});

/** GET /s/note/:token/image/:index — one image from the note, streamed from the media store. */
export const noteImage = asyncHandler(async (req, res) => {
  const note = await share.findNoteShareDoc(req.params.token);
  if (!note) return res.status(404).type('text/plain').send('Not found');

  const index = Number.parseInt(req.params.index, 10);
  const key = Number.isInteger(index) && index >= 0 ? share.noteShareImageKey(note, index) : null;
  if (!key) return res.status(404).type('text/plain').send('No such image.');

  let object;
  try {
    object = await getObjectBuffer(key);
  } catch (err) {
    logger.warn('Share: note image missing from the media store', { key, err: err?.message });
    return res.status(404).type('text/plain').send('That image could not be found.');
  }
  res
    .type(object.contentType || 'image/webp')
    .set('Cache-Control', 'public, max-age=31536000, immutable')
    .send(object.buffer);
});
