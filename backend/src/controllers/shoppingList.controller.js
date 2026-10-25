import { shoppingListService } from '../services/shoppingList.service.js';

export class ShoppingListController {
  constructor(service = shoppingListService) {
    this.service = service;
  }

  /**
   * POST /api/v1/shopping-list
   * Create new shopping list item with duplicate / overbuy warnings.
   */
  createItem = async (req, res, next) => {
    try {
      const result = await this.service.createItem(
        req.household.id,
        req.user.id,
        req.body
      );
      return res.status(201).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/shopping-list
   * List shopping list items for household.
   */
  getItems = async (req, res, next) => {
    try {
      const items = await this.service.getItems(req.household.id, req.query);
      return res.status(200).json({
        status: 'success',
        data: { items }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/shopping-list/recommendations
   * Generate low-stock and consumption-based grocery recommendations.
   */
  getRecommendations = async (req, res, next) => {
    try {
      const result = await this.service.getRecommendations(req.household.id, req.query);
      return res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * POST /api/v1/shopping-list/evaluate-duplicate
   * Pre-check item against pantry inventory and active lists before adding.
   */
  evaluateDuplicate = async (req, res, next) => {
    try {
      const { name, quantity, unit } = req.body;
      const result = await this.service.evaluateDuplicates(
        req.household.id,
        name,
        quantity,
        unit
      );
      return res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/shopping-list/:id
   * Get single shopping list item by ID.
   */
  getItemById = async (req, res, next) => {
    try {
      const item = await this.service.getItemById(req.household.id, req.params.id);
      return res.status(200).json({
        status: 'success',
        data: { item }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * PATCH /api/v1/shopping-list/:id
   * Update shopping list item.
   */
  updateItem = async (req, res, next) => {
    try {
      const item = await this.service.updateItem(
        req.household.id,
        req.params.id,
        req.body
      );
      return res.status(200).json({
        status: 'success',
        data: { item }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * DELETE /api/v1/shopping-list/:id
   * Delete shopping list item.
   */
  deleteItem = async (req, res, next) => {
    try {
      const result = await this.service.deleteItem(req.household.id, req.params.id);
      return res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * POST /api/v1/shopping-list/:id/purchase
   * Mark shopping list item as purchased and record into actual pantry inventory.
   */
  markPurchased = async (req, res, next) => {
    try {
      const result = await this.service.markPurchased(
        req.household.id,
        req.user.id,
        req.params.id,
        req.body
      );
      return res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };
}

export const shoppingListController = new ShoppingListController();
export default shoppingListController;
