/**
 * Operational error with an HTTP status and a stable machine-readable code.
 * Thrown by services/middleware and mapped to a response by the error handler.
 */
export class AppError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
