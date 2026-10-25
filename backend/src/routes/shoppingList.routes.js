import { Router } from 'express';
import { shoppingListController } from '../controllers/shoppingList.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireHousehold } from '../middleware/household.js';
import { validate } from '../middleware/validate.js';
import {
  createShoppingListItemSchema,
  updateShoppingListItemSchema,
  purchaseShoppingListItemSchema,
  evaluateDuplicateSchema,
  shoppingListItemIdParamSchema
} from '../schemas/shoppingList.schema.js';

const router = Router();

// Household-scoped routes protected by JWT authentication
router.use(authenticate, requireHousehold);

// GET /api/v1/shopping-list/recommendations - Smart Low-Stock & Consumption Recommendations
router.get(
  '/recommendations',
  shoppingListController.getRecommendations
);

// POST /api/v1/shopping-list/evaluate-duplicate - Pre-check item duplicates against pantry
router.post(
  '/evaluate-duplicate',
  validate({ body: evaluateDuplicateSchema }),
  shoppingListController.evaluateDuplicate
);

// POST /api/v1/shopping-list - Create shopping list item
router.post(
  '/',
  validate({ body: createShoppingListItemSchema }),
  shoppingListController.createItem
);

// GET /api/v1/shopping-list - List shopping list items
router.get(
  '/',
  shoppingListController.getItems
);

// GET /api/v1/shopping-list/:id - Get single shopping list item
router.get(
  '/:id',
  validate({ params: shoppingListItemIdParamSchema }),
  shoppingListController.getItemById
);

// PATCH /api/v1/shopping-list/:id - Update shopping list item
router.patch(
  '/:id',
  validate({ params: shoppingListItemIdParamSchema, body: updateShoppingListItemSchema }),
  shoppingListController.updateItem
);

// DELETE /api/v1/shopping-list/:id - Delete shopping list item
router.delete(
  '/:id',
  validate({ params: shoppingListItemIdParamSchema }),
  shoppingListController.deleteItem
);

// POST /api/v1/shopping-list/:id/purchase - Mark item purchased and update inventory
router.post(
  '/:id/purchase',
  validate({ params: shoppingListItemIdParamSchema, body: purchaseShoppingListItemSchema }),
  shoppingListController.markPurchased
);

export default router;
