import { AppError } from '../utils/AppError.js';
import { hasMembership, isJoinable } from '../utils/identity.js';

/** Require the account to hold a membership of `product` (optionally with a specific product role). Use after `authenticate`. */
export const requireMembership = (product, role) => (req, _res, next) => {
  if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
  if (!hasMembership(req.user, product, role)) {
    const err = new AppError(403, 'NO_MEMBERSHIP', `Your account does not have access to ${product}.`);
    err.details = { product, canJoin: isJoinable(product) };
    return next(err);
  }
  return next();
};
