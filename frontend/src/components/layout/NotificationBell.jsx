import React, { useState, useRef, useEffect } from 'react'
import { Bell, CheckCheck, AlertCircle, Info, Flame } from 'lucide-react'
import { useNotifications } from '../../context/NotificationContext'
import { formatRelativeTime } from '../../utils/formatters'

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const getAlertIcon = (type, severity) => {
    if (severity === 'critical') return <Flame className="w-4 h-4 text-rose-500" />
    if (severity === 'warning') return <AlertCircle className="w-4 h-4 text-amber-500" />
    return <Info className="w-4 h-4 text-sky-500" />
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
        aria-label="Notifications"
        aria-expanded={isOpen}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-xs">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-white shadow-xl border border-slate-200/80 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-sm">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-[11px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-semibold">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-xs text-emerald-700 hover:text-emerald-800 font-medium flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No notifications right now. Everything is running fresh!
              </div>
            ) : (
              notifications.map((alert) => (
                <div
                  key={alert.id}
                  onClick={() => markAsRead(alert.id)}
                  className={`p-3.5 flex gap-3 text-left transition-colors cursor-pointer hover:bg-slate-50 ${
                    !alert.isRead ? 'bg-emerald-50/30' : ''
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {getAlertIcon(alert.type, alert.severity)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <p
                        className={`text-xs font-semibold truncate ${
                          !alert.isRead ? 'text-slate-900 font-bold' : 'text-slate-700'
                        }`}
                      >
                        {alert.title}
                      </p>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {formatRelativeTime(alert.timestamp)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                      {alert.message}
                    </p>
                    {alert.recommendation && (
                      <p className="text-[10px] text-emerald-700 font-medium mt-1 bg-emerald-50 p-1.5 rounded-md">
                        💡 {alert.recommendation}
                      </p>
                    )}
                  </div>
                  {!alert.isRead && (
                    <span className="w-2 h-2 rounded-full bg-emerald-600 mt-1 shrink-0" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default NotificationBell
