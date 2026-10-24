import { z } from 'zod';

export const createShoppingListItemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required').max(100),
  quantity: z.number().positive('Quantity must be greater than zero').optional().default(1),
  unit: z.string().trim().min(1).max(30).optional().default('piece'),
  category: z.string().trim().max(50).optional().default('other'),
  notes: z.string().trim().max(500).optional().nullable(),
  is_purchased: z.boolean().optional().default(false)
});

export const updateShoppingListItemSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().trim().min(1).max(30).optional(),
  category: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  is_purchased: z.boolean().optional()
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});

export const shoppingListItemIdParamSchema = z.object({
  id: z.string().uuid('Invalid shopping list item ID')
});
