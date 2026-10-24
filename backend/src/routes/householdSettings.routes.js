import { Router } from 'express';
import { householdSettingsController } from '../controllers/householdSettings.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireHousehold } from '../middleware/household.js';
import { validate } from '../middleware/validate.js';
import { updateHouseholdSettingsSchema } from '../schemas/householdSettings.schema.js';

const router = Router();

// Household settings routes require authentication and household membership
router.use(authenticate, requireHousehold);

// GET /api/v1/household/settings - Get settings and members
router.get(
  '/',
  householdSettingsController.getSettings
);

// PATCH /api/v1/household/settings - Update settings (restricted to owner/admin)
router.patch(
  '/',
  validate({ body: updateHouseholdSettingsSchema }),
  householdSettingsController.updateSettings
);

export default router;
