import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { inventoryService } from '../api/inventoryService'
import { useAuth } from './AuthContext'

const PantryContext = createContext(null)

export function PantryProvider({ children }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [items, setItems] = useState([])
  const [activityLogs, setActivityLogs] = useState([])
  const [dashboardSummary, setDashboardSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reloadAll = useCallback(async () => {
    // Prevent unauthenticated calls during login/logout or initial bootstrap
    if (!isAuthenticated) {
      setItems([])
      setDashboardSummary(null)
      setActivityLogs([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const [itemsRes, summaryRes, logsRes] = await Promise.all([
        inventoryService.getItems(),
        inventoryService.getDashboardSummary(),
        inventoryService.getActivityLogs(),
      ])

      if (itemsRes.error) throw new Error(itemsRes.error)
      setItems(itemsRes.data || [])
      setDashboardSummary(summaryRes.data || null)
      setActivityLogs(logsRes.data || [])
    } catch (err) {
      console.error('[PantryContext] Error loading inventory:', err)
      setError(err.message || 'Failed to load pantry data')
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!authLoading) {
      reloadAll()
    }
  }, [reloadAll, authLoading, isAuthenticated])

  const addItem = async (itemData) => {
    const { data, error } = await inventoryService.addItem(itemData)
    if (error) throw new Error(error)
    await reloadAll()
    return data
  }

  const consumeItem = async (id, quantity, notes) => {
    const { data, error } = await inventoryService.consumeItem(id, quantity, notes)
    if (error) throw new Error(error)
    await reloadAll()
    return data
  }

  const wasteItem = async (id, quantity, reason, notes) => {
    const { data, error } = await inventoryService.wasteItem(id, quantity, reason, notes)
    if (error) throw new Error(error)
    await reloadAll()
    return data
  }

  const openItem = async (id) => {
    const { data, error } = await inventoryService.openItem(id)
    if (error) throw new Error(error)
    await reloadAll()
    return data
  }

  const deleteItem = async (id) => {
    const { error } = await inventoryService.deleteItem(id)
    if (error) throw new Error(error)
    await reloadAll()
  }

  return (
    <PantryContext.Provider
      value={{
        items,
        activityLogs,
        dashboardSummary,
        loading,
        error,
        refresh: reloadAll,
        addItem,
        consumeItem,
        wasteItem,
        openItem,
        deleteItem,
        // Phase 0 compatibility alias:
        removeItem: deleteItem,
      }}
    >
      {children}
    </PantryContext.Provider>
  )
}

export function usePantry() {
  const context = useContext(PantryContext)
  if (!context) {
    throw new Error('usePantry must be used within a PantryProvider')
  }
  return context
}

export default PantryContext
