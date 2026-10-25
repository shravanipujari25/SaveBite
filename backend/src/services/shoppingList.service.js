import { shoppingListRepository } from '../repositories/shoppingList.repository.js';
import { inventoryRepository } from '../repositories/inventory.repository.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';
import { normalizeItemName, normalizeUnit, convertUnit, isItemNameMatch } from '../utils/unitConverter.js';

export class ShoppingListService {
  constructor(repository = shoppingListRepository, inventoryRepo = inventoryRepository) {
    this.repo = repository;
    this.invRepo = inventoryRepo;
  }

  /**
   * Helper to check if an item has expired
   */
  isExpired(expiryDate) {
    if (!expiryDate) return false;
    const todayStr = new Date().toISOString().split('T')[0];
    return expiryDate < todayStr;
  }

  /**
   * Evaluate pantry duplicate and overbuy status for a candidate shopping list item.
   * Compares against usable (non-expired) pantry stock and other active shopping items.
   *
   * @param {string} householdId
   * @param {string} name
   * @param {number} requestedQty
   * @param {string} requestedUnit
   * @param {string} [excludeItemId]
   * @returns {Promise<{ warnings: object[], pantryMatch: object|null }>}
   */
  async evaluateDuplicates(householdId, name, requestedQty = 1, requestedUnit = 'piece', excludeItemId = null) {
    const warnings = [];
    let pantryMatch = null;

    const activeInventory = await this.repo.findActiveInventoryItems(householdId);
    const candidateNormName = normalizeItemName(name);

    // 1. Check Pantry Inventory for matches
    const matchingPantryItems = activeInventory.filter(inv => isItemNameMatch(inv.name, candidateNormName));

    // Usable stock excludes already expired inventory
    let totalUsablePantryQty = 0;
    let closestExpiryDate = null;
    let matchingLocations = new Set();

    for (const inv of matchingPantryItems) {
      const expired = this.isExpired(inv.expiry_date);
      if (!expired) {
        // Convert to requested unit if possible
        const converted = convertUnit(Number(inv.quantity) || 0, inv.unit, requestedUnit);
        if (converted !== null) {
          totalUsablePantryQty += converted;
        } else {
          // Incompatible units: treat as same nominal quantity
          totalUsablePantryQty += Number(inv.quantity) || 0;
        }

        if (inv.expiry_date) {
          if (!closestExpiryDate || inv.expiry_date < closestExpiryDate) {
            closestExpiryDate = inv.expiry_date;
          }
        }

        if (inv.storage_location) {
          matchingLocations.add(inv.storage_location);
        }
      }
    }

    if (matchingPantryItems.length > 0) {
      const firstMatch = matchingPantryItems[0];
      const shortage = Math.max(0, requestedQty - totalUsablePantryQty);
      const surplus = Math.max(0, totalUsablePantryQty - requestedQty);

      pantryMatch = {
        name: firstMatch.name,
        existing_quantity: Number(totalUsablePantryQty.toFixed(2)),
        unit: requestedUnit,
        expiry_date: closestExpiryDate,
        storage_locations: Array.from(matchingLocations),
        shortage: Number(shortage.toFixed(2)),
        surplus: Number(surplus.toFixed(2)),
        is_sufficient: totalUsablePantryQty >= requestedQty
      };

      if (totalUsablePantryQty > 0) {
        const locationText = firstMatch.storage_location ? ` stored in ${firstMatch.storage_location}` : '';
        warnings.push({
          type: 'inventory_overbuy_warning',
          message: `You already have ${pantryMatch.existing_quantity} ${requestedUnit} of '${firstMatch.name}' in your pantry${locationText}${closestExpiryDate ? ` (expires ${closestExpiryDate})` : ''}. You may not need to buy more.`,
          existing_pantry_quantity: pantryMatch.existing_quantity,
          requested_quantity: requestedQty,
          unit: requestedUnit,
          surplus: pantryMatch.surplus,
          shortage: pantryMatch.shortage,
          expiry_date: closestExpiryDate,
          existing_item: {
            id: firstMatch.id,
            name: firstMatch.name,
            quantity: firstMatch.quantity,
            unit: firstMatch.unit,
            storage_location: firstMatch.storage_location,
            expiry_date: firstMatch.expiry_date
          }
        });
      }
    }

    // 2. Check for other active unpurchased items in the shopping list
    const existingList = await this.repo.findMany(householdId, { is_purchased: false });
    const duplicateListItem = existingList.find(
      (item) => item.id !== excludeItemId && isItemNameMatch(item.name, candidateNormName)
    );

    if (duplicateListItem) {
      warnings.push({
        type: 'shopping_list_duplicate_warning',
        message: `'${name}' is already on your active shopping list with quantity ${duplicateListItem.quantity} ${duplicateListItem.unit}.`,
        existing_shopping_item_id: duplicateListItem.id,
        existing_quantity: duplicateListItem.quantity,
        unit: duplicateListItem.unit
      });
    }

    return { warnings, pantryMatch };
  }

