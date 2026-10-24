import { z } from 'zod';

const ALLOWED_SOURCE_TYPES = ['physical', 'simulator'];

export const ingestTelemetrySchema = z.object({
  device_code: z.string().trim().min(1, 'device_code is required').max(64),
  recorded_at: z
    .string()
    .datetime({ offset: true, message: 'recorded_at must be an ISO 8601 timestamp' })
    .optional()
    .refine((val) => {
      if (!val) return true;
      const date = new Date(val);
      const now = new Date();
      // Reject unreasonable future timestamps (more than 10 minutes ahead)
      return date.getTime() <= now.getTime() + 10 * 60 * 1000;
    }, { message: 'recorded_at timestamp cannot be in the future' }),
  source_type: z.enum(ALLOWED_SOURCE_TYPES).default('physical'),
  readings: z.object({
    temperature_c: z
      .number({ invalid_type_error: 'temperature_c must be a valid number' })
      .finite('temperature_c cannot be NaN or Infinity')
      .min(-50.0, 'temperature_c cannot be below -50.0°C')
      .max(100.0, 'temperature_c cannot exceed 100.0°C')
      .optional()
      .nullable(),
    humidity_percent: z
      .number({ invalid_type_error: 'humidity_percent must be a valid number' })
      .finite('humidity_percent cannot be NaN or Infinity')
      .min(0.0, 'humidity_percent cannot be below 0%')
      .max(100.0, 'humidity_percent cannot exceed 100%')
      .optional()
      .nullable(),
    air_quality_raw: z
      .number({ invalid_type_error: 'air_quality_raw must be a valid number' })
      .finite('air_quality_raw cannot be NaN or Infinity')
      .min(0.0, 'air_quality_raw must be non-negative')
      .optional()
      .nullable(),
    air_quality_unit: z.string().trim().max(32).optional(),
    air_quality_index: z
      .number({ invalid_type_error: 'air_quality_index must be a valid number' })
      .finite('air_quality_index cannot be NaN or Infinity')
      .optional()
      .nullable()
  }).default({}),
  metadata: z.record(z.any()).default({})
});

export const queryReadingsSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  source_type: z.enum(ALLOWED_SOURCE_TYPES).optional()
}).refine((data) => {
  if (data.from && data.to) {
    return new Date(data.from) <= new Date(data.to);
  }
  return true;
}, {
  message: "'from' timestamp must be earlier than or equal to 'to' timestamp",
  path: ['from']
});
