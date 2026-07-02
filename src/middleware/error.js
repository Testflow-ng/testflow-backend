import { config } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

export const notFound = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route not found: ${req.method} ${req.originalUrl}`));
};

// Express identifies error handlers by their 4-arg signature; `next` must stay.
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  let statusCode = err.statusCode ?? 500;
  // Only surface an error's own code when it's an operational AppError, so
  // internal codes (e.g. driver 'ECONNREFUSED') never leak to clients.
  let code = err.isOperational && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR';
  let message = err.isOperational ? err.message : 'Something went wrong. Please try again.';

  if (err.name === 'ValidationError') {
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = 'Invalid input.';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    code = 'INVALID_ID';
    message = 'Invalid identifier.';
  } else if (err.code === 11000) {
    statusCode = 409;
    code = 'DUPLICATE';
    message = 'That resource already exists.';
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'UNAUTHENTICATED';
    message = 'Invalid or expired token.';
  }

  if (statusCode >= 500) {
    logger.error(err);
  }

  const body = { error: { code, message } };
  if (!config.isProduction && statusCode >= 500) {
    body.error.stack = err.stack;
  }
  res.status(statusCode).json(body);
};
