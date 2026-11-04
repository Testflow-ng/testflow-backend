import { verifyAccessToken } from '../services/token.service.js';
import { ORG_ACCESS_COOKIE } from '../config/cookies.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from './asyncHandler.js';

/** The session on an organisation's site: its own cookie, never the Testflow one. Attaches `req.user`. */
export const tenantAuthenticate = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[ORG_ACCESS_COOKIE];
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }
  if (!payload.org) throw new AppError(401, 'UNAUTHENTICATED', 'Your session is no longer valid.');
  const user = await User.findById(payload.sub).select('+role');
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Your session is no longer valid.');
  req.user = user;
  req.activeProduct = 'student';
  req.authVia = 'cookie';
  return next();
});
