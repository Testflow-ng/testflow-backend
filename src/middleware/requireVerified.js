import { AppError } from '../utils/AppError.js';
import { config } from '../config/env.js';

/**
 * Block integrity-critical actions (e.g. starting/submitting an exam) until the
 * user has verified their email. Login itself is not blocked. Use after
 * `authenticate`.
 */
export const requireVerified = (req, _res, next) => {
  // Bypass verification in development so the team can test without real SMTP
  if (!config.isProduction) {
    return next();
  }

  if (!req.user?.isEmailVerified) {
    return next(new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email to continue.'));
  }
  return next();
};
