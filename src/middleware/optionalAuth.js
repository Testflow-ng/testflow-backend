import { verifyAccessToken } from '../services/token.service.js';
import { ACCESS_COOKIE } from '../config/cookies.js';
import { User } from '../models/User.js';
import { defaultActiveProduct } from '../utils/identity.js';
import { asyncHandler } from './asyncHandler.js';

/**
 * Attach `req.user` when a valid session is present, and continue silently when it is not.
 *
 * For endpoints a guest may also read but that answer differently for a signed-in user, such as
 * advertising eligibility. Never throws: a guest with a stale cookie is still a guest. Anything
 * that must be authenticated uses `authenticate` instead.
 */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const bearer = req.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const token = req.cookies?.[ACCESS_COOKIE] ?? bearer;
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).select('+tokenVersion');
    if (user && (user.tokenVersion ?? 0) === payload.tv) {
      req.user = user;
      req.activeProduct = defaultActiveProduct(user, payload.ap);
      req.authVia = req.cookies?.[ACCESS_COOKIE] ? 'cookie' : 'bearer';
    }
  } catch {
    // Ignored on purpose: an invalid token means an anonymous request here.
  }
  return next();
});
