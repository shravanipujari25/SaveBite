import { Router } from 'express';
import { telemetryController } from '../controllers/telemetry.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireHousehold } from '../middleware/household.js';
import { validate } from '../middleware/validate.js';
import { telemetryLimiter } from '../middleware/rateLimit.js';
import { ingestTelemetrySchema } from '../schemas/telemetry.schema.js';

const router = Router();

// Protect HTTP telemetry ingestion with JWT authentication and household verification
router.use(authenticate, requireHousehold);

// POST /api/v1/telemetry - Ingest sensor readings via HTTP
router.post(
  '/',
  telemetryLimiter,
  validate({ body: ingestTelemetrySchema }),
  telemetryController.ingest
);

export default router;
