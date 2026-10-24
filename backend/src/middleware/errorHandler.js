import { logger } from '../config/logger.js';

/**
 * Standard Application Error class for controlled operational errors
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 Route Not Found Handler
 */
export const notFoundHandler = (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`
    }
  });
};

/**
 * Centralized Global Error Handler
 */
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  // Handle payload too large from body-parser
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      status: 'error',
      message: 'Request payload exceeds allowable limit',
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload exceeds allowable limit'
      }
    });
  }

  // Handle syntax error (e.g. malformed JSON in request body)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid JSON payload received',
      error: {
        code: 'MALFORMED_JSON',
        message: 'Invalid JSON payload received'
      }
    });
  }

  // Operational error thrown explicitly by application logic
  if (err.isOperational) {
    logger.warn({ err, code: err.code, statusCode: err.statusCode }, err.message);
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {})
      }
    });
  }

  // Unexpected internal server error - log stack trace, NEVER leak to client
  logger.error({ err }, 'Unhandled server exception occurred');

  return res.status(500).json({
    status: 'error',
    message: 'An unexpected internal error occurred. Please try again later.',
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred. Please try again later.'
    }
  });
};

export default {
  AppError,
  notFoundHandler,
  errorHandler
};
