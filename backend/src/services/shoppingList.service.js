import { shoppingListRepository } from '../repositories/shoppingList.repository.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';

export class ShoppingListService {
  constructor(repository = shoppingListRepository) {
    this.repo = repository;
  }

  /**
   * Create a new shopping list item with overbuy and duplicate warnings.
   *
   * @param {string} householdId
   * @param {string} userId
   * @param {object} itemData
   * @returns {Promise<{ item: object, warnings: object[] }>}
   */
  async createItem(householdId, userId, itemData) {
    // 1. Check for similar active items in household inventory (deterministic overbuy check)
    const similarInventoryItems = await this.repo.findSimilarActiveItems(householdId, itemData.name);
    const warnings = [];

    if (similarInventoryItems.length > 0) {
      for (const inv of similarInventoryItems) {
        warnings.push({
          type: 'inventory_overbuy_warning',
          message: `You currently have ${inv.quantity} ${inv.unit} of '${inv.name}' stored in ${inv.storage_location}${inv.expiry_date ? ` (expires ${inv.expiry_date})` : ''}.`,
          existing_item: {
            id: inv.id,
            name: inv.name,
            quantity: inv.quantity,
            unit: inv.unit,
            storage_location: inv.storage_location,
            expiry_date: inv.expiry_date
          }
        });
      }
    }

    // 2. Check for existing unpurchased items in the shopping list (duplicate check)
    const existingList = await this.repo.findMany(householdId, { is_purchased: false });
    const normalizedNewName = itemData.name.trim().toLowerCase();
    const existingDuplicate = existingList.find(
      (item) => item.name.trim().toLowerCase() === normalizedNewName
    );

    if (existingDuplicate) {
      warnings.push({
        type: 'shopping_list_duplicate_warning',
        message: `'${itemData.name}' is already on your active shopping list with quantity ${existingDuplicate.quantity} ${existingDuplicate.unit}.`,
        existing_shopping_item_id: existingDuplicate.id
      });
    }

    // 3. Create the item in shopping_list_items
    const created = await this.repo.create({
      ...itemData,
      household_id: householdId,
      added_by: userId
    });

    logger.info(
      { id: created.id, householdId, warningsCount: warnings.length },
      'Shopping list item created successfully'
    );

    return {
      item: created,
      warnings
    };
  }

  /**
   * List shopping list items for a household.
   *
   * @param {string} householdId
   * @param {object} query
   * @returns {Promise<object[]>}
   */
  async getItems(householdId, query = {}) {
    return this.repo.findMany(householdId, query);
  }

  /**
   * Get single shopping list item by ID.
   *
   * @param {string} householdId
   * @param {string} id
   * @returns {Promise<object>}
   */
  async getItemById(householdId, id) {
    const item = await this.repo.findById(id, householdId);
    if (!item) {
      throw new AppError('Shopping list item not found', 404, 'NOT_FOUND');
    }
    return item;
  }

  /**
   * Update a shopping list item.
   *
   * @param {string} householdId
   * @param {string} id
   * @param {object} updates
   * @returns {Promise<object>}
   */
  async updateItem(householdId, id, updates) {
    const existing = await this.repo.findById(id, householdId);
    if (!existing) {
      throw new AppError('Shopping list item not found', 404, 'NOT_FOUND');
    }

    const payload = { ...updates };
    if (updates.is_purchased === true && !existing.is_purchased) {
      payload.purchased_at = new Date().toISOString();
    } else if (updates.is_purchased === false) {
      payload.purchased_at = null;
    }

    return this.repo.update(id, householdId, payload);
  }

  /**
   * Delete a shopping list item.
   *
   * @param {string} householdId
   * @param {string} id
   * @returns {Promise<{ success: boolean }>}
   */
  async deleteItem(householdId, id) {
    const existing = await this.repo.findById(id, householdId);
    if (!existing) {
      throw new AppError('Shopping list item not found', 404, 'NOT_FOUND');
    }

    await this.repo.delete(id, householdId);
    return { success: true };
  }

  /**
   * Mark a shopping list item as purchased.
   *
   * @param {string} householdId
   * @param {string} id
   * @returns {Promise<object>}
   */
  async markPurchased(householdId, id) {
    const existing = await this.repo.findById(id, householdId);
    if (!existing) {
      throw new AppError('Shopping list item not found', 404, 'NOT_FOUND');
    }

    return this.repo.update(id, householdId, {
      is_purchased: true,
      purchased_at: new Date().toISOString()
    });
  }
}

export const shoppingListService = new ShoppingListService();
export default shoppingListService;
