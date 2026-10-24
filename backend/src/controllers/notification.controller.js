import { notificationService } from '../services/notification.service.js';

export class NotificationController {
  constructor(service = notificationService) {
    this.notificationService = service;
  }

  /**
   * GET /api/v1/notifications
   * List household notifications.
   */
  getNotifications = async (req, res, next) => {
    try {
      const notifications = await this.notificationService.getNotifications(req.household.id, req.query);
      return res.status(200).json({
        status: 'success',
        data: { notifications }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * PATCH /api/v1/notifications/:id/read
   * Mark a notification as read.
   */
  markAsRead = async (req, res, next) => {
    try {
      const notification = await this.notificationService.markAsRead(req.household.id, req.params.id);
      return res.status(200).json({
        status: 'success',
        data: { notification }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * PATCH /api/v1/notifications/read-all
   * Mark all unread notifications as read.
   */
  markAllAsRead = async (req, res, next) => {
    try {
      const updated = await this.notificationService.markAllAsRead(req.household.id);
      return res.status(200).json({
        status: 'success',
        data: {
          count: updated.length,
          notifications: updated
        }
      });
    } catch (err) {
      return next(err);
    }
  };
}

export const notificationController = new NotificationController();
export default notificationController;
