import React from 'react'
import { Info } from 'lucide-react'

export function FreshnessLegend({ className = '' }) {
  const buckets = [
    { label: 'Critical (<= 1 day)', color: 'bg-rose-500', text: 'text-rose-700' },
    { label: 'Use Soon (2-4 days)', color: 'bg-amber-500', text: 'text-amber-700' },
    { label: 'Fresh (> 4 days)', color: 'bg-emerald-500', text: 'text-emerald-700' },
    { label: 'Opened Package', color: 'bg-yellow-400', text: 'text-yellow-700' },
    { label: 'Expired (< 0 days)', color: 'bg-slate-400', text: 'text-slate-600' },
  ]

  return (
    <div className={`p-3.5 bg-white rounded-2xl border border-[#edebe4] space-y-2 text-xs ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
          Freshness Legend
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {buckets.map((b) => (
            <div key={b.label} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${b.color}`} />
              <span className="text-[11px] font-medium text-slate-600">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-slate-400 leading-normal flex items-start gap-1 pt-1 border-t border-slate-100">
        <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
        <span>
          Freshness indicators are algorithmic estimates for inventory prioritization, not guarantees of laboratory food safety. Always verify smell, color, and texture before consuming.
        </span>
      </p>
    </div>
  )
}

export default FreshnessLegend
