import rateLimit from 'express-rate-limit';
import env from '../config/env.js';

/**
 * Standard error response generator for rate limiting
 */
const rateLimitHandler = (req, res) => {
  res.status(429).json({
    status: 'error',
    message: 'Too many requests. Please try again later.',
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests. Please try again later.'
    }
  });
};

/**
 * Global rate limiter for all general API endpoints.
 */
export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => env.NODE_ENV === 'test'
});

/**
 * Stricter rate limiter specifically protecting authentication endpoints
 * against brute-force, credential stuffing, and abuse.
 */
export const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => env.NODE_ENV === 'test'
});

/**
 * Rate limiter for computationally expensive AI-backed operations
 * (e.g. recipe rescue, assistant chat, freshness vision analysis).
 */
export const aiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AI_RATE_LIMIT_MAX || 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => env.NODE_ENV === 'test'
});

/**
 * High-throughput rate limiter for IoT telemetry ingestion.
 */
export const telemetryLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.TELEMETRY_RATE_LIMIT_MAX || 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => env.NODE_ENV === 'test'
});

/**
 * Rate limiter for multipart file uploads (receipt scans, camera uploads).
 */
export const uploadLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.UPLOAD_RATE_LIMIT_MAX || 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => env.NODE_ENV === 'test'
});

/**
 * Configurable rate limiter factory for testing or custom endpoints
 */
export const createLimiter = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitHandler,
    ...options
  });
};

export default {
  globalLimiter,
  authLimiter,
  aiLimiter,
  telemetryLimiter,
  uploadLimiter,
  createLimiter
};
