import React from 'react'
import { Card } from '../common/Card'
import Badge from '../common/Badge'
import { Refrigerator, Archive, Snowflake, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export function StorageCard({ zone, itemCount, sensor }) {
  const getZoneIcon = (id) => {
    switch (id) {
      case 'fridge':
        return <Refrigerator className="w-5 h-5 text-emerald-700" />
      case 'freezer':
        return <Snowflake className="w-5 h-5 text-sky-600" />
      case 'pantry':
      default:
        return <Archive className="w-5 h-5 text-amber-700" />
    }
  }

  return (
    <Card hoverEffect className="flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
              {getZoneIcon(zone.id)}
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-sm">{zone.name}</h4>
              <p className="text-xs text-slate-500">{itemCount} items stored</p>
            </div>
          </div>
          <Badge variant={zone.health === 'Optimal' ? 'fresh' : 'neutral'} size="sm">
            {zone.health}
          </Badge>
        </div>

        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 mb-2">
          <div className="flex justify-between text-xs text-slate-600 mb-1">
            <span>Current Temp:</span>
            <span className="font-bold text-slate-900">
              {sensor ? `${sensor.temperature}${sensor.unitTemp}` : `${zone.temp}°C`}
            </span>
          </div>
          {sensor && (
            <div className="flex justify-between text-xs text-slate-600">
              <span>Humidity:</span>
              <span className="font-bold text-slate-900">
                {sensor.humidity}{sensor.unitHumidity}
              </span>
            </div>
          )}
        </div>
      </div>

      <Link
        to={`/pantry?location=${zone.id}`}
        className="flex items-center justify-between pt-2 text-xs font-bold text-emerald-800 hover:text-emerald-950"
      >
        <span>View {zone.name} Inventory</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </Card>
  )
}

export default StorageCard
