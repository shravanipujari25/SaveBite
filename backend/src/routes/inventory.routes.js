import { Router } from 'express';
import { inventoryController } from '../controllers/inventory.controller.js';
import { freshnessController } from '../controllers/freshness.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireHousehold } from '../middleware/household.js';
import { validate } from '../middleware/validate.js';
import { uploadFreshnessImage } from '../middleware/upload.js';
import {
  createItemSchema,
  updateItemSchema,
  queryInventorySchema,
  consumeItemSchema,
  wasteItemSchema,
  manualPurchaseSchema,
  itemIdParamSchema
} from '../schemas/inventory.schema.js';
import { useIngredientsSchema } from '../schemas/useIngredients.schema.js';
import { uploadLimiter, aiLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Protect all inventory routes with custom JWT authentication and household membership verification
router.use(authenticate, requireHousehold);

// POST /api/v1/inventory/use-ingredients - Multi-item recipe consumption with avoided-waste calculation
router.post(
  '/use-ingredients',
  validate({ body: useIngredientsSchema }),
  inventoryController.useIngredients
);

// POST /api/v1/inventory/manual-purchase - Log manual grocery haul / pantry addition
router.post(
  '/manual-purchase',
  validate({ body: manualPurchaseSchema }),
  inventoryController.manualPurchase
);

// POST /api/v1/inventory - Create new inventory item
router.post(
  '/',
  validate({ body: createItemSchema }),
  inventoryController.createItem
);

// GET /api/v1/inventory - List inventory items with filtering and pagination
router.get(
  '/',
  validate({ query: queryInventorySchema }),
  inventoryController.getItems
);

// GET /api/v1/inventory/:itemId - Get single inventory item
router.get(
  '/:itemId',
  validate({ params: itemIdParamSchema }),
  inventoryController.getItemById
);

// PATCH /api/v1/inventory/:itemId - Update permitted fields of an item
router.patch(
  '/:itemId',
  validate({ params: itemIdParamSchema, body: updateItemSchema }),
  inventoryController.updateItem
);

// DELETE /api/v1/inventory/:itemId - Soft delete / archive an item
router.delete(
  '/:itemId',
  validate({ params: itemIdParamSchema }),
  inventoryController.archiveItem
);

// POST /api/v1/inventory/:itemId/consume - Consume stock
router.post(
  '/:itemId/consume',
  validate({ params: itemIdParamSchema, body: consumeItemSchema }),
  inventoryController.consumeItem
);

// POST /api/v1/inventory/:itemId/waste - Log waste event
router.post(
  '/:itemId/waste',
  validate({ params: itemIdParamSchema, body: wasteItemSchema }),
  inventoryController.wasteItem
);

// POST /api/v1/inventory/:itemId/open - Mark package as opened
router.post(
  '/:itemId/open',
  validate({ params: itemIdParamSchema }),
  inventoryController.openItem
);

// POST /api/v1/inventory/:itemId/freshness-scan - Analyze food freshness via camera image
router.post(
  '/:itemId/freshness-scan',
  uploadLimiter,
  aiLimiter,
  validate({ params: itemIdParamSchema }),
  uploadFreshnessImage,
  freshnessController.scanFreshness
);

export default router;
