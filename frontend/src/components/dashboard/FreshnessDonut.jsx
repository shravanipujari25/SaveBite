import React from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardHeader } from '../common/Card'

export function FreshnessDonut({ buckets, loading }) {
  if (loading || !buckets) {
    return (
      <Card className="h-80 flex items-center justify-center">
        <div className="w-40 h-40 rounded-full border-4 border-slate-200 border-t-emerald-600 animate-spin" />
      </Card>
    )
  }

  const data = (buckets.distribution || []).filter((d) => d.count > 0)

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader
        title="Freshness Health Index"
        subtitle="Distribution of current inventory"
      />

      <div className="h-52 w-full relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              innerRadius={55}
              outerRadius={75}
              paddingAngle={4}
              dataKey="count"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const item = payload[0].payload
                  return (
                    <div className="bg-slate-900 text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg">
                      <span className="font-semibold">{item.name}</span>: {item.count} items ({item.percentage}%)
                    </div>
                  )
                }
                return null
              }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-black text-slate-800 tracking-tight">
            {buckets.summary?.total || 0}
          </span>
          <span className="text-[10px] uppercase font-bold text-slate-600 tracking-wider">
            Total Items
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2 pt-4 border-t border-slate-100">
        {(buckets.distribution || []).map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-xs text-slate-600 truncate">{item.name}</span>
            <span className="text-xs font-bold text-slate-800 ml-auto">{item.count}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default FreshnessDonut
