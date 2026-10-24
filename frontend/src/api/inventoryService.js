/**
 * SaveBite Inventory Service
 * Manages pantry items, item actions (consume, waste, open), activity logs,
 * and derived dashboard summaries.
 * Connected to live Node.js + Express backend with optional mock mode.
 */

import { request, USE_MOCKS } from './httpClient'
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

/**
 * Maps a single backend inventory_item record to the frontend pantry item format
 */
export function mapBackendItemToFrontend(item) {
  if (!item) return null
  const days = calculateDaysRemaining(item.expiry_date)
  const status = item.freshness_bucket === 'use_soon' && days <= 1
    ? 'critical'
    : (item.freshness_bucket || getFreshnessStatus(days))

  const qty = Number(item.quantity) || 1
  const unitPrice = Number(item.estimated_unit_price) || 0

  return {
    id: item.id,
    name: item.name,
    category: item.category,
    quantity: qty,
    unit: item.unit || 'piece',
    location: item.storage_location === 'refrigerator' ? 'fridge' : (item.storage_location || 'pantry'),
    storageZone: item.storage_location === 'refrigerator'
      ? 'Refrigerator Shelf'
      : item.storage_location === 'freezer'
      ? 'Freezer Bin'
      : item.storage_location === 'counter'
      ? 'Countertop'
      : 'Pantry Storage',
    purchaseDate: item.purchase_date || '',
    expiryDate: item.expiry_date || '',
    daysRemaining: days,
    freshnessScore: Math.max(0, Math.min(100, 100 - (Number(item.use_first_score) || 0))),
    status,
    estimatedCost: Number((unitPrice * qty).toFixed(2)),
    estimatedUnitPrice: unitPrice,
    barcode: '',
    isOpened: Boolean(item.is_opened),
    openedDate: item.opened_at ? item.opened_at.split('T')[0] : null,
    lowStockThreshold: 1,
    priorityReason: days <= 1
      ? 'Expires in <= 24h. Spoilage risk high.'
      : item.is_opened
      ? 'Package opened. Consume soon.'
      : `Expires in ${days} days.`,
    notes: '',
    imageEmoji: getEmojiForCategory(item.category),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

/**
 * Category emoji helper
 */
export function getEmojiForCategory(cat = '') {
  const c = String(cat).toLowerCase()
  if (c.includes('produce')) return '🥦'
  if (c.includes('dairy')) return '🥛'
  if (c.includes('bakery')) return '🍞'
  if (c.includes('meat')) return '🍗'
  if (c.includes('beverage')) return '🧃'
  if (c.includes('frozen')) return '🧊'
  if (c.includes('leftover')) return '🍲'
  if (c.includes('snack')) return '🍿'
  if (c.includes('pantry')) return '🥫'
  return '🥗'
}

/**
 * Category enum mapper to valid backend schema
 */
export function mapCategoryToBackend(cat = '') {
  const c = String(cat).toLowerCase()
  if (c.includes('produce') || c.includes('veg') || c.includes('fruit')) return 'produce'
  if (c.includes('dairy') || c.includes('egg') || c.includes('milk')) return 'dairy'
  if (c.includes('bakery') || c.includes('bread')) return 'bakery'
  if (c.includes('meat') || c.includes('poultry') || c.includes('seafood') || c.includes('fish')) return 'meat'
  if (c.includes('beverage') || c.includes('drink') || c.includes('juice')) return 'beverages'
  if (c.includes('frozen')) return 'frozen'
  if (c.includes('leftover')) return 'leftovers'
  if (c.includes('snack')) return 'snacks'
  if (c.includes('pantry') || c.includes('grain')) return 'pantry'
  return 'other'
}

/**
 * Unit enum mapper to valid backend schema
 */
export function mapUnitToBackend(unit = '') {
  const u = String(unit).toLowerCase().trim()
  if (['g', 'gram', 'grams'].includes(u)) return 'g'
  if (['kg', 'kilo', 'kilogram', 'kilograms'].includes(u)) return 'kg'
  if (['ml', 'milliliter'].includes(u)) return 'ml'
  if (['l', 'liter', 'liters', 'litre'].includes(u)) return 'l'
  if (['piece', 'pieces', 'pcs', 'pc'].includes(u)) return 'piece'
  if (['pack', 'packs', 'packet', 'packets', 'box', 'boxes', 'bag', 'bags'].includes(u)) return 'pack'
  if (['can', 'cans', 'tin', 'tins'].includes(u)) return 'can'
  if (['bottle', 'bottles'].includes(u)) return 'bottle'
  if (['serving', 'servings', 'portion'].includes(u)) return 'serving'
  if (['oz', 'ounce'].includes(u)) return 'oz'
  if (['lb', 'lbs', 'pound', 'pounds'].includes(u)) return 'lb'
  return 'item'
}

/**
 * Storage location mapper to valid backend schema
 */
export function mapLocationToBackend(loc = '') {
  const l = String(loc).toLowerCase().trim()
  if (l.includes('fridge') || l.includes('refrigerat')) return 'refrigerator'
  if (l.includes('freezer')) return 'freezer'
  if (l.includes('counter')) return 'counter'
  if (l.includes('pantry') || l.includes('cupboard') || l.includes('shelf')) return 'pantry'
  return 'other'
}

/**
 * Waste reason mapper to valid backend schema
 */
export function mapWasteReasonToBackend(reason = '') {
  const r = String(reason).toLowerCase().trim()
  if (r.includes('expire')) return 'expired'
  if (r.includes('spoil') || r.includes('mold') || r.includes('rot') || r.includes('sour')) return 'spoiled'
  if (r.includes('damag') || r.includes('drop') || r.includes('broken')) return 'damaged'
  if (r.includes('leftover') || r.includes('uneaten')) return 'leftover'
  return 'other'
}

export const inventoryService = {
  isMockMode: USE_MOCKS,

  /**
   * Fetch all pantry items
   */
  async getItems(queryParams = {}) {
    if (USE_MOCKS) {
      await delay()
      const rawItems = getStoredOrInitial(STORAGE_KEY_PANTRY, initialPantryItems)
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
    }

    const searchParams = new URLSearchParams()
    if (queryParams.search) searchParams.set('search', queryParams.search)
    if (queryParams.category) searchParams.set('category', queryParams.category)
    if (queryParams.storage_location) searchParams.set('storage_location', queryParams.storage_location)
    searchParams.set('status', queryParams.status || 'active')
    searchParams.set('limit', queryParams.limit || '100')

    const res = await request(`/inventory?${searchParams.toString()}`)
    if (res.error) {
      return { data: null, error: res.error, status: res.status }
    }

    const items = res.data?.items || (Array.isArray(res.data) ? res.data : [])
    const mapped = items.map(mapBackendItemToFrontend)
    return { data: mapped, error: null, status: res.status }
  },

  /**
   * Get item by ID
   */
  async getItemById(id) {
    if (USE_MOCKS) {
      await delay(50)
      const { data: items } = await this.getItems()
      const found = (items || []).find((i) => i.id === id)
      if (!found) return { data: null, error: 'Item not found' }
      return { data: found, error: null }
    }

    const res = await request(`/inventory/${id}`)
    if (res.error) {
      return { data: null, error: res.error, status: res.status }
    }
    const item = res.data?.item || res.data
    return { data: mapBackendItemToFrontend(item), error: null, status: res.status }
  },

  /**
   * Add new grocery item
   */
  async addItem(newItem) {
    if (USE_MOCKS) {
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
      await this.recordActivity({
        type: 'added',
        itemId: created.id,
        itemName: created.name,
        quantity: created.quantity,
        unit: created.unit,
        notes: `Logged into ${created.location}.`,
      })
      return { data: created, error: null }
    }

    const qty = Number(newItem.quantity) || 1
    const cost = Number(newItem.estimatedCost) || 0
    const unitPrice = qty > 0 && cost > 0 ? Number((cost / qty).toFixed(2)) : (cost || 0)

    const payload = {
      name: newItem.name.trim(),
      category: mapCategoryToBackend(newItem.category),
      quantity: qty,
      unit: mapUnitToBackend(newItem.unit),
      storage_location: mapLocationToBackend(newItem.location),
      purchase_date: newItem.purchaseDate ? newItem.purchaseDate.split('T')[0] : new Date().toISOString().split('T')[0],
      expiry_date: newItem.expiryDate ? newItem.expiryDate.split('T')[0] : null,
      estimated_unit_price: unitPrice,
      currency: 'USD',
    }

    const res = await request('/inventory', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    if (res.error) {
      return { data: null, error: res.error, status: res.status }
    }

    const created = mapBackendItemToFrontend(res.data?.item || res.data)
    return { data: created, error: null, status: res.status }
  },

  /**
   * Action: Mark item as consumed
   */
  async consumeItem(id, consumeQuantity, notes = '') {
    if (USE_MOCKS) {
      await delay(120)
      const rawItems = getStoredOrInitial(STORAGE_KEY_PANTRY, initialPantryItems)
      const index = rawItems.findIndex((i) => i.id === id)
      if (index === -1) return { data: null, error: 'Item not found in pantry' }

      const item = rawItems[index]
      const qtyToConsume = Math.min(Number(consumeQuantity) || item.quantity, item.quantity)
      const remainingQty = item.quantity - qtyToConsume
      const unitPrice = item.estimatedCost ? item.estimatedCost / (item.quantity || 1) : 0
      const valueSaved = Number((unitPrice * qtyToConsume).toFixed(2))

      let updatedList
      if (remainingQty <= 0) {
        updatedList = rawItems.filter((i) => i.id !== id)
      } else {
        const updatedItem = { ...item, quantity: remainingQty }
        updatedList = [...rawItems]
        updatedList[index] = updatedItem
      }
      setStored(STORAGE_KEY_PANTRY, updatedList)
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
    }

    const res = await request(`/inventory/${id}/consume`, {
      method: 'POST',
      body: JSON.stringify({
        quantity: Number(consumeQuantity) || 1,
      }),
    })

    if (res.error) {
      return { data: null, error: res.error, status: res.status }
    }
    return { data: res.data, error: null, status: res.status }
  },

  /**
   * Action: Mark item as wasted
   */
  async wasteItem(id, wasteQuantity, reason = 'Spoiled', notes = '') {
    if (USE_MOCKS) {
      await delay(120)
      const rawItems = getStoredOrInitial(STORAGE_KEY_PANTRY, initialPantryItems)
      const index = rawItems.findIndex((i) => i.id === id)
      if (index === -1) return { data: null, error: 'Item not found in pantry' }

      const item = rawItems[index]
      const qtyToWaste = Math.min(Number(wasteQuantity) || item.quantity, item.quantity)
      const remainingQty = item.quantity - qtyToWaste
      const unitPrice = item.estimatedCost ? item.estimatedCost / (item.quantity || 1) : 0
      const valueLost = Number((unitPrice * qtyToWaste).toFixed(2))

      let updatedList
      if (remainingQty <= 0) {
        updatedList = rawItems.filter((i) => i.id !== id)
      } else {
        const updatedItem = { ...item, quantity: remainingQty }
        updatedList = [...rawItems]
        updatedList[index] = updatedItem
      }
      setStored(STORAGE_KEY_PANTRY, updatedList)
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
    }

    const res = await request(`/inventory/${id}/waste`, {
      method: 'POST',
      body: JSON.stringify({
        quantity: Number(wasteQuantity) || 1,
        reason: mapWasteReasonToBackend(reason),
      }),
    })

    if (res.error) {
      return { data: null, error: res.error, status: res.status }
    }
    return { data: res.data, error: null, status: res.status }
  },

  /**
   * Action: Mark item as opened
   */
  async openItem(id) {
    if (USE_MOCKS) {
      await delay(100)
      const rawItems = getStoredOrInitial(STORAGE_KEY_PANTRY, initialPantryItems)
      const index = rawItems.findIndex((i) => i.id === id)
      if (index === -1) return { data: null, error: 'Item not found in pantry' }

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
    }

    const res = await request(`/inventory/${id}/open`, {
      method: 'POST',
    })

    if (res.error) {
      return { data: null, error: res.error, status: res.status }
    }
    return { data: mapBackendItemToFrontend(res.data?.item || res.data), error: null, status: res.status }
  },

  /**
   * Delete / archive item
   */
  async deleteItem(id) {
    if (USE_MOCKS) {
      await delay(80)
      const rawItems = getStoredOrInitial(STORAGE_KEY_PANTRY, initialPantryItems)
      const filtered = rawItems.filter((i) => i.id !== id)
      setStored(STORAGE_KEY_PANTRY, filtered)
      return { data: { id, success: true }, error: null }
    }

    const res = await request(`/inventory/${id}`, {
      method: 'DELETE',
    })

    if (res.error) {
      return { data: null, error: res.error, status: res.status }
    }
    return { data: { id, success: true }, error: null, status: res.status }
  },

  /**
   * Fetch recent pantry activity logs
   */
  async getActivityLogs() {
    if (USE_MOCKS) {
      await delay(50)
      const logs = getStoredOrInitial(STORAGE_KEY_ACTIVITY, initialActivityLogs)
      return { data: logs, error: null }
    }

    // On backend, fetch notifications or derive recent activity
    const notifRes = await request('/notifications?limit=10')
    const notifs = notifRes.data?.notifications || notifRes.data || []

    const mappedActivities = (Array.isArray(notifs) ? notifs : []).map((n) => ({
      id: n.id,
      timestamp: n.created_at,
      type: n.type || 'status_alert',
      itemName: n.title,
      notes: n.message,
    }))

    return { data: mappedActivities, error: null }
  },

  /**
   * Record new activity entry (mock helper)
   */
  async recordActivity(entry) {
    const logs = getStoredOrInitial(STORAGE_KEY_ACTIVITY, initialActivityLogs)
    const newRecord = {
      id: 'act_' + Date.now().toString(36),
      timestamp: new Date().toISOString(),
      ...entry,
    }
    const updated = [newRecord, ...logs].slice(0, 50)
    setStored(STORAGE_KEY_ACTIVITY, updated)
    return newRecord
  },

  /**
   * Fetch live dashboard summary
   */
  async getDashboardSummary() {
    if (USE_MOCKS) {
      const { data: items } = await this.getItems()
      const { data: activity } = await this.getActivityLogs()

      const totalItems = (items || []).length
      const expiringSoon = (items || []).filter((i) => i.daysRemaining <= 2)
      const lowStock = (items || []).filter((i) => i.quantity <= (i.lowStockThreshold || 1))
      const estimatedValueINR = (items || []).reduce(
        (sum, item) => sum + (Number(item.estimatedCost) || 0),
        0
      )

      const itemsToUseFirst = [...(items || [])]
        .sort((a, b) => {
          if (a.daysRemaining !== b.daysRemaining) return a.daysRemaining - b.daysRemaining
          if (a.isOpened && !b.isOpened) return -1
          if (!a.isOpened && b.isOpened) return 1
          return 0
        })
        .slice(0, 4)

      return {
        data: {
          totalItems,
          expiringSoonCount: expiringSoon.length,
          lowStockCount: lowStock.length,
          estimatedPantryValue: estimatedValueINR,
          itemsToUseFirst,
          recentActivity: (activity || []).slice(0, 6),
          wasteReductionRate: 84,
          monthlySavingsINR: 1850.0,
          carbonFootprintPreventedKg: 14.6,
        },
        error: null,
      }
    }

    const res = await request('/dashboard')
    if (res.error) {
      return { data: null, error: res.error, status: res.status }
    }

    const d = res.data || {}
    const summary = d.summary || {}
    const rawUseFirst = Array.isArray(d.useFirst) ? d.useFirst : []
    const mappedUseFirst = rawUseFirst.map(mapBackendItemToFrontend)

    const { data: activityLogs } = await this.getActivityLogs()

    const totalCount = summary.totalActiveItems ?? summary.totalItems ?? 0
    const estVal = summary.totalEstimatedValue ?? summary.estimatedPantryValue ?? 0
    const expCount = summary.expiringSoonCount ?? summary.expiringSoon ?? 0
    const lowCount = summary.lowStockCount ?? summary.lowStock ?? 0

    return {
      data: {
        totalItems: totalCount,
        expiringSoonCount: expCount,
        lowStockCount: lowCount,
        estimatedPantryValue: estVal,
        itemsToUseFirst: mappedUseFirst,
        recentActivity: activityLogs || [],
        wasteReductionRate: 85,
        monthlySavingsINR: Number((estVal * 0.35).toFixed(2)),
        carbonFootprintPreventedKg: Number((totalCount * 1.4).toFixed(1)),
      },
      error: null,
      status: res.status,
    }
  },

  /**
   * Freshness image scan
   */
  async scanFreshness(itemId, imageFile) {
    const formData = new FormData()
    formData.append('image', imageFile)
    return request(`/inventory/${itemId}/freshness-scan`, {
      method: 'POST',
      body: formData,
    })
  },
}

export default inventoryService
