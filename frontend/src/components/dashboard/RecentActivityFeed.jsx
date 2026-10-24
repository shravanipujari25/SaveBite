import React from 'react'
import Card, { CardHeader } from '../common/Card'
import { CheckCircle2, Trash2, PackageOpen, PlusCircle, Clock } from 'lucide-react'
import { formatRelativeTime, formatCurrency } from '../../utils/formatters'

export function RecentActivityFeed({ activities = [] }) {
  const getIcon = (type) => {
    switch (type) {
      case 'consumed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600" />
      case 'wasted':
        return <Trash2 className="w-4 h-4 text-rose-600" />
      case 'opened':
        return <PackageOpen className="w-4 h-4 text-amber-600" />
      case 'added':
      default:
        return <PlusCircle className="w-4 h-4 text-teal-600" />
    }
  }

  const getBadgeStyle = (type) => {
    switch (type) {
      case 'consumed':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200'
      case 'wasted':
        return 'bg-rose-50 text-rose-800 border-rose-200'
      case 'opened':
        return 'bg-amber-50 text-amber-800 border-amber-200'
      case 'added':
      default:
        return 'bg-teal-50 text-teal-800 border-teal-200'
    }
  }

  return (
    <Card>
      <CardHeader
        title="Recent Pantry Activity"
        subtitle="Log of food consumed, opened, or wasted"
      />

      {activities.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">
          No recent pantry activity recorded.
        </div>
      ) : (
        <div className="space-y-2.5">
          {activities.map((act) => (
            <div
              key={act.id}
              className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/60 flex items-center justify-between gap-2.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-white border border-slate-200 shrink-0">
                  {getIcon(act.type)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {act.itemName}
                    </span>
                    <span
                      className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full border ${getBadgeStyle(
                        act.type
                      )}`}
                    >
                      {act.type}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate">
                    {act.quantity} {act.unit} {act.notes ? `• ${act.notes}` : ''}
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0">
                {act.valueSaved !== undefined && (
                  <span className="text-xs font-bold text-emerald-700 block">
                    +{formatCurrency(act.valueSaved)}
                  </span>
                )}
                {act.valueLost !== undefined && (
                  <span className="text-xs font-bold text-rose-600 block">
                    -{formatCurrency(act.valueLost)}
                  </span>
                )}
                <span className="text-[10px] text-slate-400 flex items-center gap-1 justify-end">
                  <Clock className="w-3 h-3" />
                  {formatRelativeTime(act.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default RecentActivityFeed
