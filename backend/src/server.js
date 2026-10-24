import app from './app.js';
import env from './config/env.js';
import { logger } from './config/logger.js';

const PORT = env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(
    {
      port: PORT,
      nodeEnv: env.NODE_ENV,
      frontendUrl: env.FRONTEND_URL
    },
    'SaveBite Backend Server initialized successfully'
  );
});

// Graceful shutdown management
const gracefulShutdown = (signal) => {
  logger.info({ signal }, 'Termination signal received. Closing HTTP server gracefully...');
  server.close(() => {
    logger.info('HTTP server closed. Exiting process.');
    process.exit(0);
  });

  // Force close if connections refuse to terminate within 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown invoked due to hung connections.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Process-level safety guards
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught Exception detected! Initiating immediate exit.');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled Promise Rejection detected!');
  process.exit(1);
});

export default server;
