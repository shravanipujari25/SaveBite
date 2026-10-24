import { Router } from 'express';
import { profileController } from '../controllers/profile.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { updateProfileSchema } from '../schemas/profile.schema.js';

const router = Router();

// Protect profile routes with custom JWT authentication
router.use(authenticate);

// GET /api/v1/profile - Get current user's profile
router.get(
  '/',
  profileController.getProfile
);

// PATCH /api/v1/profile - Update permitted profile fields
router.patch(
  '/',
  validate({ body: updateProfileSchema }),
  profileController.updateProfile
);

export default router;
