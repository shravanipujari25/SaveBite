/**
 * SaveBite Inventory Service
 * Manages pantry items, item actions (consume, waste, open), activity logs,
 * and derived dashboard summaries.
 * Keeps inventory logic separate from UI components for clean future backend integration.
 */

import initialPantryItems from '../mocks/pantryItems.json'
import initialActivityLogs from '../mocks/activityLogs.json'
import { calculateDaysRemaining, getFreshnessStatus } from '../utils/freshness'

const STORAGE_KEY_PANTRY = 'savebite_mock_pantry'
const STORAGE_KEY_ACTIVITY = 'savebite_mock_activity_logs'

function getStoredOrInitial(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch (err) {
    console.warn(`[inventoryService] Error reading ${key} from storage:`, err)
  }
  return fallback
}

function setStored(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch (err) {
    console.warn(`[inventoryService] Error writing ${key} to storage:`, err)
  }
}

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))

export const inventoryService = {
  /**
   * Fetch all pantry items with dynamic days remaining & status computation
   */
  async getItems() {
    await delay()
    const rawItems = getStoredOrInitial(STORAGE_KEY_PANTRY, initialPantryItems)
    
    // Dynamically calculate days remaining and status
    const computed = rawItems.map((item) => {
      const days = calculateDaysRemaining(item.expiryDate)
      const status = getFreshnessStatus(days)
      return {
        ...item,
        daysRemaining: days,
        status: item.status || status,
      }
    })

    return { data: computed, error: null }
  },

  /**
   * Get item by ID
   */
  async getItemById(id) {
    await delay(50)
    const { data: items } = await this.getItems()
    const found = items.find((i) => i.id === id)
    if (!found) return { data: null, error: 'Item not found' }
    return { data: found, error: null }
  },

  /**
   * Add new grocery item
   */
  async addItem(newItem) {
    await delay(150)
    const rawItems = getStoredOrInitial(STORAGE_KEY_PANTRY, initialPantryItems)
    const days = calculateDaysRemaining(newItem.expiryDate)
    const status = getFreshnessStatus(days)

    const created = {
      id: 'item_' + Date.now().toString(36),
      name: newItem.name.trim(),
      category: newItem.category,
      quantity: Number(newItem.quantity) || 1,
      unit: newItem.unit || 'pcs',
      location: newItem.location || 'fridge',
      storageZone: newItem.storageZone?.trim() || 'General Shelf',
      purchaseDate: newItem.purchaseDate || new Date().toISOString().split('T')[0],
      expiryDate: newItem.expiryDate,
      daysRemaining: days,
      freshnessScore: 95,
      status,
      estimatedCost: Number(newItem.estimatedCost) || 0,
      barcode: newItem.barcode || '',
      isOpened: false,
      openedDate: null,
      lowStockThreshold: Number(newItem.lowStockThreshold) || 1,
      priorityReason: days <= 1 ? 'Expires very soon.' : 'Fresh item added to inventory.',
      notes: newItem.notes?.trim() || '',
      imageEmoji: newItem.imageEmoji || '🥦',
    }

    const updated = [created, ...rawItems]
    setStored(STORAGE_KEY_PANTRY, updated)

    // Add activity record
    await this.recordActivity({
      type: 'added',
      itemId: created.id,
      itemName: created.name,
      quantity: created.quantity,
      unit: created.unit,
      notes: `Logged into ${created.location}.`,
    })

    return { data: created, error: null }
  },

  /**
   * Action: Mark item as consumed
   * Allows specifying consumed quantity. If partial, decreases quantity; if full, removes item.
   */
  async consumeItem(id, consumeQuantity, notes = '') {
    await delay(120)
    const rawItems = getStoredOrInitial(STORAGE_KEY_PANTRY, initialPantryItems)
    const index = rawItems.findIndex((i) => i.id === id)

    if (index === -1) {
      return { data: null, error: 'Item not found in pantry' }
    }

    const item = rawItems[index]
    const qtyToConsume = Math.min(Number(consumeQuantity) || item.quantity, item.quantity)
    const remainingQty = item.quantity - qtyToConsume

    // Calculate value saved in INR
    const unitPrice = item.estimatedCost ? item.estimatedCost / (item.quantity || 1) : 0
    const valueSaved = Number((unitPrice * qtyToConsume).toFixed(2))

    let updatedList
    if (remainingQty <= 0) {
      // Fully consumed -> remove from active inventory
      updatedList = rawItems.filter((i) => i.id !== id)
    } else {
      // Partially consumed
      const updatedItem = {
        ...item,
        quantity: remainingQty,
      }
      updatedList = [...rawItems]
      updatedList[index] = updatedItem
    }

    setStored(STORAGE_KEY_PANTRY, updatedList)

    // Record activity
    await this.recordActivity({
      type: 'consumed',
      itemId: item.id,
      itemName: item.name,
      quantity: qtyToConsume,
      unit: item.unit,
      valueSaved,
      notes: notes || `Consumed ${qtyToConsume} ${item.unit}. Value saved: ₹${valueSaved}`,
    })

    return { data: { success: true, remainingQty, valueSaved }, error: null }
  },

  /**
   * Action: Mark item as wasted
   * Decrements or removes item, records wasted value and reason
   */
  async wasteItem(id, wasteQuantity, reason = 'Spoiled', notes = '') {
    await delay(120)
    const rawItems = getStoredOrInitial(STORAGE_KEY_PANTRY, initialPantryItems)
    const index = rawItems.findIndex((i) => i.id === id)

    if (index === -1) {
      return { data: null, error: 'Item not found in pantry' }
    }

    const item = rawItems[index]
    const qtyToWaste = Math.min(Number(wasteQuantity) || item.quantity, item.quantity)
    const remainingQty = item.quantity - qtyToWaste

    const unitPrice = item.estimatedCost ? item.estimatedCost / (item.quantity || 1) : 0
    const valueLost = Number((unitPrice * qtyToWaste).toFixed(2))

    let updatedList
    if (remainingQty <= 0) {
      updatedList = rawItems.filter((i) => i.id !== id)
    } else {
      const updatedItem = {
        ...item,
        quantity: remainingQty,
      }
      updatedList = [...rawItems]
      updatedList[index] = updatedItem
    }

    setStored(STORAGE_KEY_PANTRY, updatedList)

    // Record activity
    await this.recordActivity({
      type: 'wasted',
      itemId: item.id,
      itemName: item.name,
      quantity: qtyToWaste,
      unit: item.unit,
      valueLost,
      reason,
      notes: notes || `Marked wasted (${reason}). Loss: ₹${valueLost}`,
    })

    return { data: { success: true, remainingQty, valueLost }, error: null }
  },

  /**
   * Action: Mark item as opened
   * Sets isOpened=true, records openedDate=today, updates priority
   */
  async openItem(id) {
    await delay(100)
    const rawItems = getStoredOrInitial(STORAGE_KEY_PANTRY, initialPantryItems)
    const index = rawItems.findIndex((i) => i.id === id)

    if (index === -1) {
      return { data: null, error: 'Item not found in pantry' }
    }

    const todayStr = new Date().toISOString().split('T')[0]
    const item = rawItems[index]

    const updatedItem = {
      ...item,
      isOpened: true,
      openedDate: todayStr,
      priorityReason: `Opened on ${todayStr}. Higher spoilage priority.`,
    }

    rawItems[index] = updatedItem
    setStored(STORAGE_KEY_PANTRY, rawItems)

    await this.recordActivity({
      type: 'opened',
      itemId: item.id,
      itemName: item.name,
      quantity: item.quantity,
      unit: item.unit,
      notes: `Package opened. Prioritize consumption.`,
    })

    return { data: updatedItem, error: null }
  },

  /**
   * Delete item directly
   */
  async deleteItem(id) {
    await delay(80)
    const rawItems = getStoredOrInitial(STORAGE_KEY_PANTRY, initialPantryItems)
    const filtered = rawItems.filter((i) => i.id !== id)
    setStored(STORAGE_KEY_PANTRY, filtered)
    return { data: { id, success: true }, error: null }
  },

  /**
   * Fetch recent pantry activity logs
   */
  async getActivityLogs() {
    await delay(50)
    const logs = getStoredOrInitial(STORAGE_KEY_ACTIVITY, initialActivityLogs)
    return { data: logs, error: null }
  },

  /**
   * Record new activity entry
   */
  async recordActivity(entry) {
    const logs = getStoredOrInitial(STORAGE_KEY_ACTIVITY, initialActivityLogs)
    const newRecord = {
      id: 'act_' + Date.now().toString(36),
      timestamp: new Date().toISOString(),
      ...entry,
    }
    const updated = [newRecord, ...logs].slice(0, 50) // keep latest 50
    setStored(STORAGE_KEY_ACTIVITY, updated)
    return newRecord
  },

  /**
   * Calculate derived dashboard summary from live inventory in INR
   */
  async getDashboardSummary() {
    const { data: items } = await this.getItems()
    const { data: activity } = await this.getActivityLogs()

    const totalItems = items.length
    const expiringSoon = items.filter((i) => i.daysRemaining <= 2)
    const lowStock = items.filter((i) => i.quantity <= (i.lowStockThreshold || 1))

    // Total pantry value in INR
    const estimatedValueINR = items.reduce(
      (sum, item) => sum + (Number(item.estimatedCost) || 0),
      0
    )

    // Items to "Use First" sorted by urgency (critical/use_soon, daysRemaining, opened)
    const itemsToUseFirst = [...items]
      .sort((a, b) => {
        // Prioritize critical and opened items
        if (a.daysRemaining !== b.daysRemaining) {
          return a.daysRemaining - b.daysRemaining
        }
        if (a.isOpened && !b.isOpened) return -1
        if (!a.isOpened && b.isOpened) return 1
        return 0
      })
      .slice(0, 4)
      .map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        expiryDate: item.expiryDate,
        daysRemaining: item.daysRemaining,
        status: item.status,
        imageEmoji: item.imageEmoji,
        location: item.location,
        isOpened: item.isOpened,
        priorityReason:
          item.priorityReason ||
          (item.daysRemaining <= 0
            ? 'Reached expiration date!'
            : item.isOpened
            ? `Opened ${item.openedDate ? 'on ' + item.openedDate : 'recently'}. Use quickly.`
            : `Expires in ${item.daysRemaining} days.`),
      }))

    return {
      data: {
        totalItems,
        expiringSoonCount: expiringSoon.length,
        lowStockCount: lowStock.length,
        estimatedPantryValue: estimatedValueINR,
        itemsToUseFirst,
        recentActivity: activity.slice(0, 6),
        wasteReductionRate: 84, // %
        monthlySavingsINR: 1850.0, // ₹
        carbonFootprintPreventedKg: 14.6,
      },
      error: null,
    }
  },
}

export default inventoryService
