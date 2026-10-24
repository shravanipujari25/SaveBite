import { z } from 'zod';

export const analyticsPeriodQuerySchema = z.object({
  period: z.enum(['week', 'month', 'year', 'custom']).optional().default('month'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'start_date must be YYYY-MM-DD').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'end_date must be YYYY-MM-DD').optional()
});

export const monthlyComparisonQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM').optional()
});
