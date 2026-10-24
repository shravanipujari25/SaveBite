import env from '../config/env.js';
import { logger } from '../config/logger.js';
import { intelligenceService } from './intelligence.service.js';

export class SchedulerService {
  constructor(dependencies = {}) {
    this.intelligenceService = dependencies.intelligenceService || intelligenceService;
    this.intervalMinutes = env.SCHEDULER_INTERVAL_MINUTES || 15;
    this.enabled = env.SCHEDULER_ENABLED;
    this.timerId = null;
    this.isRunning = false;
  }

  /**
   * Execute a single scheduled intelligence pass with concurrency protection.
   *
   * @returns {Promise<object|null>}
   */
  async runJob() {
    if (this.isRunning) {
      logger.warn('Previous intelligence job is still running; skipping overlapping cycle');
      return null;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('Scheduler triggered: executing intelligence job cycle');
      const result = await this.intelligenceService.processAllHouseholds();
      const durationMs = Date.now() - startTime;
      logger.info({ ...result, durationMs }, 'Scheduled intelligence cycle completed');
      return result;
    } catch (err) {
      // Unhandled failure in job must never crash the parent Express process
      const durationMs = Date.now() - startTime;
      logger.error({ error: err.message, stack: err.stack, durationMs }, 'Scheduled intelligence cycle encountered unexpected error');
      return null;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the scheduler background interval.
   */
  start() {
    if (!this.enabled) {
      logger.info('Scheduler is disabled by configuration (SCHEDULER_ENABLED=false)');
      return;
    }

    if (this.timerId) {
      logger.warn('Scheduler is already active');
      return;
    }

    const intervalMs = this.intervalMinutes * 60 * 1000;
    logger.info({ intervalMinutes: this.intervalMinutes, intervalMs }, 'Starting scheduled intelligence job runner');

    // Run first cycle after initial delay (e.g. 10 seconds after server startup)
    const initialDelayMs = 10000;
    setTimeout(() => {
      this.runJob().catch((err) => {
        logger.error({ error: err.message }, 'Error in initial scheduled intelligence run');
      });
    }, initialDelayMs);

    // Schedule regular cycles
    this.timerId = setInterval(() => {
      this.runJob().catch((err) => {
        logger.error({ error: err.message }, 'Error in scheduled intelligence interval tick');
      });
    }, intervalMs);

    // Allow process to exit cleanly if this is the only active timer
    if (this.timerId.unref) {
      this.timerId.unref();
    }
  }

  /**
   * Stop the background scheduler.
   */
  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      logger.info('Scheduler stopped');
    }
  }
}

export const schedulerService = new SchedulerService();
export default schedulerService;
