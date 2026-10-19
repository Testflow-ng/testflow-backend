import multer from 'multer';
import { AppError } from '../utils/AppError.js';

/**
 * A single in-memory image upload, used by the site builder and the question bank.
 *
 * The file is held in memory rather than on disk: it is re-encoded by `sharp` and sent straight to
 * the media store, so nothing is left behind if the request is rejected. The 2 MB ceiling matches
 * what the console advertises, and the size error is translated so the client sees the same code
 * the validator would have produced.
 */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 6 } });

export const singleImage = (field = 'file') => (req, res, next) =>
  upload.single(field)(req, res, (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD';
      return next(new AppError(422, code, 'Send one image of 2 MB or less in the "file" field.'));
    }
    return next();
  });

/** One CSV or ZIP import, held in memory and never written to disk. */
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4 } });

export const singleImport = (field = 'file') => (req, res, next) =>
  importUpload.single(field)(req, res, (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD';
      return next(new AppError(422, code, 'Send one CSV or ZIP file of 10 MB or less in the "file" field.'));
    }
    return next();
  });
