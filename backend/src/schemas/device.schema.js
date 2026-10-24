import { z } from 'zod';

const ALLOWED_DEVICE_TYPES = ['esp32', 'sensor_node', 'simulator', 'other'];
const ALLOWED_ZONES = ['refrigerator', 'freezer', 'pantry', 'counter', 'other'];
const ALLOWED_SOURCE_TYPES = ['physical', 'simulator'];
const ALLOWED_STATUSES = ['active', 'inactive', 'maintenance'];

export const createDeviceSchema = z.object({
  name: z.string().trim().min(1, 'Device name is required').max(100),
  device_code: z.string().trim().min(1, 'Device code is required').max(64),
  device_type: z.enum(ALLOWED_DEVICE_TYPES).default('esp32'),
  zone: z.enum(ALLOWED_ZONES).default('refrigerator'),
  source_type: z.enum(ALLOWED_SOURCE_TYPES).default('physical')
});

export const queryDevicesSchema = z.object({
  zone: z.enum(ALLOWED_ZONES).optional(),
  status: z.enum(['active', 'inactive', 'maintenance', 'all']).default('all'),
  source_type: z.enum(ALLOWED_SOURCE_TYPES).optional()
});

export const deviceIdParamSchema = z.object({
  id: z.string().uuid('Invalid device UUID format')
});
