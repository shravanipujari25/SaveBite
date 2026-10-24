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

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const receiptIdParamSchema = z.object({
  receiptId: z.string().uuid('receiptId must be a valid UUID')
});

export const lineIdParamSchema = z.object({
  receiptId: z.string().uuid('receiptId must be a valid UUID'),
  lineId: z.string().uuid('lineId must be a valid UUID')
});

export const confirmReceiptItemSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Product name cannot be empty')
    .max(100, 'Product name cannot exceed 100 characters')
    .optional(),
  category: z.enum(ALLOWED_CATEGORIES).optional(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero').optional(),
  unit: z.enum(ALLOWED_UNITS).optional(),
  storage_location: z.enum(ALLOWED_STORAGE_LOCATIONS).optional(),
  purchase_date: z.string().regex(DATE_REGEX, 'purchase_date must be formatted YYYY-MM-DD').optional().nullable(),
  expiry_date: z.string().regex(DATE_REGEX, 'expiry_date must be formatted YYYY-MM-DD').optional().nullable(),
  estimated_unit_price: z.coerce.number().nonnegative('estimated_unit_price must be non-negative').optional().nullable()
});

export default {
  receiptIdParamSchema,
  lineIdParamSchema,
  confirmReceiptItemSchema
};
