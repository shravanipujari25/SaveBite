import { z } from 'zod';

const ALLOWED_NOTIFICATION_TYPES = ['threshold_alert', 'operational', 'system', 'inventory'];

export const queryNotificationsSchema = z.object({
  is_read: z
    .preprocess((val) => {
      if (val === 'true' || val === true) return true;
      if (val === 'false' || val === false) return false;
      return undefined;
    }, z.boolean().optional())
    .optional(),
  type: z.enum(ALLOWED_NOTIFICATION_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const notificationIdParamSchema = z.object({
  id: z.string().uuid('Invalid notification UUID format')
});
