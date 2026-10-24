import { notificationRepository } from '../repositories/notification.repository.js';
import { logger } from '../config/logger.js';

export class NotificationService {
  constructor(repository = notificationRepository) {
    this.notificationRepo = repository;
  }

  /**
   * List notifications for a household with optional filters.
   *
   * @param {string} householdId
   * @param {object} [queryParams]
   * @returns {Promise<object[]>}
   */
  async getNotifications(householdId, queryParams = {}) {
    return this.notificationRepo.findByHousehold(householdId, queryParams);
  }

  /**
   * Mark a notification as read for a household.
   *
   * @param {string} householdId
   * @param {string} notificationId
   * @returns {Promise<object>}
   */
  async markAsRead(householdId, notificationId) {
    const updated = await this.notificationRepo.markAsRead(notificationId, householdId);
    logger.info({ notificationId, householdId }, 'Notification marked as read');
    return updated;
  }

  /**
   * Mark all unread notifications as read for a household.
   *
   * @param {string} householdId
   * @returns {Promise<object[]>}
   */
  async markAllAsRead(householdId) {
    const updated = await this.notificationRepo.markAllAsRead(householdId);
    logger.info({ householdId, count: updated.length }, 'All notifications marked as read');
    return updated;
  }
}

export const notificationService = new NotificationService();
export default notificationService;
