import { z } from 'zod';

export const recipeRescueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional().default(5),
  dietary_preference: z.string().trim().max(100).optional().nullable()
});
