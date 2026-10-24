import { z } from 'zod';

export const updateHouseholdSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  settings: z.record(z.any()).optional()
}).refine(data => data.name !== undefined || data.settings !== undefined, {
  message: 'Either name or settings must be provided'
});
