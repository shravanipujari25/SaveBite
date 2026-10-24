import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireHousehold } from '../middleware/household.js';
import { validate } from '../middleware/validate.js';
import { queryNotificationsSchema, notificationIdParamSchema } from '../schemas/notification.schema.js';

const router = Router();

// Protect notification endpoints with JWT authentication and household verification
router.use(authenticate, requireHousehold);

// GET /api/v1/notifications - List household notifications
router.get(
  '/',
  validate({ query: queryNotificationsSchema }),
  notificationController.getNotifications
);

// PATCH /api/v1/notifications/:id/read - Mark notification as read
router.patch(
  '/:id/read',
  validate({ params: notificationIdParamSchema }),
  notificationController.markAsRead
);

export default router;
