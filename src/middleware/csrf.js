import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { CSRF_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE } from '../config/cookies.js';
import { AppError } from '../utils/AppError.js';
import { isAllowedOrigin } from '../utils/origins.js';
import { logger } from '../utils/logger.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
// Server-to-server / pre-session endpoints: no ambient cookie authority to forge.
const SKIP_ALL = ['/api/ads/payments/webhook'];
const SKIP_TOKEN = ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password',
  '/api/auth/verify-email', '/api/auth/resend-verification', '/api/auth/oauth/token', '/api/ads/auth/login', '/api/ads/auth/register'];

const same = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * CSRF protection for cookie sessions (needed because the session cookie is
 * shared across subdomains, which are "same-site" and so bypass SameSite=Lax).
 *  1. Origin check (always on): an unsafe request carrying an Origin header must
 *     come from an allow-listed origin. Browsers always send Origin on unsafe
 *     cross-origin requests; non-browser clients send none and are unaffected.
 *  2. Double-submit token: with a session cookie present, `X-CSRF-Token` must
 *     equal the `tf_csrf` cookie. Mode via CSRF_TOKEN_MODE: off | log | enforce.
 */
export const csrfProtect = (req, _res, next) => {
  if (SAFE.has(req.method)) return next();
  const url = req.originalUrl.split('?')[0];
  if (SKIP_ALL.includes(url)) return next();

  const origin = req.get('origin');
  if (origin && !isAllowedOrigin(origin.replace(/\/$/, ''))) {
    return next(new AppError(403, 'CSRF_ORIGIN', 'Request origin is not allowed.'));
  }

  if (req.get('authorization')?.startsWith('Bearer ')) return next(); // not cookie-based
  if (config.CSRF_TOKEN_MODE === 'off' || SKIP_TOKEN.includes(url)) return next();
  if (!req.cookies?.[ACCESS_COOKIE] && !req.cookies?.[REFRESH_COOKIE]) return next();

  if (same(req.get('x-csrf-token'), req.cookies?.[CSRF_COOKIE])) return next();
  if (config.CSRF_TOKEN_MODE === 'enforce') {
    return next(new AppError(403, 'CSRF_TOKEN', 'Missing or invalid CSRF token.'));
  }
  logger.warn(`[csrf] token missing/invalid (log mode) ${req.method} ${url}`);
  return next();
};
