import { Router } from 'express';
import { recipeController } from '../controllers/recipe.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireHousehold } from '../middleware/household.js';
import { validate } from '../middleware/validate.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { recipeRescueQuerySchema } from '../schemas/recipe.schema.js';

const router = Router();

// Protect recipe rescue route with authentication and household verification
router.use(authenticate, requireHousehold);

// GET /api/v1/recipes/rescue - Get recipe rescue suggestions
router.get(
  '/rescue',
  aiLimiter,
  validate({ query: recipeRescueQuerySchema }),
  recipeController.rescueRecipes
);

export default router;
