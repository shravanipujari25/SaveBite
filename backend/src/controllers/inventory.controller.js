import { inventoryService } from '../services/inventory.service.js';

export class InventoryController {
  constructor(service = inventoryService) {
    this.inventoryService = service;
  }

  /**
   * POST /api/v1/inventory
   * Create a new inventory item.
   */
  createItem = async (req, res, next) => {
    try {
      const item = await this.inventoryService.createItem(req.household.id, req.user.id, req.body);
      return res.status(201).json({
        status: 'success',
        data: { item }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/inventory
   * List inventory items scoped to household.
   */
  getItems = async (req, res, next) => {
    try {
      const result = await this.inventoryService.getItems(req.household.id, req.query);
      return res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/inventory/:itemId
   * Retrieve single inventory item by ID.
   */
  getItemById = async (req, res, next) => {
    try {
      const item = await this.inventoryService.getItemById(req.household.id, req.params.itemId);
      return res.status(200).json({
        status: 'success',
        data: { item }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * PATCH /api/v1/inventory/:itemId
   * Update permitted fields of an inventory item.
   */
  updateItem = async (req, res, next) => {
    try {
      const item = await this.inventoryService.updateItem(
        req.household.id,
        req.params.itemId,
        req.body,
        req.user.id
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
   * DELETE /api/v1/inventory/:itemId
   * Archive / soft-delete an inventory item.
   */
  archiveItem = async (req, res, next) => {
    try {
      await this.inventoryService.archiveItem(req.household.id, req.params.itemId, req.user.id);
      return res.status(200).json({
        status: 'success',
        message: 'Item archived successfully'
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * POST /api/v1/inventory/:itemId/consume
   * Consume stock of an inventory item.
   */
  consumeItem = async (req, res, next) => {
    try {
      const result = await this.inventoryService.consumeItem(
        req.household.id,
        req.params.itemId,
        req.body.quantity,
        req.body.unit,
        req.user.id
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
   * POST /api/v1/inventory/:itemId/waste
   * Log waste for an inventory item.
   */
  wasteItem = async (req, res, next) => {
    try {
      const result = await this.inventoryService.wasteItem(
        req.household.id,
        req.params.itemId,
        req.body.quantity,
        req.body.reason,
        req.body.unit,
        req.user.id
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
   * POST /api/v1/inventory/:itemId/open
   * Mark an inventory item as opened.
   */
  openItem = async (req, res, next) => {
    try {
      const item = await this.inventoryService.openItem(
        req.household.id,
        req.params.itemId,
        req.user.id
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
   * POST /api/v1/inventory/manual-purchase
   * Add a grocery purchase to pantry inventory.
   */
  manualPurchase = async (req, res, next) => {
    try {
      const item = await this.inventoryService.manualPurchase(
        req.household.id,
        req.user.id,
        req.body
      );
      return res.status(201).json({
        status: 'success',
        data: { item }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * POST /api/v1/inventory/use-ingredients
   * Multi-item consumption with avoided-waste calculation.
   */
  useIngredients = async (req, res, next) => {
    try {
      const result = await this.inventoryService.useIngredients(
        req.household.id,
        req.user.id,
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

export const inventoryController = new InventoryController();
export default inventoryController;
