import { z } from 'zod';

export const useIngredientsItemSchema = z.object({
  inventory_item_id: z.string().uuid('Invalid inventory item ID'),
  quantity: z.number().positive('Quantity must be greater than zero')
});

export const useIngredientsSchema = z.object({
  items: z.array(useIngredientsItemSchema).min(1, 'At least one ingredient must be specified'),
  source: z.string().max(50).optional().default('recipe_rescue'),
  recipe_name: z.string().max(100).optional().nullable()
});
