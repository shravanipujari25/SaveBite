import { inventoryRepository } from '../repositories/inventory.repository.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';

export class InventoryService {
  constructor(repository = inventoryRepository) {
    this.inventoryRepo = repository;
  }

  /**
   * Create an inventory item for the authenticated household.
   *
   * @param {string} householdId
   * @param {string} userId
   * @param {object} itemData
   * @returns {Promise<object>}
   */
  async createItem(householdId, userId, itemData) {
    const item = await this.inventoryRepo.create({
      ...itemData,
      household_id: householdId,
      created_by: userId
    });

    // Record creation in lifecycle events
    await this.inventoryRepo.logEvent({
      household_id: householdId,
      inventory_item_id: item.id,
      event_type: 'created',
      quantity_change: item.quantity,
      unit: item.unit,
      notes: 'Initial inventory item created',
      created_by: userId
    });

    logger.info({ itemId: item.id, householdId, userId }, 'Inventory item created successfully');
    return item;
  }

  /**
   * List inventory items scoped to household with filters and pagination.
   *
   * @param {string} householdId
   * @param {object} query
   * @returns {Promise<{ items: object[], pagination: object }>}
   */
  async getItems(householdId, query) {
    return this.inventoryRepo.findMany(householdId, query);
  }

  /**
   * Get single inventory item by ID scoped to household.
   *
   * @param {string} householdId
   * @param {string} itemId
   * @returns {Promise<object>}
   */
  async getItemById(householdId, itemId) {
    const item = await this.inventoryRepo.findById(itemId, householdId);
    if (!item) {
      throw new AppError('Inventory item not found', 404, 'NOT_FOUND');
    }
    return item;
  }

  /**
   * Update permitted fields of an inventory item.
   *
   * @param {string} householdId
   * @param {string} itemId
   * @param {object} updates
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async updateItem(householdId, itemId, updates, userId) {
    // Confirm item exists and belongs to household
    const existing = await this.getItemById(householdId, itemId);

    // Filter out forbidden keys if any escaped schema
    const safeUpdates = { ...updates };
    delete safeUpdates.id;
    delete safeUpdates.household_id;
    delete safeUpdates.created_by;
    delete safeUpdates.created_at;
    delete safeUpdates.status;

    if (Object.keys(safeUpdates).length === 0) {
      return existing;
    }

    const updated = await this.inventoryRepo.update(itemId, householdId, safeUpdates);

    await this.inventoryRepo.logEvent({
      household_id: householdId,
      inventory_item_id: itemId,
      event_type: 'updated',
      quantity_change: safeUpdates.quantity !== undefined ? safeUpdates.quantity - existing.quantity : 0,
      unit: safeUpdates.unit || existing.unit,
      notes: `Updated fields: ${Object.keys(safeUpdates).join(', ')}`,
      created_by: userId
    });

    logger.info({ itemId, householdId, userId }, 'Inventory item updated successfully');
    return updated;
  }

  /**
   * Soft delete / archive an inventory item.
   *
   * @param {string} householdId
   * @param {string} itemId
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async archiveItem(householdId, itemId, userId) {
    const archived = await this.inventoryRepo.archive(itemId, householdId, userId);
    logger.info({ itemId, householdId, userId }, 'Inventory item archived successfully');
    return archived;
  }

  /**
   * Consume a portion or all of an inventory item.
   *
   * @param {string} householdId
   * @param {string} itemId
   * @param {number} quantity
   * @param {string} [unit]
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async consumeItem(householdId, itemId, quantity, unit, userId) {
    const result = await this.inventoryRepo.consume(itemId, householdId, quantity, unit, userId);
    logger.info({ itemId, householdId, quantity, userId }, 'Inventory item consumed');
    return result;
  }

  /**
   * Record waste for an inventory item.
   *
   * @param {string} householdId
   * @param {string} itemId
   * @param {number} quantity
   * @param {string} reason
   * @param {string} [unit]
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async wasteItem(householdId, itemId, quantity, reason, unit, userId) {
    const result = await this.inventoryRepo.waste(itemId, householdId, quantity, reason, unit, userId);
    logger.info({ itemId, householdId, quantity, reason, userId }, 'Inventory item waste logged');
    return result;
  }

  /**
   * Open an inventory item package.
   *
   * @param {string} householdId
   * @param {string} itemId
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async openItem(householdId, itemId, userId) {
    const item = await this.inventoryRepo.open(itemId, householdId, userId);
    logger.info({ itemId, householdId, userId }, 'Inventory item marked opened');
    return item;
  }

  /**
   * Record a manual grocery purchase / add to pantry.
   *
   * @param {string} householdId
   * @param {string} userId
   * @param {object} purchaseData
   * @returns {Promise<object>}
   */
  async manualPurchase(householdId, userId, purchaseData) {
    const item = await this.inventoryRepo.create({
      ...purchaseData,
      household_id: householdId,
      created_by: userId
    });

    await this.inventoryRepo.logEvent({
      household_id: householdId,
      inventory_item_id: item.id,
      event_type: 'manual_purchase',
      quantity_change: item.quantity,
      unit: item.unit,
      notes: 'Manual grocery haul purchase logged',
      created_by: userId
    });

    logger.info({ itemId: item.id, householdId, userId }, 'Manual purchase recorded');
    return item;
  }

  /**
   * Get household dashboard metrics.
   *
   * @param {string} householdId
   * @returns {Promise<object>}
   */
  async getDashboard(householdId) {
    return this.inventoryRepo.getDashboardMetrics(householdId);
  }

  /**
   * Consume multiple items atomically with avoided waste tracking.
   *
   * @param {string} householdId
   * @param {string} userId
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async useIngredients(householdId, userId, payload) {
    return this.inventoryRepo.consumeMultiItems(
      householdId,
      userId,
      payload.items,
      {
        source: payload.source || 'recipe_rescue',
        recipe_name: payload.recipe_name || null
      }
    );
  }
}

export const inventoryService = new InventoryService();
export default inventoryService;
