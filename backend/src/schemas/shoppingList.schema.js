import { z } from 'zod';

export const createShoppingListItemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required').max(100),
  quantity: z.number().positive('Quantity must be greater than zero').optional().default(1),
  unit: z.string().trim().min(1).max(30).optional().default('piece'),
  category: z.string().trim().max(50).optional().default('other'),
  notes: z.string().trim().max(500).optional().nullable(),
  is_purchased: z.boolean().optional().default(false),
  status: z.enum(['needed', 'in_cart', 'purchased']).optional().default('needed'),
  estimated_price: z.number().nonnegative().optional().nullable(),
  recommendation_reason: z.string().max(255).optional().nullable(),
  source_type: z.enum(['manual', 'recommendation', 'recipe']).optional().default('manual')
});

export const updateShoppingListItemSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  quantity: z.number().positive('Quantity must be greater than zero').optional(),
  unit: z.string().trim().min(1).max(30).optional(),
  category: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  is_purchased: z.boolean().optional(),
  status: z.enum(['needed', 'in_cart', 'purchased']).optional(),
  estimated_price: z.number().nonnegative().optional().nullable(),
  recommendation_reason: z.string().max(255).optional().nullable()
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});

export const purchaseShoppingListItemSchema = z.object({
  purchased_quantity: z.number().positive('Purchased quantity must be greater than zero').optional(),
  purchase_price: z.number().nonnegative('Purchase price must be non-negative').optional().nullable(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be in YYYY-MM-DD format').optional().nullable(),
  storage_location: z.enum(['pantry', 'refrigerator', 'freezer', 'counter']).optional().default('pantry')
});

export const evaluateDuplicateSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required').max(100),
  quantity: z.number().positive().optional().default(1),
  unit: z.string().trim().max(30).optional().default('piece')
});

export const shoppingListItemIdParamSchema = z.object({
  id: z.string().uuid('Invalid shopping list item ID')
});
