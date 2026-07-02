import { AppError } from '../utils/AppError.js';

/** Restrict a route to one or more roles. Use after `authenticate`. */
export const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'You do not have access to this resource.'));
    }
    return next();
  };
