import { verifyAccessToken } from '../services/token.service.js';
import { ACCESS_COOKIE } from '../config/cookies.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { defaultActiveProduct } from '../utils/identity.js';
import { asyncHandler } from './asyncHandler.js';

/**
 * Require a valid session: the httpOnly access cookie, or an
 * `Authorization: Bearer` access token (issued by the code+PKCE exchange for
 * other domains). Attaches `req.user` and `req.activeProduct`.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const bearer = req.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const token = req.cookies?.[ACCESS_COOKIE] ?? bearer;
  if (!token) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }

  const user = await User.findById(payload.sub).select('+tokenVersion +role');
  if (!user || (user.tokenVersion ?? 0) !== payload.tv) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Your session is no longer valid.');
  }

  req.user = user;
  req.activeProduct = defaultActiveProduct(user, payload.ap); // falls back if the claimed context is no longer valid
  req.authVia = req.cookies?.[ACCESS_COOKIE] ? 'cookie' : 'bearer';
  return next();
});
