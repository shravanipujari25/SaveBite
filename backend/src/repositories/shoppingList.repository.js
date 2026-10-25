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

    const insertPayload = {
      household_id: itemData.household_id,
      name: itemData.name.trim(),
      quantity: itemData.quantity ?? 1,
      unit: itemData.unit || 'piece',
      category: itemData.category || 'other',
      notes: itemData.notes || null,
      is_purchased: itemData.is_purchased !== undefined 
        ? Boolean(itemData.is_purchased) 
        : (itemData.status === 'purchased'),
      purchased_at: itemData.purchased_at || null,
      created_by: itemData.created_by || itemData.added_by || null
    };

    const { data, error } = await db
      .from('shopping_list_items')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      logger.error({ householdId: itemData.household_id, error: error.message }, 'Failed to insert shopping list item');
      throw error;
    }

    return {
      ...data,
      status: data.is_purchased ? 'purchased' : 'needed',
      estimated_price: itemData.estimated_price !== undefined ? itemData.estimated_price : 3.50,
      recommendation_reason: itemData.recommendation_reason || null,
      source_type: itemData.source_type || 'manual'
    };
  }

  /**
   * Find all shopping list items for a household with optional is_purchased or status filter.
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

    // Filter using existing database schema column is_purchased
    if (query.status && query.status !== 'all') {
      const isPurchased = query.status === 'purchased';
      q = q.eq('is_purchased', isPurchased);
    } else if (query.is_purchased !== undefined && query.is_purchased !== 'all') {
      const isPurchasedBool = query.is_purchased === true || query.is_purchased === 'true';
      q = q.eq('is_purchased', isPurchasedBool);
    }

    q = q.order('created_at', { ascending: false });

    const { data, error } = await q;

    if (error) {
      logger.error({ householdId, error: error.message }, 'Failed to query shopping list items');
      throw error;
    }

    return (data || []).map((row) => ({
      ...row,
      status: row.is_purchased ? 'purchased' : 'needed',
      estimated_price: row.estimated_price !== undefined ? row.estimated_price : 3.50,
      source_type: row.source_type || 'manual'
    }));
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

    if (!data) return null;

    return {
      ...data,
      status: data.is_purchased ? 'purchased' : 'needed',
      estimated_price: data.estimated_price !== undefined ? data.estimated_price : 3.50,
      source_type: data.source_type || 'manual'
    };
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

    // Whitelist known columns in shopping_list_items schema to prevent PGRST204 errors
    const validColumns = ['name', 'quantity', 'unit', 'category', 'notes', 'is_purchased', 'purchased_at', 'created_by'];
    const sanitizedUpdates = {};

    for (const key of Object.keys(updates)) {
      if (validColumns.includes(key)) {
        sanitizedUpdates[key] = updates[key];
      }
    }

    if (updates.status !== undefined && sanitizedUpdates.is_purchased === undefined) {
      sanitizedUpdates.is_purchased = updates.status === 'purchased';
    }

    sanitizedUpdates.updated_at = new Date().toISOString();

    const { data, error } = await db
      .from('shopping_list_items')
      .update(sanitizedUpdates)
      .eq('id', id)
      .eq('household_id', householdId)
      .select('*')
      .single();

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to update shopping list item');
      throw error;
    }

    return {
      ...data,
      status: data.is_purchased ? 'purchased' : 'needed',
      estimated_price: updates.estimated_price !== undefined ? updates.estimated_price : (data.estimated_price || 3.50),
      recommendation_reason: updates.recommendation_reason || data.recommendation_reason || null,
      source_type: updates.source_type || data.source_type || 'manual'
    };
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
   * Find all active pantry inventory items for a household.
   * Excludes archived items.
   *
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async findActiveInventoryItems(householdId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('inventory_items')
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'active');

    if (error) {
      logger.warn({ householdId, error: error.message }, 'Failed to load active inventory items');
      return [];
    }

    return data || [];
  }

  /**
   * Find consumption events for the household within a window of days.
   *
   * @param {string} householdId
   * @param {number} days
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async findConsumptionEvents(householdId, days = 30, client = null) {
    const db = client || this.getClient();
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await db
      .from('inventory_events')
      .select('*')
      .eq('household_id', householdId)
      .gte('created_at', sinceDate);

    if (error) {
      logger.warn({ householdId, error: error.message }, 'Failed to query consumption events');
      return [];
    }

    if (!data || !Array.isArray(data)) return [];

    return data.filter(e =>
      e.event_type === 'consumed' ||
      e.event_type === 'consume' ||
      e.event_type === 'recipe_rescue' ||
      (e.quantity_change && Number(e.quantity_change) < 0)
    );
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
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'active');

    if (error) {
      logger.warn({ householdId, productName, error: error.message }, 'Failed to check similar active items');
      return [];
    }

    if (!data || !Array.isArray(data)) return [];

    return data.filter((item) => {
      const existingName = (item.name || '').toLowerCase();
      return (
        existingName === cleanName ||
        existingName.includes(cleanName) ||
        cleanName.includes(existingName)
      );
    });
  }

  /**
   * Find an existing inventory item in pantry with same name and category/location to merge stock into.
   *
   * @param {string} householdId
   * @param {string} name
   * @param {object} [client]
   * @returns {Promise<object|null>}
   */
  async findMatchingPantryItem(householdId, name, client = null) {
    const db = client || this.getClient();
    const cleanName = name.trim().toLowerCase();

    const { data, error } = await db
      .from('inventory_items')
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'active');

    if (error || !data) return null;

    return data.find(i => (i.name || '').trim().toLowerCase() === cleanName) || null;
  }
}

export const shoppingListRepository = new ShoppingListRepository();
export default shoppingListRepository;
