import { z } from 'zod';

const ALLOWED_CATEGORIES = [
  'produce',
  'dairy',
  'bakery',
  'meat',
  'pantry',
  'beverages',
  'frozen',
  'leftovers',
  'snacks',
  'other'
];

const ALLOWED_UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'pack',
  'oz',
  'lb',
  'can',
  'bottle',
  'item',
  'serving'
];

const ALLOWED_STORAGE_LOCATIONS = [
  'refrigerator',
  'freezer',
  'pantry',
  'counter',
  'other'
];

const ALLOWED_WASTE_REASONS = [
  'expired',
  'spoiled',
  'damaged',
  'leftover',
  'other'
];

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const createItemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required').max(100, 'Item name cannot exceed 100 characters'),
  category: z.enum(ALLOWED_CATEGORIES).default('other'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero').default(1),
  unit: z.enum(ALLOWED_UNITS).default('piece'),
  purchase_date: z.string().regex(DATE_REGEX, 'purchase_date must be formatted YYYY-MM-DD').optional().nullable(),
  expiry_date: z.string().regex(DATE_REGEX, 'expiry_date must be formatted YYYY-MM-DD').optional().nullable(),
  storage_location: z.enum(ALLOWED_STORAGE_LOCATIONS).default('pantry'),
  estimated_unit_price: z.coerce.number().nonnegative('estimated_unit_price must be non-negative').optional().nullable(),
  currency: z.string().trim().toUpperCase().length(3, 'Currency must be a 3-letter code').default('USD')
});

export const updateItemSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  category: z.enum(ALLOWED_CATEGORIES).optional(),
  quantity: z.coerce.number().nonnegative('Quantity must be non-negative').optional(),
  unit: z.enum(ALLOWED_UNITS).optional(),
  purchase_date: z.string().regex(DATE_REGEX).optional().nullable(),
  expiry_date: z.string().regex(DATE_REGEX).optional().nullable(),
  storage_location: z.enum(ALLOWED_STORAGE_LOCATIONS).optional(),
  estimated_unit_price: z.coerce.number().nonnegative().optional().nullable(),
  currency: z.string().trim().toUpperCase().length(3).optional()
}).strict({
  message: 'Updates to protected fields (id, household_id, created_by, status) are strictly prohibited'
});

export const queryInventorySchema = z.object({
  search: z.string().trim().optional(),
  name: z.string().trim().optional(),
  category: z.enum(ALLOWED_CATEGORIES).optional(),
  storage_location: z.enum(ALLOWED_STORAGE_LOCATIONS).optional(),
  status: z.enum(['active', 'consumed', 'wasted', 'archived', 'all']).default('active'),
  expiring_before: z.string().regex(DATE_REGEX).optional(),
  page: z.coerce.number().int().min(1, 'page must be >= 1').default(1),
  limit: z.coerce.number().int().min(1, 'limit must be >= 1').max(100, 'limit cannot exceed 100').default(20),
  sort_by: z.enum(['expiry_date', 'name', 'created_at', 'quantity']).default('expiry_date'),
  order: z.enum(['asc', 'desc']).default('asc')
});

export const consumeItemSchema = z.object({
  quantity: z.coerce.number().positive('Quantity to consume must be greater than zero'),
  unit: z.string().trim().optional()
});

export const wasteItemSchema = z.object({
  quantity: z.coerce.number().positive('Quantity to waste must be greater than zero'),
  unit: z.string().trim().optional(),
  reason: z.enum(ALLOWED_WASTE_REASONS, {
    errorMap: () => ({ message: `reason must be one of: ${ALLOWED_WASTE_REASONS.join(', ')}` })
  })
});

export const manualPurchaseSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required').max(100),
  category: z.enum(ALLOWED_CATEGORIES).default('other'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero').default(1),
  unit: z.enum(ALLOWED_UNITS).default('piece'),
  purchase_date: z.string().regex(DATE_REGEX, 'purchase_date must be formatted YYYY-MM-DD').optional().nullable(),
  expiry_date: z.string().regex(DATE_REGEX, 'expiry_date must be formatted YYYY-MM-DD').optional().nullable(),
  storage_location: z.enum(ALLOWED_STORAGE_LOCATIONS).default('pantry'),
  estimated_unit_price: z.coerce.number().nonnegative('Price must be non-negative').optional().nullable(),
  currency: z.string().trim().toUpperCase().length(3).default('USD')
});

export const itemIdParamSchema = z.object({
  itemId: z.string().uuid('Invalid item UUID format')
});
