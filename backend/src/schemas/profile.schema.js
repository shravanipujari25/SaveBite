import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name cannot be empty').max(100).optional(),
  avatar_url: z.string().trim().url('Invalid avatar URL').or(z.literal('')).optional().nullable(),
  preferences: z.record(z.any()).optional().nullable()
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});
