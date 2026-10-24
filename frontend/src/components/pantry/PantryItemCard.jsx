import React from 'react'
import Card from '../common/Card'
import Badge from '../common/Badge'
import { Trash2, MapPin, Calendar, PackageOpen, Check, Eye } from 'lucide-react'
import { getFreshnessStyle } from '../../utils/freshness'
import { formatDate, formatCurrency } from '../../utils/formatters'

export function PantryItemCard({ item, onSelect, onDelete, onConsume }) {
  const days = item.daysRemaining

  const badgeVariant =
    item.status === 'critical'
      ? 'critical'
      : item.status === 'use_soon'
      ? 'warning'
      : item.status === 'expired'
      ? 'neutral'
      : 'fresh'

  return (
    <Card
      hoverEffect
      padding="p-4"
      onClick={() => onSelect?.(item)}
      className="flex flex-col justify-between h-full group relative cursor-pointer"
    >
      <div>
        {/* Top Line */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-cream-100 flex items-center justify-center text-2xl shrink-0 group-hover:scale-105 transition-transform">
              {item.imageEmoji || '🥦'}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h4 className="text-sm font-bold text-slate-900 group-hover:text-emerald-800 transition-colors">
                  {item.name}
                </h4>
                {item.isOpened && (
                  <span
                    title={`Opened on ${item.openedDate || 'recently'}`}
                    className="p-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-bold uppercase tracking-wider"
                  >
                    Opened
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-medium">
                {item.quantity} {item.unit}
              </p>
            </div>
          </div>

          <Badge variant={badgeVariant} dot size="sm">
            {days <= 0 ? 'Today' : `${days}d left`}
          </Badge>
        </div>

        {/* Location & Metadata */}
        <div className="space-y-1.5 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-400">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              <span>Zone:</span>
            </span>
            <span className="font-semibold text-slate-700 capitalize">
              {item.location} {item.storageZone ? `• ${item.storageZone}` : ''}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-400">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Expires:</span>
            </span>
            <span className="font-semibold text-slate-700">
              {formatDate(item.expiryDate)}
            </span>
          </div>

          {item.estimatedCost !== undefined && (
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Estimated value:</span>
              <span className="font-bold text-emerald-800">
                {formatCurrency(item.estimatedCost)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
          {item.category}
        </span>

        <div className="flex items-center gap-1.5">
          {onConsume && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onConsume(item)
              }}
              className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
              title="Consume item"
              aria-label={`Consume ${item.name}`}
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelect?.(item)
            }}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            title="View details"
            aria-label={`View details for ${item.name}`}
          >
            <Eye className="w-3.5 h-3.5" />
          </button>

          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(item.id)
              }}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
              title="Remove item"
              aria-label={`Remove ${item.name}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

export default PantryItemCard
