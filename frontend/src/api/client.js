/**
 * SaveBite Unified API Client
 * Centralized service integration connecting frontend components directly to
 * Node.js + Express backend routes, with complete support for mock mode when VITE_USE_MOCKS=true.
 */

import { request, API_BASE_URL, USE_MOCKS, TOKEN_STORAGE_KEY } from './httpClient'
import { authService } from './authService'
import { inventoryService, mapCategoryToBackend, mapUnitToBackend } from './inventoryService'
import initialWasteAnalytics from '../mocks/wasteAnalytics.json'
import initialUserPreferences from '../mocks/userPreferences.json'
import initialPantryItems from '../mocks/pantryItems.json'
import initialShoppingList from '../mocks/shoppingList.json'
import initialRecipes from '../mocks/recipes.json'
import initialStorageAlerts from '../mocks/storageAlerts.json'

// Local storage keys for interactive mock persistence
const STORAGE_KEYS = {
  PANTRY: 'savebite_mock_pantry',
  SHOPPING: 'savebite_mock_shopping',
  ALERTS: 'savebite_mock_alerts',
  PREFERENCES: 'savebite_mock_preferences',
  CONVERSATIONS: 'savebite_mock_assistant',
}

function getStoredOrInitial(key, initialData) {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch (e) {
    console.warn(`[SaveBite API] Failed to parse ${key} from storage:`, e)
  }
  return initialData
}

function setStored(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch (e) {
    console.warn(`[SaveBite API] Failed to write ${key} to storage:`, e)
  }
}

const delay = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms))

