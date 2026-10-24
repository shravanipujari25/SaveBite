import React from 'react'
import { Link } from 'react-router-dom'
import Card, { CardHeader } from '../common/Card'
import Badge from '../common/Badge'
import { AlertCircle, ChefHat, Check, ArrowRight, PackageOpen } from 'lucide-react'
import { formatDate } from '../../utils/formatters'

export function UseFirstSection({ items = [], onConsume, onOpenDetails }) {
  return (
    <Card>
      <CardHeader
        title="Use First — Priority Queue"
        subtitle="Groceries with high spoilage risk, imminent expiry, or open seals"
        action={
          <Link
            to="/recipes"
            className="text-xs font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1"
          >
            <ChefHat className="w-3.5 h-3.5" />
            <span>Recipe Matches</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        }
      />

      {items.length === 0 ? (
        <div className="py-8 text-center bg-emerald-50/50 rounded-xl border border-emerald-100">
          <p className="text-sm font-bold text-emerald-800">No urgent items!</p>
          <p className="text-xs text-emerald-600 mt-1">
            All pantry inventory has safe shelf life remaining.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const badgeVariant =
              item.status === 'critical'
                ? 'critical'
                : item.status === 'use_soon'
                ? 'warning'
                : 'fresh'

            return (
              <div
                key={item.id}
                onClick={() => onOpenDetails?.(item)}
                className="p-3.5 rounded-2xl bg-slate-50/90 border border-slate-200/70 hover:bg-white hover:border-emerald-300 hover:shadow-xs transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                {/* Left info */}
                <div className="flex items-start gap-3 min-w-0">
                  <span className="text-2xl shrink-0 mt-0.5">
                    {item.imageEmoji || '🥦'}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-900 truncate">
                        {item.name}
                      </h4>
                      {item.isOpened && (
                        <span className="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0">
                          <PackageOpen className="w-3 h-3" /> Opened
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-slate-500">
                      <span className="font-semibold text-slate-700">
                        {item.quantity} {item.unit}
                      </span>
                      <span>&bull;</span>
                      <span className="capitalize">{item.location}</span>
                      <span>&bull;</span>
                      <span>Expires: {formatDate(item.expiryDate)}</span>
                    </div>

                    {/* Prioritization Reason */}
                    {item.priorityReason && (
                      <p className="text-[11px] text-amber-800 font-medium mt-1 bg-amber-50/80 px-2 py-0.5 rounded-md inline-block">
                        ⚠️ {item.priorityReason}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right actions & badge */}
                <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-slate-200/60">
                  <Badge variant={badgeVariant} dot size="sm">
                    {item.daysRemaining <= 0 ? 'Today' : `${item.daysRemaining}d left`}
                  </Badge>

                  {onConsume && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onConsume(item)
                      }}
                      className="px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                      title="Quick consume"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Consume</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

export default UseFirstSection
