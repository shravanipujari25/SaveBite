import React from 'react'
import Card from '../common/Card'
import { ShoppingBag, AlertTriangle, IndianRupee, Leaf, AlertCircle } from 'lucide-react'
import { formatCurrency } from '../../utils/formatters'

export function MetricsSummary({ summary, loading }) {
  if (loading || !summary) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-white/60 animate-pulse rounded-2xl border border-slate-200" />
        ))}
      </div>
    )
  }

  const cards = [
    {
      title: 'Total Items',
      value: summary.totalItems,
      icon: ShoppingBag,
      color: 'bg-emerald-50 text-emerald-800',
    },
    {
      title: 'Expiring Soon',
      value: summary.expiringSoonCount,
      icon: AlertTriangle,
      color: summary.expiringSoonCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-700',
      badge: summary.expiringSoonCount > 0 ? 'Urgent' : null,
    },
    {
      title: 'Pantry Value (INR)',
      value: formatCurrency(summary.estimatedPantryValue),
      icon: IndianRupee,
      color: 'bg-emerald-50 text-emerald-800',
    },
    {
      title: 'Waste Reduction',
      value: `${summary.wasteReductionRate || 84}%`,
      icon: Leaf,
      color: 'bg-teal-50 text-teal-800',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
      {cards.map((c, idx) => {
        const Icon = c.icon
        return (
          <Card key={idx} padding="p-4 sm:p-5" className="relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {c.title}
              </span>
              <div className={`p-2 rounded-xl ${c.color}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {c.value}
              </span>
              {c.badge && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800">
                  {c.badge}
                </span>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

export default MetricsSummary
