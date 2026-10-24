import React from 'react'
import { Inbox } from 'lucide-react'
import Button from './Button'

export function EmptyState({
  icon: Icon = Inbox,
  title = 'No items found',
  description = 'There is nothing to display here yet.',
  actionLabel,
  onAction,
  className = '',
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center p-8 bg-white/70 rounded-2xl border border-dashed border-slate-200 ${className}`}
    >
      <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7" />
      </div>
      <h3 className="text-base font-bold text-slate-900 mb-1">{title}</h3>
      <p className="text-xs text-slate-500 max-w-sm mb-5 leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <Button variant="primary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}

export default EmptyState
