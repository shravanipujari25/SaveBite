import { Router } from 'express';
import { deviceController } from '../controllers/device.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireHousehold } from '../middleware/household.js';
import { validate } from '../middleware/validate.js';
import { createDeviceSchema, queryDevicesSchema, deviceIdParamSchema } from '../schemas/device.schema.js';
import { queryReadingsSchema } from '../schemas/telemetry.schema.js';
import { createPairingTokenSchema, pairDeviceSchema } from '../schemas/pairing.schema.js';

const router = Router();

// Protect all device endpoints with JWT authentication and household verification
router.use(authenticate, requireHousehold);

// POST /api/v1/devices/pairing-token - Generate ephemeral pairing token
router.post(
  '/pairing-token',
  validate({ body: createPairingTokenSchema }),
  deviceController.createPairingToken
);

// POST /api/v1/devices/pair - Pair hardware IoT node using token
router.post(
  '/pair',
  validate({ body: pairDeviceSchema }),
  deviceController.pairDevice
);

// POST /api/v1/devices - Register new sensor device
router.post(
  '/',
  validate({ body: createDeviceSchema }),
  deviceController.createDevice
);

// GET /api/v1/devices - List devices for the household
router.get(
  '/',
  validate({ query: queryDevicesSchema }),
  deviceController.getDevices
);

// GET /api/v1/devices/:id/readings - Retrieve historical readings for a device
router.get(
  '/:id/readings',
  validate({ params: deviceIdParamSchema, query: queryReadingsSchema }),
  deviceController.getReadings
);

// GET /api/v1/devices/:id - Retrieve single device details
router.get(
  '/:id',
  validate({ params: deviceIdParamSchema }),
  deviceController.getDeviceById
);

export default router;
