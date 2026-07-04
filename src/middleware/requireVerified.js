import { AppError } from '../utils/AppError.js';
import { config } from '../config/env.js';

/**
 * Block integrity-critical actions until the user has verified their email.
 * Logic disabled per request: emails are no longer used for verification.
 */
export const requireVerified = (_req, _res, next) => {
  return next();
};
