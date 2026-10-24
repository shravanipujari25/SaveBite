import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireHousehold } from '../middleware/household.js';

const router = Router();

// Protect all dashboard routes with custom JWT authentication and household membership verification
router.use(authenticate, requireHousehold);

// GET /api/v1/dashboard - Retrieve household-scoped analytics, metrics, and Use-First items
router.get('/', dashboardController.getDashboard);

export default router;