  /**
   * Create a new shopping list item with duplicate and pantry-overbuy detection.
   *
   * @param {string} householdId
   * @param {string} userId
   * @param {object} itemData
   * @returns {Promise<{ item: object, warnings: object[], pantry_match: object|null }>}
   */
  async createItem(householdId, userId, itemData) {
    const requestedQty = Number(itemData.quantity) || 1;
    const requestedUnit = normalizeUnit(itemData.unit || 'piece');

    const { warnings, pantryMatch } = await this.evaluateDuplicates(
      householdId,
      itemData.name,
      requestedQty,
      requestedUnit
    );

    const created = await this.repo.create({
      ...itemData,
      household_id: householdId,
      added_by: userId,
      created_by: userId,
      unit: requestedUnit,
      status: itemData.status || 'needed',
      estimated_price: itemData.estimated_price !== undefined ? itemData.estimated_price : 3.50,
      recommendation_reason: itemData.recommendation_reason || (pantryMatch?.is_sufficient ? 'Pantry stock check' : null)
    });

    logger.info(
      { id: created.id, householdId, warningsCount: warnings.length },
      'Shopping list item created successfully'
    );

    return {
      item: {
        ...created,
        pantry_match: pantryMatch
      },
      warnings,
      pantry_match: pantryMatch
    };
  }

