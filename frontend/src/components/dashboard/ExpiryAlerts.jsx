import React from 'react'
import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../common/Card'
import Badge from '../common/Badge'
import Button from '../common/Button'
import { AlertCircle, ChefHat, ArrowRight, Check } from 'lucide-react'
import { getFreshnessStyle } from '../../utils/freshness'
import { formatShortDate } from '../../utils/formatters'

export function ExpiryAlerts({ items, onConsume }) {
  const urgentItems = (items || []).filter(
    (item) => item.status === 'critical' || item.status === 'use_soon'
  )

  return (
    <Card>
      <CardHeader
        title="Immediate Attention Required"
        subtitle={`${urgentItems.length} items will spoil if not used soon`}
        action={
          <Link
            to="/recipes"
            className="text-xs font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1"
          >
            <ChefHat className="w-3.5 h-3.5" />
            <span>Rescue Recipes</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        }
      />

      {urgentItems.length === 0 ? (
        <div className="py-8 text-center bg-emerald-50/50 rounded-xl border border-emerald-100">
          <p className="text-sm font-bold text-emerald-800">Everything looks fresh!</p>
          <p className="text-xs text-emerald-600 mt-1">No groceries expiring in the next 48 hours.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {urgentItems.slice(0, 4).map((item) => {
            const style = getFreshnessStyle(item.status)
            return (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/70 hover:bg-white hover:border-slate-300 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl shrink-0" role="img" aria-label={item.name}>
                    {item.imageEmoji || '🥦'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{item.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-slate-500">
                        {item.quantity} {item.unit} &bull; {item.location}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Exp: {formatShortDate(item.expiryDate)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant={item.status === 'critical' ? 'critical' : 'warning'}
                    dot
                    size="sm"
                  >
                    {item.daysRemaining <= 0
                      ? 'Today'
                      : `${item.daysRemaining}d left`}
                  </Badge>

                  {onConsume && (
                    <button
                      type="button"
                      onClick={() => onConsume(item.id)}
                      title="Mark as consumed"
                      className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
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

export default ExpiryAlerts
