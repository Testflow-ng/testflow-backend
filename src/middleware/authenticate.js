import { verifyAccessToken } from '../services/token.service.js';
import { ACCESS_COOKIE } from '../config/cookies.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from './asyncHandler.js';

/** Require a valid access cookie; attaches the current user to `req.user`. */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || (user.tokenVersion ?? 0) !== payload.tv) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Your session is no longer valid.');
  }

  req.user = user;
  return next();
});
