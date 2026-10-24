import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchAlerts = useCallback(async () => {
    try {
      const { data } = await api.storage.getAlerts()
      if (data) setNotifications(data)
    } catch (err) {
      console.error('[NotificationContext] Failed to load alerts:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const markAsRead = async (id) => {
    await api.storage.markAlertRead(id)
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    )
  }

  const markAllAsRead = async () => {
    for (const n of notifications) {
      if (!n.isRead) await api.storage.markAlertRead(n.id)
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
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
