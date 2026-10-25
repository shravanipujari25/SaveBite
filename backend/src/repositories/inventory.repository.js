import { getDatabaseClient } from '../config/supabase.js';
import { logger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

export class InventoryRepository {
  constructor(getClient = getDatabaseClient) {
    this.getClient = getClient;
  }

  /**
   * Create an inventory item scoped to a household.
   *
   * @param {object} itemData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async create(itemData, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('inventory_items')
      .insert({
        household_id: itemData.household_id,
        name: itemData.name.trim(),
        category: itemData.category || 'other',
        quantity: itemData.quantity ?? 1,
        unit: itemData.unit || 'piece',
        purchase_date: itemData.purchase_date || null,
        expiry_date: itemData.expiry_date || null,
        storage_location: itemData.storage_location || 'pantry',
        estimated_unit_price: itemData.estimated_unit_price ?? null,
        currency: itemData.currency || 'USD',
        status: 'active',
        is_opened: false,
        opened_at: null,
        created_by: itemData.created_by || null
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ householdId: itemData.household_id, error: error.message }, 'Failed to insert inventory item');
      throw error;
    }

    return data;
  }

  /**
   * Find an inventory item by ID scoped strictly to the household.
   *
   * @param {string} id - UUID of the item
   * @param {string} householdId - UUID of the household
   * @param {object} [client]
   * @returns {Promise<object|null>}
   */
  async findById(id, householdId, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('inventory_items')
      .select('*')
      .eq('id', id)
      .eq('household_id', householdId)
      .maybeSingle();

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to query inventory item');
      throw error;
    }

    return data;
  }

  /**
   * List inventory items for a household with filtering, sorting, and pagination.
   *
   * @param {string} householdId
   * @param {object} params
   * @param {object} [client]
   * @returns {Promise<{ items: object[], pagination: object }>}
   */
  async findMany(householdId, params = {}, client = null) {
    const db = client || this.getClient();

    const {
      search,
      name,
      category,
      storage_location,
      status = 'active',
      expiring_before,
      page = 1,
      limit = 20,
      sort_by = 'expiry_date',
      order = 'asc'
    } = params;

    let query = db.from('inventory_items').select('*', { count: 'exact' }).eq('household_id', householdId);

    // Status filter
    if (status !== 'all') {
      query = query.eq('status', status);
    } else {
      // Exclude archived by default if explicitly requesting 'all' unless specified
      query = query.neq('status', 'archived');
    }

    // Name / substring search
    const searchTerm = search || name;
    if (searchTerm) {
      query = query.ilike('name', searchTerm);
    }

    // Category filter
    if (category) {
      query = query.eq('category', category);
    }

    // Storage location filter
    if (storage_location) {
      query = query.eq('storage_location', storage_location);
    }

    // Expiry date range filter
    if (expiring_before) {
      query = query.lte('expiry_date', expiring_before);
    }

    // Sorting
    const ascending = order.toLowerCase() === 'asc';
    query = query.order(sort_by, { ascending });

    // Pagination
    const offset = (page - 1) * limit;
    const to = offset + limit - 1;
    query = query.range(offset, to);

    const { data, error, count } = await query;

    if (error) {
      logger.error({ householdId, error: error.message }, 'Failed to query inventory items');
      throw error;
    }

    const total = count !== null && count !== undefined ? count : (data ? data.length : 0);
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items: data || [],
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages
      }
    };
  }

  /**
   * Update permitted fields of an inventory item.
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
      .from('inventory_items')
      .update(updates)
      .eq('id', id)
      .eq('household_id', householdId)
      .select('*')
      .single();

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to update inventory item');
      throw error;
    }

    return data;
  }

  /**
   * Soft delete / archive an item.
   *
   * @param {string} id
   * @param {string} householdId
   * @param {string} userId
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async archive(id, householdId, userId, client = null) {
    const db = client || this.getClient();

    const existing = await this.findById(id, householdId, db);
    if (!existing) {
      throw new AppError('Inventory item not found in household', 404, 'NOT_FOUND');
    }

    const { data, error } = await db
      .from('inventory_items')
      .update({
        status: 'archived'
      })
      .eq('id', id)
      .eq('household_id', householdId)
      .select('*')
      .single();

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to archive inventory item');
      throw error;
    }

    // Log lifecycle event
    await this.logEvent({
      household_id: householdId,
      inventory_item_id: id,
      event_type: 'archived',
      quantity_change: 0,
      unit: existing.unit,
      notes: 'Item archived',
      created_by: userId
    }, db);

    return data;
  }

  /**
   * Atomically consume stock of an inventory item.
   *
   * @param {string} id
   * @param {string} householdId
   * @param {number} quantity
   * @param {string} [unit]
   * @param {string} userId
   * @param {object} [client]
   * @returns {Promise<{ item: object, consumedQuantity: number }>}
   */
  async consume(id, householdId, quantity, unit = null, userId, client = null) {
    const db = client || this.getClient();

    const item = await this.findById(id, householdId, db);
    if (!item) {
      throw new AppError('Inventory item not found in household', 404, 'NOT_FOUND');
    }

    if (item.status !== 'active') {
      throw new AppError(`Item cannot be consumed because its current status is '${item.status}'`, 400, 'ITEM_INACTIVE');
    }

    if (item.quantity < quantity) {
      throw new AppError(
        `Cannot consume ${quantity} ${item.unit}. Only ${item.quantity} ${item.unit} available.`,
        400,
        'INSUFFICIENT_STOCK',
        { available: item.quantity, requested: quantity }
      );
    }

    const newQuantity = Number((item.quantity - quantity).toFixed(2));
    const newStatus = newQuantity === 0 ? 'consumed' : 'active';

    const { data: updatedItem, error } = await db
      .from('inventory_items')
      .update({
        quantity: newQuantity,
        status: newStatus
      })
      .eq('id', id)
      .eq('household_id', householdId)
      .select('*')
      .single();

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to update item during consumption');
      throw error;
    }

    // Record consumption event
    await this.logEvent({
      household_id: householdId,
      inventory_item_id: id,
      event_type: 'consumed',
      quantity_change: -quantity,
      unit: item.unit,
      notes: unit && unit !== item.unit ? `Consumed with requested unit: ${unit}` : null,
      created_by: userId
    }, db);

    return {
      item: updatedItem,
      consumedQuantity: quantity,
      remainingQuantity: newQuantity
    };
  }

  /**
   * Atomically waste stock of an inventory item and create a waste_log record.
   *
   * @param {string} id
   * @param {string} householdId
   * @param {number} quantity
   * @param {string} reason
   * @param {string} [unit]
   * @param {string} userId
   * @param {object} [client]
   * @returns {Promise<{ item: object, wasteLog: object }>}
   */
  async waste(id, householdId, quantity, reason, unit = null, userId, client = null) {
    const db = client || this.getClient();

    const item = await this.findById(id, householdId, db);
    if (!item) {
      throw new AppError('Inventory item not found in household', 404, 'NOT_FOUND');
    }

    if (item.status !== 'active') {
      throw new AppError(`Item cannot be wasted because its current status is '${item.status}'`, 400, 'ITEM_INACTIVE');
    }

    if (item.quantity < quantity) {
      throw new AppError(
        `Cannot waste ${quantity} ${item.unit}. Only ${item.quantity} ${item.unit} available.`,
        400,
        'INSUFFICIENT_STOCK',
        { available: item.quantity, requested: quantity }
      );
    }

    const newQuantity = Number((item.quantity - quantity).toFixed(2));
    const newStatus = newQuantity === 0 ? 'wasted' : 'active';

    // Calculate estimated monetary loss if unit price is stored
    let estimatedValue = null;
    if (item.estimated_unit_price !== null && item.estimated_unit_price !== undefined) {
      estimatedValue = Number((item.estimated_unit_price * quantity).toFixed(2));
    }

    // 1. Update inventory item stock and status
    const { data: updatedItem, error: updateError } = await db
      .from('inventory_items')
      .update({
        quantity: newQuantity,
        status: newStatus
      })
      .eq('id', id)
      .eq('household_id', householdId)
      .select('*')
      .single();

    if (updateError) {
      logger.error({ id, householdId, error: updateError.message }, 'Failed to update stock during waste');
      throw updateError;
    }

    // 2. Insert into waste_log
    const { data: wasteLog, error: wasteError } = await db
      .from('waste_log')
      .insert({
        household_id: householdId,
        inventory_item_id: id,
        quantity,
        unit: item.unit,
        reason,
        estimated_value: estimatedValue,
        recorded_by: userId,
        wasted_at: new Date().toISOString()
      })
      .select('*')
      .single();

    if (wasteError) {
      logger.error({ id, householdId, error: wasteError.message }, 'Failed to insert waste log');
      // Rollback item stock to guarantee atomic consistency
      try {
        await db.from('inventory_items').update({
          quantity: item.quantity,
          status: item.status
        }).eq('id', id).eq('household_id', householdId);
      } catch (rollbackErr) {
        logger.error({ rollbackErr }, 'Failed to rollback inventory stock after waste log failure');
      }
      throw wasteError;
    }

    // 3. Insert into inventory_events
    await this.logEvent({
      household_id: householdId,
      inventory_item_id: id,
      event_type: 'wasted',
      quantity_change: -quantity,
      unit: item.unit,
      notes: `Reason: ${reason}`,
      created_by: userId
    }, db);

    return {
      item: updatedItem,
      wasteLog: {
        ...wasteLog,
        item_name: wasteLog?.item_name || item.name
      }
    };
  }

  /**
   * Open an inventory item idempotently.
   *
   * @param {string} id
   * @param {string} householdId
   * @param {string} userId
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async open(id, householdId, userId, client = null) {
    const db = client || this.getClient();

    const item = await this.findById(id, householdId, db);
    if (!item) {
      throw new AppError('Inventory item not found in household', 404, 'NOT_FOUND');
    }

    // Idempotent: If already opened, preserve original opened_at date
    if (item.is_opened && item.opened_at) {
      return item;
    }

    const openedAt = new Date().toISOString();

    const { data: updatedItem, error } = await db
      .from('inventory_items')
      .update({
        is_opened: true,
        opened_at: openedAt
      })
      .eq('id', id)
      .eq('household_id', householdId)
      .select('*')
      .single();

    if (error) {
      logger.error({ id, householdId, error: error.message }, 'Failed to mark item as opened');
      throw error;
    }

    // Record lifecycle event
    await this.logEvent({
      household_id: householdId,
      inventory_item_id: id,
      event_type: 'opened',
      quantity_change: 0,
      unit: item.unit,
      notes: 'Item package opened',
      created_by: userId
    }, db);

    return updatedItem;
  }

  /**
   * Record an audit event into inventory_events.
   *
   * @param {object} eventData
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async logEvent(eventData, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('inventory_events')
      .insert({
        household_id: eventData.household_id,
        inventory_item_id: eventData.inventory_item_id || null,
        event_type: eventData.event_type,
        quantity_change: eventData.quantity_change ?? 0,
        unit: eventData.unit || null,
        notes: eventData.notes || null,
        created_by: eventData.created_by || null
      })
      .select('*')
      .single();

    if (error) {
      logger.warn({ error: error.message }, 'Failed to record inventory audit event');
    }

    return data;
  }

  /**
   * Calculate dashboard metrics for a household.
   *
   * @param {string} householdId
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async getDashboardMetrics(householdId, client = null) {
    const db = client || this.getClient();

    // 1. Fetch all active items
    const { data: activeItems, error: itemsError } = await db
      .from('inventory_items')
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'active');

    if (itemsError) {
      logger.error({ householdId, error: itemsError.message }, 'Failed to query active items for dashboard');
      throw itemsError;
    }

    const items = activeItems || [];
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const sevenDaysStr = sevenDaysFromNow.toISOString().split('T')[0];

    let totalQuantity = 0;
    let totalEstimatedValue = 0;
    const expiringSoonItems = [];
    const expiredItems = [];
    const upcomingItems = [];

    for (const item of items) {
      const qty = Number(item.quantity) || 0;
      totalQuantity += qty;

      if (item.estimated_unit_price !== null && item.estimated_unit_price !== undefined) {
        totalEstimatedValue += qty * Number(item.estimated_unit_price);
      }

      if (item.expiry_date) {
        if (item.expiry_date < todayStr) {
          expiredItems.push(item);
        } else if (item.expiry_date <= sevenDaysStr) {
          expiringSoonItems.push(item);
          upcomingItems.push(item);
        } else {
          upcomingItems.push(item);
        }
      }
    }

    // Sort expiring soon items by earliest upcoming expiry dates first
    expiringSoonItems.sort((a, b) => (a.expiry_date > b.expiry_date ? 1 : -1));

    // Sort Use-First items: prioritize AI use_first_score descending (higher = more urgent),
    // falling back to earliest upcoming expiry dates
    upcomingItems.sort((a, b) => {
      const aScore = a.use_first_score !== null && a.use_first_score !== undefined ? Number(a.use_first_score) : 0;
      const bScore = b.use_first_score !== null && b.use_first_score !== undefined ? Number(b.use_first_score) : 0;
      if (aScore !== bScore) {
        return bScore - aScore; // Highest score first
      }
      if (!a.expiry_date && !b.expiry_date) return 0;
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return a.expiry_date > b.expiry_date ? 1 : -1;
    });

    // Top 5 Use-First items
    const topUseFirst = upcomingItems.slice(0, 5);

    // 2. Query waste summary for last 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: wasteRows } = await db
      .from('waste_log')
      .select('*')
      .eq('household_id', householdId)
      .gte('wasted_at', thirtyDaysAgo);

    let totalWastedCount = 0;
    let totalWastedValue = 0;
    if (wasteRows && Array.isArray(wasteRows)) {
      totalWastedCount = wasteRows.length;
      for (const row of wasteRows) {
        if (row.estimated_value) {
          totalWastedValue += Number(row.estimated_value);
        }
      }
    }

    return {
      summary: {
        totalActiveItems: items.length,
        totalQuantity: Number(totalQuantity.toFixed(2)),
        totalEstimatedValue: Number(totalEstimatedValue.toFixed(2)),
        currency: items[0]?.currency || 'USD',
        expiringSoonCount: expiringSoonItems.length,
        expiredCount: expiredItems.length
      },
      expiringSoon: expiringSoonItems,
      useFirst: topUseFirst,
      wasteSummary: {
        totalWastedItems: totalWastedCount,
        totalWastedValue: Number(totalWastedValue.toFixed(2))
      }
    };
  }

  /**
   * Update AI intelligence fields for an inventory item.
   *
   * @param {string} itemId
   * @param {string} householdId
   * @param {object} updates
   * @param {object} [client]
   * @returns {Promise<object>}
   */
  async updateIntelligence(itemId, householdId, updates, client = null) {
    const db = client || this.getClient();

    const { data, error } = await db
      .from('inventory_items')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .eq('household_id', householdId)
      .select('*')
      .single();

    if (error) {
      logger.error({ itemId, householdId, error: error.message }, 'Failed to update item intelligence');
      throw error;
    }

    return data;
  }

  /**
   * Fetch all active inventory items for scheduled intelligence analysis.
   *
   * @param {string} [householdId] - Optional filter by household
   * @param {object} [client]
   * @returns {Promise<object[]>}
   */
  async findAllActive(householdId = null, client = null) {
    const db = client || this.getClient();

    let query = db
      .from('inventory_items')
      .select('*')
      .eq('status', 'active');

    if (householdId) {
      query = query.eq('household_id', householdId);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ householdId, error: error.message }, 'Failed to query active items for intelligence');
      throw error;
    }

    return data || [];
  }

  /**
   * Atomically consume multiple inventory items (e.g. from recipe rescue).
   * Validates available stock first to ensure consistency.
   *
   * @param {string} householdId
   * @param {string} userId
   * @param {Array<{ inventory_item_id: string, quantity: number }>} itemsToConsume
   * @param {object} [context={}] - Context metadata (e.g. source, recipe_name)
   * @param {object} [client]
   * @returns {Promise<{ consumed_items: object[], total_avoided_savings: number, avoided_waste_items: object[] }>}
   */
  async consumeMultiItems(householdId, userId, itemsToConsume, context = {}, client = null) {
    const db = client || this.getClient();

    // 1. Validate all items exist, belong to household, and have adequate stock
    const validatedItems = [];
    for (const reqItem of itemsToConsume) {
      const existing = await this.findById(reqItem.inventory_item_id, householdId, db);
      if (!existing) {
        throw new AppError(
          `Inventory item ${reqItem.inventory_item_id} not found in household`,
          404,
          'NOT_FOUND'
        );
      }

      if (existing.status !== 'active') {
        throw new AppError(
          `Item '${existing.name}' is already ${existing.status} and cannot be consumed`,
          400,
          'ITEM_INACTIVE'
        );
      }

      const availableQty = Number(existing.quantity);
      const consumeQty = Number(reqItem.quantity);

      if (consumeQty <= 0) {
        throw new AppError(
          `Consumption quantity for '${existing.name}' must be greater than zero`,
          400,
          'INVALID_QUANTITY'
        );
      }

      if (consumeQty > availableQty) {
        throw new AppError(
          `Cannot consume ${consumeQty} ${existing.unit} of '${existing.name}'. Only ${availableQty} ${existing.unit} available.`,
          400,
          'INSUFFICIENT_STOCK',
          { itemId: existing.id, available: availableQty, requested: consumeQty }
        );
      }

      validatedItems.push({
        item: existing,
        consumeQuantity: consumeQty,
        remainingQuantity: Number((availableQty - consumeQty).toFixed(2))
      });
    }

    // 2. Apply updates and record events
    const consumedResults = [];
    const avoidedWasteItems = [];
    let totalAvoidedSavings = 0;

    for (const { item, consumeQuantity, remainingQuantity } of validatedItems) {
      const isDepleted = remainingQuantity <= 0;
      const newStatus = isDepleted ? 'consumed' : 'active';

      const { data: updatedItem, error } = await db
        .from('inventory_items')
        .update({
          quantity: remainingQuantity,
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', item.id)
        .eq('household_id', householdId)
        .select('*')
        .single();

      if (error) {
        logger.error({ itemId: item.id, error: error.message }, 'Failed to decrement inventory quantity');
        throw error;
      }

      // Record inventory lifecycle event
      await this.logEvent({
        household_id: householdId,
        inventory_item_id: item.id,
        event_type: 'consumed',
        quantity_change: -consumeQuantity,
        unit: item.unit,
        notes: `Consumed ${consumeQuantity} ${item.unit} via ${context.source || 'multi-item consumption'}${context.recipe_name ? ` (${context.recipe_name})` : ''}`,
        created_by: userId
      }, db);

      consumedResults.push({
        item_id: item.id,
        name: item.name,
        consumed_quantity: consumeQuantity,
        remaining_quantity: remainingQuantity,
        unit: item.unit,
        status: newStatus
      });

      // 3. Compute avoided-waste savings if item was at risk
      const isAtRisk = (item.use_first_score && item.use_first_score >= 70) ||
        (item.adj_days_left !== null && item.adj_days_left !== undefined && item.adj_days_left <= 2) ||
        (item.freshness_bucket === 'critical' || item.freshness_bucket === 'use_soon');

      if (isAtRisk && item.estimated_unit_price !== null && item.estimated_unit_price !== undefined) {
        const itemSavings = Number((consumeQuantity * Number(item.estimated_unit_price)).toFixed(2));
        if (itemSavings > 0) {
          totalAvoidedSavings += itemSavings;

          // Record in avoided_waste_log
          await db
            .from('avoided_waste_logs')
            .insert({
              household_id: householdId,
              inventory_item_id: item.id,
              item_name: item.name,
              quantity: consumeQuantity,
              unit: item.unit,
              estimated_savings: itemSavings,
              source: context.source || 'recipe_rescue',
              recipe_name: context.recipe_name || null,
              recorded_by: userId,
              consumed_at: new Date().toISOString()
            });

          avoidedWasteItems.push({
            item_id: item.id,
            name: item.name,
            quantity: consumeQuantity,
            unit: item.unit,
            estimated_savings: itemSavings
          });
        }
      }
    }

    return {
      consumed_items: consumedResults,
      total_avoided_savings: Number(totalAvoidedSavings.toFixed(2)),
      avoided_waste_items: avoidedWasteItems
    };
  }
}

export const inventoryRepository = new InventoryRepository();
export default inventoryRepository;
