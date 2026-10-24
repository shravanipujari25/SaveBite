/**
 * SaveBite Unified API Client
 * Supports seamless switching between local mock persistence and live backend endpoints.
 */



const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1'
// Enable mock mode based on environment variable VITE_USE_MOCKS (default false)
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

// Local storage keys for interactive mock persistence
const STORAGE_KEYS = {
  PANTRY: 'savebite_mock_pantry',
  SHOPPING: 'savebite_mock_shopping',
  ALERTS: 'savebite_mock_alerts',
  PREFERENCES: 'savebite_mock_preferences',
  AUTH: 'savebite_mock_auth_user',
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

/**
 * Standard HTTP response handler
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  const token = localStorage.getItem('savebite_auth_token')
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const response = await fetch(url, { ...options, headers })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return {
        data: null,
        error: data?.message || `Request failed with status ${response.status}`,
        status: response.status,
      }
    }
    return { data, error: null, status: response.status }
  } catch (err) {
    return {
      data: null,
      error: err.message || 'Network communication error',
      status: 0,
    }
  }
}

// Simulated mock network latency for realistic UX
const delay = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms))

import { authService } from './authService'
import { inventoryService } from './inventoryService'
import initialWasteAnalytics from '../mocks/wasteAnalytics.json'
import initialUserPreferences from '../mocks/userPreferences.json'
import initialPantryItems from '../mocks/pantryItems.json'
import initialShoppingList from '../mocks/shoppingList.json'
import initialRecipes from '../mocks/recipes.json'
import initialStorageAlerts from '../mocks/storageAlerts.json'
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
      return request('/dashboard/metrics')
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
      return request('/dashboard/freshness-buckets')
    },
  },

  // ==================== IOT STORAGE & SENSORS ====================
  storage: {
    async getSensors() {
      if (USE_MOCKS) {
        const { getCurrentSensors } = await import('../services/sensorSimulator')
        return { data: getCurrentSensors(), error: null }
      }
      return request('/storage/sensors')
    },

    async getAlerts() {
      if (USE_MOCKS) {
        const { getCurrentAlerts } = await import('../services/sensorSimulator')
        return { data: getCurrentAlerts(), error: null }
      }
      return request('/storage/alerts')
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
      return request(`/storage/alerts/${alertId}/read`, { method: 'POST' })
    },
    async startSimulation() {
      if (USE_MOCKS) {
        const { startSimulation } = await import('../services/sensorSimulator')
        startSimulation()
        return { data: { success: true }, error: null }
      }
      return { data: null, error: 'Simulation not supported' }
    },
    async stopSimulation() {
      if (USE_MOCKS) {
        const { stopSimulation } = await import('../services/sensorSimulator')
        stopSimulation()
        return { data: { success: true }, error: null }
      }
      return { data: null, error: 'Simulation not supported' }
    },
    async getSimulationStatus() {
      if (USE_MOCKS) {
        const { getSimulationInfo } = await import('../services/sensorSimulator')
        const info = getSimulationInfo()
        return { data: info, error: null }
      }
      return { data: null, error: 'Not applicable' }
    },
  },

  // ==================== RECIPES ====================
  recipes: {
    async getWasteLessSuggestions() {
      if (USE_MOCKS) {
        await delay()
        return { data: initialRecipes, error: null }
      }
      return request('/recipes/waste-less')
    },
  },

  // ==================== SHOPPING LIST ====================
  shoppingList: {
    async getAll() {
      if (USE_MOCKS) {
        await delay()
        const list = getStoredOrInitial(STORAGE_KEYS.SHOPPING, initialShoppingList)
        return { data: list, error: null }
      }
      return request('/shopping-list')
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
      return request(`/shopping-list/${id}/toggle`, { method: 'POST' })
    },

    async addItem(item) {
      if (USE_MOCKS) {
        const list = getStoredOrInitial(STORAGE_KEYS.SHOPPING, initialShoppingList)
        const newItem = {
          id: 'shop_' + Date.now().toString(36),
          isCompleted: false,
          isAutoSuggested: false,
          ...item,
        }
        const updated = [newItem, ...list]
        setStored(STORAGE_KEYS.SHOPPING, updated)
        return { data: newItem, error: null }
      }
      return request('/shopping-list', {
        method: 'POST',
        body: JSON.stringify(item),
      })
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
      return request('/analytics/waste')
    },
  },

  // ==================== AI ASSISTANT ====================
  assistant: {
    async getConversations() {
      if (USE_MOCKS) {
        await delay()
        const convos = getStoredOrInitial(
          STORAGE_KEYS.CONVERSATIONS,
          initialAssistantConversations
        )
        return { data: convos, error: null }
      }
      return request('/assistant/conversations')
    },

    async sendMessage(prompt) {
      if (USE_MOCKS) {
        await delay(500)
        // Intelligent mock response generator
        let reply = "I analyzed your current pantry items. You have items that need attention soon! Let's make sure nothing goes to waste."
        const lower = prompt.toLowerCase()
        if (lower.includes('milk') || lower.includes('spinach') || lower.includes('strawberry')) {
          reply = "Based on your inventory, your organic milk and baby spinach are in the high-risk window. Consider whisking together a vegetable skillet or making a fresh smoothie before tomorrow."
        } else if (lower.includes('recipe') || lower.includes('cook') || lower.includes('dinner')) {
          reply = "I recommend the **Avocado & Spinach Sourdough Melt**. It rescues 4 expiring pantry ingredients and takes only 15 minutes to prepare!"
        } else if (lower.includes('storage') || lower.includes('fridge') || lower.includes('temperature')) {
          reply = "Your Fridge Unit A is at 3.8°C with 68% humidity — which is within the optimal zone. However, your pantry puck detected elevated ethylene gas from ripe avocados."
        }
        
        const newMsg = {
          id: 'msg_' + Date.now().toString(36),
          sender: 'assistant',
          text: reply,
          timestamp: new Date().toISOString(),
        }
        return { data: newMsg, error: null }
      }
      return request('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      })
    },
  },

  // ==================== USER & PREFERENCES ====================
  user: {
    async getPreferences() {
      if (USE_MOCKS) {
        await delay()
        const prefs = getStoredOrInitial(
          STORAGE_KEYS.PREFERENCES,
          initialUserPreferences
        )
        return { data: prefs, error: null }
      }
      return request('/user/preferences')
    },

    async updatePreferences(updatedPrefs) {
      if (USE_MOCKS) {
        await delay(150)
        const current = getStoredOrInitial(
          STORAGE_KEYS.PREFERENCES,
          initialUserPreferences
        )
        const merged = { ...current, ...updatedPrefs }
        setStored(STORAGE_KEYS.PREFERENCES, merged)
        return { data: merged, error: null }
      }
      return request('/user/preferences', {
        method: 'PUT',
        body: JSON.stringify(updatedPrefs),
      })
    },
  },
}

export { authService, inventoryService }
export default api

