import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { useAuth } from './AuthContext'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchAlerts = useCallback(async () => {
    // Prevent unauthenticated calls during login/logout or initial bootstrap
    if (!isAuthenticated) {
      setNotifications([])
      setLoading(false)
      return
    }

    try {
      const { data } = await api.storage.getAlerts()
      if (data) setNotifications(data)
    } catch (err) {
      console.error('[NotificationContext] Failed to load alerts:', err)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!authLoading) {
      fetchAlerts()
    }
  }, [fetchAlerts, authLoading, isAuthenticated])

  const markAsRead = async (id) => {
    try {
      await api.storage.markAlertRead(id)
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      )
    } catch (err) {
      console.error('[NotificationContext] Failed to mark alert read:', err)
    }
  }

  const markAllAsRead = async () => {
    try {
      await api.storage.markAllAlertsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
    } catch (err) {
      console.error('[NotificationContext] Failed to mark all alerts read:', err)
    }
  }

  const unreadCount = notifications.filter((n) => !n.isRead).length

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
        refresh: fetchAlerts,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return context
}