export const api = {
  isMockMode: USE_MOCKS,
  baseUrl: API_BASE_URL,

  // ==================== AUTHENTICATION ====================
  auth: authService,

  // ==================== PANTRY & INVENTORY ====================
  pantry: inventoryService,

  // ==================== DASHBOARD & METRICS ====================
  dashboard: {
    async getMetrics() {
      if (USE_MOCKS) {
        const { data: summary } = await inventoryService.getDashboardSummary()
        return { data: summary, error: null }
      }
      return inventoryService.getDashboardSummary()
    },

    async getFreshnessBuckets() {
      if (USE_MOCKS) {
        await delay()
        const raw = localStorage.getItem(STORAGE_KEYS.PANTRY)
        const items = raw ? JSON.parse(raw) : initialPantryItems
        const fresh = items.filter((i) => i.status === 'fresh').length
        const use_soon = items.filter((i) => i.status === 'use_soon').length
        const critical = items.filter((i) => i.status === 'critical').length
        const expired = items.filter((i) => i.status === 'expired').length
        const total = items.length || 1

        const buckets = {
          summary: { fresh, use_soon, critical, expired, total: items.length },
          distribution: [
            { name: 'Fresh (> 4 days)', key: 'fresh', count: fresh, percentage: Math.round((fresh / total) * 100), color: '#10b981' },
            { name: 'Use Soon (2-4 days)', key: 'use_soon', count: use_soon, percentage: Math.round((use_soon / total) * 100), color: '#f59e0b' },
            { name: 'Critical (<= 1 day)', key: 'critical', count: critical, percentage: Math.round((critical / total) * 100), color: '#ef4444' },
            { name: 'Expired', key: 'expired', count: expired, percentage: Math.round((expired / total) * 100), color: '#94a3b8' },
          ],
          upcomingRiskValue: items
            .filter((i) => i.status === 'critical' || i.status === 'use_soon')
            .reduce((sum, item) => sum + (Number(item.estimatedCost) || 0), 0),
          actionRecommended: `${critical} items expire within 24h. Prioritize cooking them tonight.`,
        }
        return { data: buckets, error: null }
      }

      const { data: items, error } = await inventoryService.getItems()
      if (error) {
        return { data: null, error }
      }

      const list = items || []
      const fresh = list.filter((i) => i.status === 'fresh').length
      const use_soon = list.filter((i) => i.status === 'use_soon').length
      const critical = list.filter((i) => i.status === 'critical').length
      const expired = list.filter((i) => i.status === 'expired').length
      const total = list.length || 1

      const buckets = {
        summary: { fresh, use_soon, critical, expired, total: list.length },
        distribution: [
          { name: 'Fresh (> 4 days)', key: 'fresh', count: fresh, percentage: Math.round((fresh / total) * 100), color: '#10b981' },
          { name: 'Use Soon (2-4 days)', key: 'use_soon', count: use_soon, percentage: Math.round((use_soon / total) * 100), color: '#f59e0b' },
          { name: 'Critical (<= 1 day)', key: 'critical', count: critical, percentage: Math.round((critical / total) * 100), color: '#ef4444' },
          { name: 'Expired', key: 'expired', count: expired, percentage: Math.round((expired / total) * 100), color: '#94a3b8' },
        ],
        upcomingRiskValue: list
          .filter((i) => i.status === 'critical' || i.status === 'use_soon')
          .reduce((sum, item) => sum + (Number(item.estimatedCost) || 0), 0),
        actionRecommended: critical > 0
          ? `${critical} items expire within 24h. Prioritize cooking them tonight.`
          : 'Pantry freshness is healthy. Keep tracking expiry dates!',
      }

      return { data: buckets, error: null }
    },
  },

  // ==================== IOT STORAGE & SENSORS ====================
  storage: {
    async getSensors() {
      if (USE_MOCKS) {
        const { getCurrentSensors } = await import('../services/sensorSimulator')
        return { data: getCurrentSensors(), error: null }
      }

      const devRes = await request('/devices')
      if (devRes.error) {
        return { data: null, error: devRes.error, status: devRes.status }
      }

      const devices = devRes.data?.devices || devRes.data || []
      const sensors = await Promise.all(
        devices.map(async (dev) => {
          // Fetch latest readings for device (up to 20 for live charts)
          const readRes = await request(`/devices/${dev.id}/readings?limit=20`)
          const readings = readRes.data?.readings || []
          const latest = readings[0] || null

          const temp = latest?.temperature_c !== undefined && latest?.temperature_c !== null ? Number(latest.temperature_c) : null
          const humidity = latest?.humidity_percent !== undefined && latest?.humidity_percent !== null ? Number(latest.humidity_percent) : null
          const airQualityRaw = latest?.air_quality_raw !== undefined && latest?.air_quality_raw !== null ? Number(latest.air_quality_raw) : null

          const history = readings.slice().reverse().map(r => ({
            time: r.recorded_at,
            temperature: r.temperature_c !== null && r.temperature_c !== undefined ? Number(r.temperature_c) : null,
            humidity: r.humidity_percent !== null && r.humidity_percent !== undefined ? Number(r.humidity_percent) : null,
            gasValue: r.air_quality_raw !== null && r.air_quality_raw !== undefined ? Number(r.air_quality_raw) : null
          }))

          return {
            nodeId: dev.id,
            zone: dev.zone === 'refrigerator' ? 'fridge' : (dev.zone || 'fridge'),
            name: dev.name,
            locationName: `${dev.name} (${dev.zone || 'refrigerator'})`,
            sourceType: dev.source_type || 'physical',
            temperature: temp !== null ? Number(temp.toFixed(1)) : null,
            unitTemp: '°C',
            humidity: humidity !== null ? Number(humidity.toFixed(0)) : null,
            unitHumidity: '%',
            gasValue: airQualityRaw !== null && airQualityRaw !== undefined ? Number(airQualityRaw) : null,
            deviceCode: dev.device_code || dev.id,
            status: dev.status === 'active' || dev.status === 'online' ? 'online' : 'offline',
            lastSync: latest?.recorded_at || dev.created_at,
            readingsHistory: history
          }
        })
      )

      return { data: sensors, error: null }
    },

    async getAlerts() {
      if (USE_MOCKS) {
        const { getCurrentAlerts } = await import('../services/sensorSimulator')
        return { data: getCurrentAlerts(), error: null }
      }

      const res = await request('/notifications?limit=20')
      if (res.error) {
        return { data: null, error: res.error, status: res.status }
      }

      const rawAlerts = res.data?.notifications || res.data || []
      const mapped = (Array.isArray(rawAlerts) ? rawAlerts : []).map((a) => ({
        id: a.id,
        severity: a.severity || 'warning',
        type: a.type || 'threshold_alert',
        sensorNodeId: a.device_id,
        zone: 'fridge',
        title: a.title,
        message: a.message,
        recommendation: a.severity === 'critical'
          ? 'Immediate check recommended. Verify door closure and cooling system.'
          : 'Monitor climate conditions closely.',
        timestamp: a.created_at,
        isRead: Boolean(a.is_read),
      }))

      return { data: mapped, error: null }
    },

    async markAlertRead(alertId) {
      if (USE_MOCKS) {
        const alerts = getStoredOrInitial(STORAGE_KEYS.ALERTS, initialStorageAlerts)
        const updated = alerts.map((a) =>
          a.id === alertId ? { ...a, isRead: true } : a
        )
        setStored(STORAGE_KEYS.ALERTS, updated)
        return { data: { success: true }, error: null }
      }
      return request(`/notifications/${alertId}/read`, { method: 'PATCH' })
    },

    async markAllAlertsRead() {
      if (USE_MOCKS) {
        const alerts = getStoredOrInitial(STORAGE_KEYS.ALERTS, initialStorageAlerts)
        const updated = alerts.map((a) => ({ ...a, isRead: true }))
        setStored(STORAGE_KEYS.ALERTS, updated)
        return { data: { success: true }, error: null }
      }
      return request('/notifications/read-all', { method: 'PATCH' })
    },

    async startSimulation() {
      if (USE_MOCKS) {
        const sim = await import('../services/sensorSimulator')
        sim.startSimulation()
        return { data: { success: true }, error: null }
      }
      return { data: null, error: 'Hardware simulation is only available in mock mode.' }
    },

    async stopSimulation() {
      if (USE_MOCKS) {
        const sim = await import('../services/sensorSimulator')
        sim.stopSimulation()
        return { data: { success: true }, error: null }
      }
      return { data: null, error: 'Hardware simulation is only available in mock mode.' }
    },

    async getSimulationStatus() {
      if (USE_MOCKS) {
        try {
          const sim = await import('../services/sensorSimulator')
          const fn = sim.getSimulationStatus || sim.getSimulationInfo
          return { data: fn ? fn() : { isRunning: false, lastUpdated: null }, error: null }
        } catch (e) {
          return { data: { isRunning: false, lastUpdated: null }, error: null }
        }
      }
      return { data: { isRunning: false, activeScenario: 'Live Backend IoT Telemetry' }, error: null }
    },
  },

  // ==================== RECIPES ====================
  recipes: {
    async getWasteLessSuggestions() {
      if (USE_MOCKS) {
        await delay()
        return { data: initialRecipes, error: null }
      }

      const res = await request('/recipes/rescue')
      if (res.error) {
        // Return clear error state without substituting mock data
        return {
          data: null,
          error: res.error || 'AI recipe rescue service is currently unreachable.',
          status: res.status,
        }
      }

      const recipes = res.data?.recipes || res.data || []
      const mapped = recipes.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description || '',
        prepTimeMinutes: r.prep_time_minutes || 20,
        difficulty: 'Easy',
        servings: r.servings || 2,
        tags: ['Quick Rescue', 'Pantry Staple'],
        pantryRescueValue: 120.0,
        matchedIngredientsCount: (r.rescued_items || []).length || (r.ingredients || []).length,
        totalIngredientsCount: (r.ingredients || []).length || 4,
        expiringIngredientsUsed: (r.rescued_items || []).map((it) => ({
          name: it.name || it,
          status: it.freshness_bucket || 'use_soon',
          daysRemaining: it.adj_days_left || 2,
        })),
        missingIngredients: [],
        instructions: Array.isArray(r.instructions)
          ? r.instructions
          : typeof r.instructions === 'string'
          ? r.instructions.split('\n').filter(Boolean)
          : ['Mix ingredients together and cook thoroughly.'],
      }))

      return { data: mapped, error: null }
    },

    async useIngredients(items, recipeName = 'Rescue Recipe') {
      return request('/inventory/use-ingredients', {
        method: 'POST',
        body: JSON.stringify({
          items,
          source: 'recipe_rescue',
          recipe_name: recipeName,
        }),
      })
    },
  },

  // ==================== SHOPPING LIST ====================
  shoppingList: {
    async getAll(query = {}) {
      if (USE_MOCKS) {
        await delay()
        const list = getStoredOrInitial(STORAGE_KEYS.SHOPPING, initialShoppingList)
        return { data: list, error: null }
      }

      const params = new URLSearchParams()
      if (query.status) params.append('status', query.status)
      if (query.is_purchased !== undefined) params.append('is_purchased', query.is_purchased)
      const queryString = params.toString() ? `?${params.toString()}` : ''

      const res = await request(`/shopping-list${queryString}`)
      if (res.error) {
        return { data: null, error: res.error, status: res.status }
      }

      const rawItems = res.data?.items || res.data || []
      const mapped = (Array.isArray(rawItems) ? rawItems : []).map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category || 'other',
        quantity: Number(item.quantity) || 1,
        unit: item.unit || 'piece',
        estimatedPrice: item.estimated_price !== null && item.estimated_price !== undefined ? Number(item.estimated_price) : 3.5,
        status: item.status || (item.is_purchased ? 'purchased' : 'needed'),
        isCompleted: Boolean(item.is_purchased || item.status === 'purchased'),
        isAutoSuggested: Boolean(item.source_type === 'recommendation' || item.recommendation_reason),
        notes: item.notes || '',
        recommendationReason: item.recommendation_reason || null,
        pantryStock: item.pantry_stock || null,
        purchasedAt: item.purchased_at,
        purchasedQuantity: item.purchased_quantity,
        purchasePrice: item.purchase_price,
        createdAt: item.created_at,
      }))

      return { data: mapped, error: null }
    },

    async getRecommendations(options = {}) {
      if (USE_MOCKS) {
        return { data: { recommendations: [], summary: {} }, error: null }
      }

      const params = new URLSearchParams()
      if (options.replenishment_days) params.append('replenishment_days', options.replenishment_days)
      const queryString = params.toString() ? `?${params.toString()}` : ''

      const res = await request(`/shopping-list/recommendations${queryString}`)
      if (res.error) {
        return { data: null, error: res.error, status: res.status }
      }
      return { data: res.data, error: null }
    },

    async evaluateDuplicate(data) {
      if (USE_MOCKS) {
        return { data: { warnings: [], pantryMatch: null }, error: null }
      }

      return request('/shopping-list/evaluate-duplicate', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name.trim(),
          quantity: Number(data.quantity) || 1,
          unit: mapUnitToBackend(data.unit || 'piece'),
        }),
      })
    },

    async addItem(item) {
      if (USE_MOCKS) {
        const list = getStoredOrInitial(STORAGE_KEYS.SHOPPING, initialShoppingList)
        const newItem = {
          id: 'shop_' + Date.now().toString(36),
          isCompleted: false,
          isAutoSuggested: false,
          status: 'needed',
          ...item,
        }
        const updated = [newItem, ...list]
        setStored(STORAGE_KEYS.SHOPPING, updated)
        return { data: newItem, error: null }
      }

      const res = await request('/shopping-list', {
        method: 'POST',
        body: JSON.stringify({
          name: item.name.trim(),
          category: mapCategoryToBackend(item.category),
          quantity: Number(item.quantity) || 1,
          unit: mapUnitToBackend(item.unit),
          notes: item.notes || null,
          status: item.status || 'needed',
          estimated_price: item.estimatedPrice !== undefined ? Number(item.estimatedPrice) : 3.5,
          recommendation_reason: item.recommendationReason || null,
          source_type: item.sourceType || 'manual',
        }),
      })

      if (res.error) {
        return { data: null, error: res.error, status: res.status }
      }

      const created = res.data?.item || res.data
      return {
        data: {
          id: created.id,
          name: created.name,
          category: created.category,
          quantity: Number(created.quantity) || 1,
          unit: created.unit,
          estimatedPrice: created.estimated_price !== null && created.estimated_price !== undefined ? Number(created.estimated_price) : 3.5,
          status: created.status || (created.is_purchased ? 'purchased' : 'needed'),
          isCompleted: Boolean(created.is_purchased),
          isAutoSuggested: Boolean(created.source_type === 'recommendation' || created.recommendation_reason),
          notes: created.notes || '',
          recommendationReason: created.recommendation_reason || null,
          pantryStock: created.pantry_match ? {
            available_quantity: created.pantry_match.existing_quantity,
            unit: created.pantry_match.unit,
            has_stock: created.pantry_match.existing_quantity > 0,
            closest_expiry: created.pantry_match.expiry_date,
            is_potential_duplicate: created.pantry_match.is_sufficient,
          } : null,
          warnings: res.data?.warnings || [],
        },
        error: null,
      }
    },

    async updateItem(id, updates) {
      if (USE_MOCKS) {
        const list = getStoredOrInitial(STORAGE_KEYS.SHOPPING, initialShoppingList)
        const updated = list.map((item) => (item.id === id ? { ...item, ...updates } : item))
        setStored(STORAGE_KEYS.SHOPPING, updated)
        return { data: updated.find((i) => i.id === id), error: null }
      }

      const payload = {}
      if (updates.name !== undefined) payload.name = updates.name.trim()
      if (updates.quantity !== undefined) payload.quantity = Number(updates.quantity)
      if (updates.unit !== undefined) payload.unit = mapUnitToBackend(updates.unit)
      if (updates.category !== undefined) payload.category = mapCategoryToBackend(updates.category)
      if (updates.notes !== undefined) payload.notes = updates.notes
      if (updates.status !== undefined) payload.status = updates.status
      if (updates.estimatedPrice !== undefined) payload.estimated_price = Number(updates.estimatedPrice)
      if (updates.isCompleted !== undefined) payload.is_purchased = Boolean(updates.isCompleted)

      const res = await request(`/shopping-list/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })

      if (res.error) {
        return { data: null, error: res.error, status: res.status }
      }

      return { data: res.data?.item || res.data, error: null }
    },

    async markPurchased(id, purchaseData = {}) {
      if (USE_MOCKS) {
        return this.toggleItem(id)
      }

      const res = await request(`/shopping-list/${id}/purchase`, {
        method: 'POST',
        body: JSON.stringify({
          purchased_quantity: purchaseData.purchasedQuantity ? Number(purchaseData.purchasedQuantity) : undefined,
          purchase_price: purchaseData.purchasePrice ? Number(purchaseData.purchasePrice) : undefined,
          purchase_date: purchaseData.purchaseDate || undefined,
          expiry_date: purchaseData.expiryDate || undefined,
          storage_location: purchaseData.storageLocation || 'pantry',
        }),
      })

      if (res.error) {
        return { data: null, error: res.error, status: res.status }
      }

      return { data: res.data, error: null }
    },

    async toggleItem(id) {
      if (USE_MOCKS) {
        const list = getStoredOrInitial(STORAGE_KEYS.SHOPPING, initialShoppingList)
        const updated = list.map((item) =>
          item.id === id ? { ...item, isCompleted: !item.isCompleted } : item
        )
        setStored(STORAGE_KEYS.SHOPPING, updated)
        return { data: updated, error: null }
      }

      const { data: currentItems } = await this.getAll()
      const found = (currentItems || []).find((i) => i.id === id)

      if (found && !found.isCompleted) {
        return this.markPurchased(id)
      } else {
        return this.updateItem(id, { status: 'needed', isCompleted: false })
      }
    },

    async removeItem(id) {
      if (USE_MOCKS) {
        const list = getStoredOrInitial(STORAGE_KEYS.SHOPPING, initialShoppingList)
        const updated = list.filter((item) => item.id !== id)
        setStored(STORAGE_KEYS.SHOPPING, updated)
        return { data: { id, success: true }, error: null }
      }

      return request(`/shopping-list/${id}`, { method: 'DELETE' })
    },
  },

  // ==================== ANALYTICS ====================
  analytics: {
    async getWasteReport() {
      if (USE_MOCKS) {
        await delay()
        return { data: initialWasteAnalytics, error: null }
      }

      const [wasteRes, savingsRes, mostWastedRes] = await Promise.all([
        request('/analytics/waste?period=month'),
        request('/analytics/savings'),
        request('/analytics/most-wasted'),
      ])

      if (wasteRes.error) {
        return { data: null, error: wasteRes.error, status: wasteRes.status }
      }

      const wData = wasteRes.data || {}
      const sData = savingsRes.data || {}
      const rawMostWasted = mostWastedRes.data?.most_wasted_items || (Array.isArray(mostWastedRes.data) ? mostWastedRes.data : [])

      const totalWastedVal = Number(wData.total_estimated_value || 0)
      const totalSavedVal = Number(sData.total_estimated_savings ?? sData.total_savings ?? 0)
      const totalSpentVal = Number((totalWastedVal + totalSavedVal).toFixed(2))

      const wasteReductionRate = (totalSavedVal + totalWastedVal > 0)
        ? Math.round((totalSavedVal / (totalSavedVal + totalWastedVal)) * 100)
        : 100

      const topCategories = rawMostWasted.slice(0, 5).map((item) => {
        const loss = Number(item.total_estimated_value || 0)
        const pct = totalWastedVal > 0 ? Math.round((loss / totalWastedVal) * 100) : 0
        return {
          category: item.item_name || item.category || 'Pantry Item',
          loss,
          count: Number(item.occurrences || item.waste_count || 1),
          percentage: pct,
        }
      })

      // Aggregate real weekly trends from database records
      const weeks = [
        { week: 'Week 1', saved: 0, wasted: 0, consumedRate: 90 },
        { week: 'Week 2', saved: 0, wasted: 0, consumedRate: 90 },
        { week: 'Week 3', saved: 0, wasted: 0, consumedRate: 90 },
        { week: 'Week 4', saved: 0, wasted: 0, consumedRate: 90 },
      ]

      const wasteRecords = Array.isArray(wData.records) ? wData.records : []
      for (const r of wasteRecords) {
        const dateStr = r.wasted_at || r.created_at
        if (dateStr) {
          const day = new Date(dateStr).getDate()
          const weekIdx = Math.min(3, Math.floor((day - 1) / 7))
          weeks[weekIdx].wasted = Number((weeks[weekIdx].wasted + (Number(r.estimated_value) || 0)).toFixed(2))
        }
      }

      const savingsRecords = Array.isArray(sData.records) ? sData.records : []
      for (const r of savingsRecords) {
        const dateStr = r.consumed_at || r.created_at
        if (dateStr) {
          const day = new Date(dateStr).getDate()
          const weekIdx = Math.min(3, Math.floor((day - 1) / 7))
          weeks[weekIdx].saved = Number((weeks[weekIdx].saved + (Number(r.estimated_savings) || 0)).toFixed(2))
        }
      }

      const mapped = {
        monthlySummary: {
          month: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
          totalSpent: totalSpentVal,
          totalSaved: totalSavedVal,
          totalWasted: totalWastedVal,
          wasteReductionPercentage: wasteReductionRate,
          carbonSavedKg: Number((totalSavedVal * 0.18).toFixed(1)),
        },
        weeklyTrends: weeks,
        topWastedCategories: topCategories,
        preventionTips: [
          'Wrap leafy greens in paper towels to absorb excess moisture and extend shelf life.',
          'Freeze bread slices to prevent premature spoilage.',
          'Store dairy items on middle refrigerator shelves rather than the door.',
        ],
      }

      return { data: mapped, error: null }
    },
  },

  // ==================== AI ASSISTANT ====================
  assistant: {
    async getConversations() {
      if (USE_MOCKS) {
        await delay()
        const convos = getStoredOrInitial(STORAGE_KEYS.CONVERSATIONS, [])
        return { data: convos, error: null }
      }
      return { data: [], error: null }
    },

    async sendMessage(prompt) {
      if (USE_MOCKS) {
        await delay(500)
        let reply = "I analyzed your current pantry items. You have items that need attention soon! Let's make sure nothing goes to waste."
        const lower = prompt.toLowerCase()
        if (lower.includes('milk') || lower.includes('spinach') || lower.includes('strawberry')) {
          reply = 'Based on your inventory, your Whole Milk and Organic Strawberries are in the high-risk window. Consider whisking together a smoothie or custard.'
        } else if (lower.includes('recipe') || lower.includes('cook') || lower.includes('dinner')) {
          reply = 'I recommend cooking the **Leftover Vegetable Curry** tonight. It has a high Use-First urgency score (95)!'
        } else if (lower.includes('storage') || lower.includes('fridge') || lower.includes('temperature')) {
          reply = 'Your Main Refrigerator Hub telemetry is holding steady at ~3.8°C with 67% humidity, which is optimal for dairy and produce.'
        }

        const newMsg = {
          id: 'msg_' + Date.now().toString(36),
          sender: 'assistant',
          text: reply,
          timestamp: new Date().toISOString(),
        }
        return { data: newMsg, error: null }
      }

      const res = await request('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: prompt,
          include_inventory: true,
        }),
      })

      if (res.error) {
        return {
          data: {
            id: 'err_' + Date.now(),
            sender: 'assistant',
            text: `AI Assistant is currently unavailable: ${res.error}. Enable Demo Mode to interact with simulated AI assistance.`,
            timestamp: new Date().toISOString(),
          },
          error: null,
        }
      }

      const text = res.data?.reply || res.data?.message || 'I have analyzed your household inventory.'
      return {
        data: {
          id: 'msg_' + Date.now().toString(36),
          sender: 'assistant',
          text,
          timestamp: new Date().toISOString(),
        },
        error: null,
      }
    },
  },

  // ==================== USER & PREFERENCES ====================
  user: {
    async getPreferences() {
      if (USE_MOCKS) {
        await delay()
        const prefs = getStoredOrInitial(STORAGE_KEYS.PREFERENCES, initialUserPreferences)
        return { data: prefs, error: null }
      }

      const res = await request('/profile')
      if (res.error) {
        return { data: null, error: res.error, status: res.status }
      }

      const user = res.data?.user || res.data || {}
      const prefs = {
        name: user.name || 'Demo Chef',
        email: user.email || 'demo@savebite.com',
        role: user.role || 'user',
        preferences: {
          pushAlerts: {
            expiry24h: true,
            tempFluctuation: true,
            weeklyReport: true,
            ...(user.preferences?.pushAlerts || {}),
          },
          dietary: user.preferences?.dietary || [],
          cuisines: user.preferences?.cuisines || [],
        },
      }
      return { data: prefs, error: null }
    },

    async updatePreferences(updatedPrefs) {
      if (USE_MOCKS) {
        await delay(150)
        const current = getStoredOrInitial(STORAGE_KEYS.PREFERENCES, initialUserPreferences)
        const merged = { ...current, ...updatedPrefs }
        setStored(STORAGE_KEYS.PREFERENCES, merged)
        return { data: merged, error: null }
      }

      return request('/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          preferences: updatedPrefs.preferences || updatedPrefs,
        }),
      })
    },
  },

  // ==================== BARCODE LOOKUP ====================
  barcodes: {
    async lookup(barcode) {
      return request(`/barcodes/${encodeURIComponent(barcode)}`)
    },
  },

  // ==================== RECEIPT OCR & INGESTION ====================
  receipts: {
    async upload(file) {
      const formData = new FormData()
      formData.append('receipt', file)
      return request('/receipts/upload', {
        method: 'POST',
        body: formData,
      })
    },

    async parse(receiptId) {
      return request(`/receipts/${receiptId}/parse`, {
        method: 'POST',
      })
    },

    async getItems(receiptId) {
      return request(`/receipts/${receiptId}/items`)
    },

    async confirmItem(receiptId, lineId, confirmationData) {
      return request(`/receipts/${receiptId}/items/${lineId}/confirm`, {
        method: 'POST',
        body: JSON.stringify(confirmationData),
      })
    },
  },
}

export { authService, inventoryService }
export default api
