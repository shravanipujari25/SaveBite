import { z } from 'zod';

export const barcodeParamSchema = z.object({
  barcode: z
    .string()
    .trim()
    .regex(/^\d{8,14}$/, 'Barcode must be a numeric string containing between 8 and 14 digits')
});

export default {
  barcodeParamSchema
};
