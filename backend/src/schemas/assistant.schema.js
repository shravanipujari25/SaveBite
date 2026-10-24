import { z } from 'zod';

export const assistantChatSchema = z.object({
  message: z.string().trim().min(1, 'Message cannot be empty').max(2000, 'Message cannot exceed 2000 characters'),
  include_inventory: z.boolean().optional().default(true),
  conversation_id: z.string().trim().max(100).optional().nullable()
});
