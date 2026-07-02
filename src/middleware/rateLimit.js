import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

const message = (code, text) => ({ error: { code, message: text } });

/** Baseline limiter for the whole API. */
export const apiLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('RATE_LIMITED', 'Too many requests. Please slow down.'),
});

/** Strict limiter for auth surfaces (brute-force / enumeration / email-bomb). */
export const authLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('RATE_LIMITED', 'Too many attempts. Please try again later.'),
});
