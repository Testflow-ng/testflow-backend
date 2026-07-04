import { AppError } from '../utils/AppError.js';

/** Restrict a route to one or more roles. Use after `authenticate`. */
export const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
    }

    const userRole = req.user.role;

    // Super admins have access to everything that an admin can do.
    const isAllowed = roles.includes(userRole) || (roles.includes('admin') && userRole === 'super_admin');

    if (!isAllowed) {
      return next(new AppError(403, 'FORBIDDEN', 'You do not have access to this resource.'));
    }
    return next();
  };
