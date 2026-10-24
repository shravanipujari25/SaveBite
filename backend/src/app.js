import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import env from './config/env.js';
import { httpLogger } from './config/logger.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler, AppError } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';

export const createApp = () => {
  const app = express();

  // Trust reverse proxies (e.g. Nginx, Fly.io, Render, Cloudflare) for accurate rate limiting and IP resolution
  app.set('trust proxy', 1);

  // Apply Helmet with cross-origin resource policy enabled for SPA API consumption
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  );

  // Parse configured frontend URLs and support comma-separated origins
  const configuredOrigins = [
    env.FRONTEND_URL,
    ...(process.env.ADDITIONAL_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim())
  ].filter(Boolean);

  const isOriginAllowed = (origin) => {
    // Permit server-to-server, curl, Postman, or local scripts
    if (!origin) return true;
    if (configuredOrigins.includes(origin)) return true;

    // In development or test, dynamically permit any localhost or 127.0.0.1 port (e.g. 5173, 5174, 5175, 3000)
    if (env.NODE_ENV !== 'production') {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return true;
      }
    }
    return false;
  };

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          return callback(null, true);
        }
        return callback(new AppError('CORS origin unauthorized', 403, 'CORS_REJECTED'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
      optionsSuccessStatus: 204
    })
  );

  // Redacted structured HTTP request logging
  app.use(httpLogger);

  // Global rate limiter
  app.use(globalLimiter);

  // Enforce strict body parsing limits to mitigate DoS / payload flooding
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // Request timeout protection (15 seconds default)
  app.use((req, res, next) => {
    req.setTimeout(15000, () => {
      const err = new AppError('Request timed out', 408, 'REQUEST_TIMEOUT');
      next(err);
    });
    next();
  });

  // Mount API v1 router
  app.use('/api/v1', apiRoutes);

  // Handle unmatched routes
  app.use(notFoundHandler);

  // Centralized error handler
  app.use(errorHandler);

  return app;
};

export const app = createApp();
export default app;
