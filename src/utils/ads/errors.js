import { AppError } from '../AppError.js';

/** 422 with the same `{ error: { code, message, fields } }` shape as the validate middleware. */
export const validationError = (fields) => {
  const err = new AppError(422, 'VALIDATION_ERROR', Object.values(fields)[0] ?? 'Invalid input.');
  err.fields = fields;
  return err;
};

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