  /**
   * List shopping list items for a household with pantry awareness and duplicate checks.
   *
   * @param {string} householdId
   * @param {object} query
   * @returns {Promise<object[]>}
   */
  async getItems(householdId, query = {}) {
    const items = await this.repo.findMany(householdId, query);
    const activeInventory = await this.repo.findActiveInventoryItems(householdId);

    // Enrich active items with live pantry stock comparison
    return items.map((item) => {
      const normName = normalizeItemName(item.name);
      const matches = activeInventory.filter(inv => isItemNameMatch(inv.name, normName));

      let usableQty = 0;
      let closestExpiry = null;
      for (const m of matches) {
        if (!this.isExpired(m.expiry_date)) {
          const conv = convertUnit(Number(m.quantity) || 0, m.unit, item.unit);
          usableQty += conv !== null ? conv : Number(m.quantity) || 0;
          if (m.expiry_date && (!closestExpiry || m.expiry_date < closestExpiry)) {
            closestExpiry = m.expiry_date;
          }
        }
      }

      return {
        ...item,
        status: item.status || (item.is_purchased ? 'purchased' : 'needed'),
        pantry_stock: {
          available_quantity: Number(usableQty.toFixed(2)),
          unit: item.unit,
          has_stock: usableQty > 0,
          closest_expiry: closestExpiry,
          is_potential_duplicate: usableQty >= Number(item.quantity)
        }
      };
    });
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
    if (updates.unit) {
      payload.unit = normalizeUnit(updates.unit);
    }

    // Sync is_purchased and status fields
    if (updates.status === 'purchased' || updates.is_purchased === true) {
      payload.is_purchased = true;
      payload.status = 'purchased';
      if (!existing.purchased_at) {
        payload.purchased_at = new Date().toISOString();
      }
    } else if (updates.status && updates.status !== 'purchased') {
      payload.is_purchased = false;
      payload.purchased_at = null;
    } else if (updates.is_purchased === false) {
      payload.is_purchased = false;
      payload.status = 'needed';
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
   * Mark a shopping list item as purchased and record purchase event into actual pantry inventory.
   * Supports partial purchase quantity and price recording.
   *
   * @param {string} householdId
   * @param {string} userId
   * @param {string} id
   * @param {object} [purchaseData={}]
   * @returns {Promise<{ item: object, inventoryItem: object, partial: boolean }>}
   */
  async markPurchased(householdId, userId, id, purchaseData = {}) {
    const existing = await this.repo.findById(id, householdId);
    if (!existing) {
      throw new AppError('Shopping list item not found', 404, 'NOT_FOUND');
    }

    if (existing.is_purchased) {
      // Prevent accidental duplicate inventory additions if already purchased
      return {
        item: existing,
        inventoryItem: null,
        message: 'Item has already been purchased'
      };
    }

    const requestedQty = Number(existing.quantity) || 1;
    const purchasedQty = purchaseData.purchased_quantity !== undefined && purchaseData.purchased_quantity !== null
      ? Number(purchaseData.purchased_quantity)
      : requestedQty;

    if (purchasedQty <= 0) {
      throw new AppError('Purchased quantity must be greater than zero', 400, 'INVALID_QUANTITY');
    }

    const isPartial = purchasedQty < requestedQty;
    const purchasePrice = purchaseData.purchase_price !== undefined ? Number(purchaseData.purchase_price) : (existing.estimated_price || null);
    const purchaseDate = purchaseData.purchase_date || new Date().toISOString().split('T')[0];
    const expiryDate = purchaseData.expiry_date || null;
    const storageLocation = purchaseData.storage_location || 'pantry';

    // 1. Add purchased quantity to actual pantry inventory (or update existing pantry item)
    const matchingPantry = await this.repo.findMatchingPantryItem(householdId, existing.name);
    let inventoryItem;

    if (matchingPantry && matchingPantry.unit === existing.unit && matchingPantry.storage_location === storageLocation) {
      // Merge into existing active inventory item
      const newPantryQty = Number((Number(matchingPantry.quantity) + purchasedQty).toFixed(2));
      inventoryItem = await this.invRepo.update(matchingPantry.id, householdId, {
        quantity: newPantryQty,
        status: 'active',
        purchase_date: purchaseDate,
        ...(expiryDate ? { expiry_date: expiryDate } : {})
      });

      // Audit event
      await this.invRepo.logEvent({
        household_id: householdId,
        inventory_item_id: matchingPantry.id,
        event_type: 'restocked',
        quantity_change: purchasedQty,
        unit: existing.unit,
        notes: `Purchased via shopping list (${existing.name})${purchasePrice ? ` at ₹${purchasePrice}` : ''}`,
        created_by: userId
      });
    } else {
      // Create new inventory item in pantry
      inventoryItem = await this.invRepo.create({
        household_id: householdId,
        name: existing.name,
        category: existing.category || 'other',
        quantity: purchasedQty,
        unit: existing.unit,
        storage_location: storageLocation,
        purchase_date: purchaseDate,
        expiry_date: expiryDate,
        estimated_unit_price: purchasePrice && purchasedQty > 0 ? Number((purchasePrice / purchasedQty).toFixed(2)) : null,
        created_by: userId
      });

      // Audit event
      await this.invRepo.logEvent({
        household_id: householdId,
        inventory_item_id: inventoryItem.id,
        event_type: 'purchased',
        quantity_change: purchasedQty,
        unit: existing.unit,
        notes: `Added from shopping list${purchasePrice ? ` for ₹${purchasePrice}` : ''}`,
        created_by: userId
      });
    }

    // 2. Update shopping list item status
    let updatedListItem;
    if (isPartial) {
      // Partial purchase: deduct bought quantity and leave remaining requested
      const remainingQty = Number((requestedQty - purchasedQty).toFixed(2));
      updatedListItem = await this.repo.update(id, householdId, {
        quantity: remainingQty,
        status: 'needed',
        is_purchased: false,
        notes: existing.notes ? `${existing.notes} (Partial: bought ${purchasedQty} ${existing.unit})` : `Partial: bought ${purchasedQty} ${existing.unit}`
      });
    } else {
      // Complete purchase
      updatedListItem = await this.repo.update(id, householdId, {
        is_purchased: true,
        status: 'purchased',
        purchased_at: new Date().toISOString(),
        purchased_quantity: purchasedQty,
        purchase_price: purchasePrice
      });
    }

    logger.info(
      { listItemId: id, householdId, purchasedQty, isPartial },
      'Shopping list item marked purchased and added to inventory'
    );

    return {
      item: updatedListItem,
      inventoryItem,
      partial: isPartial,
      purchasedQuantity: purchasedQty
    };
  }

  /**
   * Generate Smart Shopping Recommendations:
   * 1. Low-Stock items (usable quantity < min_stock_level, target = preferred_stock_level or min_stock_level)
   * 2. Consumption-Based replenishment (average daily consumption * replenishment_days - usable_stock)
   *
   * @param {string} householdId
   * @param {object} [options={}]
   * @returns {Promise<{ recommendations: object[], summary: object }>}
   */
  async getRecommendations(householdId, options = {}) {
    const replenishmentDays = Number(options.replenishment_days) || 7;
    const activeInventory = await this.repo.findActiveInventoryItems(householdId);
    const consumptionEvents = await this.repo.findConsumptionEvents(householdId, 30);
    const existingShoppingList = await this.repo.findMany(householdId, { is_purchased: false });

    const recommendations = [];

    // Map existing active list names to avoid recommending already queued items
    const alreadyOnShoppingList = new Set(
      existingShoppingList.map(item => normalizeItemName(item.name))
    );

    // Group inventory items by normalized name to sum total usable stock
    const inventoryGroupMap = new Map();
    for (const item of activeInventory) {
      const normName = normalizeItemName(item.name);
      if (!inventoryGroupMap.has(normName)) {
        inventoryGroupMap.set(normName, {
          name: item.name,
          category: item.category || 'other',
          unit: item.unit,
          minStock: item.min_stock_level !== undefined && item.min_stock_level !== null ? Number(item.min_stock_level) : 1,
          preferredStock: item.preferred_stock_level !== undefined && item.preferred_stock_level !== null ? Number(item.preferred_stock_level) : null,
          estimatedUnitPrice: item.estimated_unit_price !== null && item.estimated_unit_price !== undefined ? Number(item.estimated_unit_price) : null,
          usableQuantity: 0,
          expiredQuantity: 0,
          items: []
        });
      }

      const group = inventoryGroupMap.get(normName);
      group.items.push(item);
      if (!group.estimatedUnitPrice && item.estimated_unit_price) {
        group.estimatedUnitPrice = Number(item.estimated_unit_price);
      }

      if (this.isExpired(item.expiry_date)) {
        group.expiredQuantity += Number(item.quantity) || 0;
      } else {
        const conv = convertUnit(Number(item.quantity) || 0, item.unit, group.unit);
        group.usableQuantity += conv !== null ? conv : Number(item.quantity) || 0;
      }
    }

    // Analyze Consumption History from inventory_events
    const consumptionHistoryMap = new Map();
    for (const evt of consumptionEvents) {
      if (evt.inventory_item_id) {
        const invItem = activeInventory.find(i => i.id === evt.inventory_item_id);
        const name = invItem ? invItem.name : evt.notes?.match(/of '([^']+)'/)?.[1] || null;
        if (name) {
          const normName = normalizeItemName(name);
          const currentTotal = consumptionHistoryMap.get(normName) || { totalConsumed: 0, count: 0, unit: evt.unit };
          const qty = Math.abs(Number(evt.quantity_change) || 0);
          currentTotal.totalConsumed += qty;
          currentTotal.count += 1;
          consumptionHistoryMap.set(normName, currentTotal);
        }
      }
    }

    // 1. Evaluate Low-Stock Recommendations
    for (const [normName, group] of inventoryGroupMap.entries()) {
      if (alreadyOnShoppingList.has(normName)) {
        continue;
      }

      const currentUsable = Number(group.usableQuantity.toFixed(2));
      const minStock = group.minStock;
      const targetStock = group.preferredStock || minStock;

      // Check if consumption history is available
      const history = consumptionHistoryMap.get(normName);
      const hasConsumptionHistory = history && history.totalConsumed > 0 && history.count >= 2;

      if (hasConsumptionHistory) {
        // Consumption-based recommendation
        const dailyRate = history.totalConsumed / 30;
        const estimatedDemand = Number((dailyRate * replenishmentDays).toFixed(2));
        const suggestedQty = Math.max(0, Number((estimatedDemand - currentUsable).toFixed(2)));

        if (suggestedQty > 0) {
          const daysFrequency = Math.max(1, Math.round(1 / dailyRate));
          recommendations.push({
            id: `rec-cons-${normName}`,
            name: group.name,
            category: group.category,
            unit: group.unit,
            suggested_quantity: suggestedQty,
            estimated_price: group.estimatedUnitPrice !== null ? group.estimatedUnitPrice : null,
            current_usable_stock: currentUsable,
            min_stock_level: minStock,
            preferred_stock_level: group.preferredStock,
            type: 'consumption_based',
            badge: 'Consumption-Based',
            confidence: 'high',
            reason: `You typically consume around ${(dailyRate * 3).toFixed(1)} ${group.unit} every ${daysFrequency * 3} days. You have ${currentUsable} ${group.unit} available, so consider buying ${suggestedQty} ${group.unit} for the next ${replenishmentDays} days.`
          });
          continue;
        }
      }

      // Fallback: Stock-level recommendation
      if (currentUsable < minStock) {
        const suggestedQty = Math.max(0, Number((targetStock - currentUsable).toFixed(2)));
        if (suggestedQty > 0) {
          recommendations.push({
            id: `rec-stock-${normName}`,
            name: group.name,
            category: group.category,
            unit: group.unit,
            suggested_quantity: suggestedQty,
            estimated_price: group.estimatedUnitPrice !== null ? group.estimatedUnitPrice : null,
            current_usable_stock: currentUsable,
            min_stock_level: minStock,
            preferred_stock_level: group.preferredStock,
            type: 'stock_based',
            badge: 'Low Stock',
            confidence: 'medium',
            reason: `Available pantry stock (${currentUsable} ${group.unit}) is below your minimum threshold of ${minStock} ${group.unit}. Suggested replenishment: ${suggestedQty} ${group.unit}.`
          });
        }
      }
    }

    return {
      recommendations,
      summary: {
        total_recommendations: recommendations.length,
        stock_based_count: recommendations.filter(r => r.type === 'stock_based').length,
        consumption_based_count: recommendations.filter(r => r.type === 'consumption_based').length,
        replenishment_period_days: replenishmentDays
      }
    };
  }
}

export const shoppingListService = new ShoppingListService();
export default shoppingListService;
