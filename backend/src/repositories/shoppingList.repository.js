import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';

export class ShoppingListRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Insert a shopping list item.
   *
   * @param {object} itemData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async create(itemData, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('shopping_list_items')
      .insert({
        household_id: itemData.household_id,
        name: itemData.name.trim(),
        quantity: itemData.quantity ?? 1,
        unit: itemData.unit || 'piece',
        category: itemData.category || 'other',
        notes: itemData.notes || null,
        is_purchased: false,
        created_by: itemData.created_by || itemData.added_by || null
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ householdId: itemData.household_id, error: error.message }, 'Failed to insert shopping list item');
      throw error;
    }

    return data;
  }

  /**
   * Find all shopping list items for a household with optional is_purchased filter.
   *
   * @param {string} householdId
   * @param {object} [query={}]
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async findMany(householdId, query = {}, client = null) {
    const db = client || this.getClient();

    let q = db
      .from('shopping_list_items')
      .select('*')
      .eq('household_id', householdId);

    if (query.is_purchased !== undefined && query.is_purchased !== 'all') {
      const isPurchasedBool = query.is_purchased === true || query.is_purchased === 'true';
      q = q.eq('is_purchased', isPurchasedBool);
    }

    q = q.order('created_at', { ascending: false });

    const { data, error } = await q;

    if (error) {
      logger.error({ householdId, error: error.message }, 'Failed to query shopping list items');
      throw error;
    }

    return data || [];
  }

  /**
   * Find single shopping list item by ID, scoped to household.
   *
   * @param {string} id
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<object|null>}
   */
  async findById(id, householdId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('shopping_list_items')
      .select('*')
      .eq('id', id)
      .eq('household_id', householdId)
      .maybeSingle();

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to find shopping list item');
      throw error;
    }

    return data;
  }

  /**
   * Update fields of a shopping list item.
   *
   * @param {string} id
   * @param {string} householdId
   * @param {object} updates
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async update(id, householdId, updates, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('shopping_list_items')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('household_id', householdId)
      .select('*')
      .single();

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to update shopping list item');
      throw error;
    }

    return data;
  }

  /**
   * Delete a shopping list item.
   *
   * @param {string} id
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<boolean>}
   */
  async delete(id, householdId, client = null) {
    const db = client || this.getClient();

    const { error } = await db
      .from('shopping_list_items')
      .delete()
      .eq('id', id)
      .eq('household_id', householdId);

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to delete shopping list item');
      throw error;
    }

    return true;
  }

  /**
   * Find active inventory items matching a product name in the household to warn about overbuying.
   *
   * @param {string} householdId
   * @param {string} productName
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async findSimilarActiveItems(householdId, productName, client = null) {
    const db = client || this.getClient();
    const cleanName = productName.trim().toLowerCase();

    const { data, error } = await db
      .from('inventory_items')
      .select('id, name, quantity, unit, storage_location, expiry_date, status')
      .eq('household_id', householdId)
      .eq('status', 'active');

    if (error) {
      logger.warn({ householdId, productName, error: error.message }, 'Failed to check similar active items');
      return [];
    }

    if (!data || !Array.isArray(data)) return [];

    // Filter matching items by substring or case-insensitive match
    return data.filter((item) => {
      const existingName = item.name.toLowerCase();
      return (
        existingName === cleanName ||
        existingName.includes(cleanName) ||
        cleanName.includes(existingName)
      );
    });
  }
}

export const shoppingListRepository = new ShoppingListRepository();
export default shoppingListRepository;
