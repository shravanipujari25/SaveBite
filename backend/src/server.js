import app from './app.js';
import env from './config/env.js';
import { logger } from './config/logger.js';
import { mqttSubscriberService } from './services/mqttSubscriber.service.js';
import { schedulerService } from './services/scheduler.service.js';

const PORT = env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(
    {
      port: PORT,
      nodeEnv: env.NODE_ENV,
      frontendUrl: env.FRONTEND_URL,
      mqttEnabled: env.MQTT_ENABLED,
      schedulerEnabled: env.SCHEDULER_ENABLED
    },
    'SaveBite Backend Server initialized successfully'
  );

  // Initialize optional MQTT subscriber
  mqttSubscriberService.start();

  // Initialize scheduled intelligence runner
  schedulerService.start();
});

// Graceful shutdown management
const gracefulShutdown = async (signal) => {
  logger.info({ signal }, 'Termination signal received. Closing server gracefully...');

  try {
    schedulerService.stop();
  } catch (schedErr) {
    logger.warn({ schedErr: schedErr.message }, 'Error stopping scheduler');
  }

  try {
    await mqttSubscriberService.stop();
  } catch (mqttErr) {
    logger.warn({ mqttErr: mqttErr.message }, 'Error stopping MQTT subscriber');
  }

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
