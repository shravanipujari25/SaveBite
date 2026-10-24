import { Router } from 'express';
import { analyticsController } from '../controllers/analytics.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireHousehold } from '../middleware/household.js';
import { validate } from '../middleware/validate.js';
import {
  analyticsPeriodQuerySchema,
  monthlyComparisonQuerySchema
} from '../schemas/analytics.schema.js';

const router = Router();

// All analytics routes require authentication and household membership
router.use(authenticate, requireHousehold);

// GET /api/v1/analytics/waste - Waste summary by period
router.get(
  '/waste',
  validate({ query: analyticsPeriodQuerySchema }),
  analyticsController.getWasteAnalytics
);

// GET /api/v1/analytics/most-wasted - Most wasted items
router.get(
  '/most-wasted',
  validate({ query: analyticsPeriodQuerySchema }),
  analyticsController.getMostWasted
);

// GET /api/v1/analytics/savings - Avoided waste savings
router.get(
  '/savings',
  validate({ query: analyticsPeriodQuerySchema }),
  analyticsController.getSavingsAnalytics
);

// GET /api/v1/analytics/monthly-comparison - Month-over-month comparison
router.get(
  '/monthly-comparison',
  validate({ query: monthlyComparisonQuerySchema }),
  analyticsController.getMonthlyComparison
);

export default router;
