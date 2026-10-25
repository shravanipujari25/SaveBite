import React from 'react'
import { Card } from '../common/Card'
import Badge from '../common/Badge'
import { Thermometer, Droplets, Wind, Wifi } from 'lucide-react'
import { formatRelativeTime } from '../../utils/formatters'

export function SensorGauge({ sensor }) {
  // Compute data freshness (under 30 seconds is live stream)
  const syncTime = sensor.lastSync ? new Date(sensor.lastSync).getTime() : 0
  const isLive = syncTime > 0 && Date.now() - syncTime < 30000

  const gasVal = sensor.gasValue !== null && sensor.gasValue !== undefined ? sensor.gasValue : null

  return (
    <Card className="flex flex-col justify-between hover:shadow-md transition-shadow">
      <div>
        {/* Node Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
              <h4 className="font-bold text-slate-900 text-sm">{sensor.name}</h4>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">ESP32 Hardware Node</p>
          </div>

          <div className="flex items-center gap-1.5">
            <Badge variant={isLive ? 'fresh' : 'neutral'} dot size="sm">
              {isLive ? 'Real-Time Stream' : 'Offline / Standby'}
            </Badge>
          </div>
        </div>

        {/* 3 Primary Sensor Metrics: Temperature, Humidity, Gas Value */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-2">
          {/* 1. Temperature */}
          <div className="p-3.5 rounded-xl bg-emerald-50/50 border border-emerald-100 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 text-emerald-800 text-xs font-semibold mb-2">
              <Thermometer className="w-4 h-4 text-emerald-600" />
              <span>Temperature</span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-900 tracking-tight">
                {sensor.temperature !== null && sensor.temperature !== undefined ? (
                  <>
                    {sensor.temperature > 0 ? `+${sensor.temperature}` : sensor.temperature}
                    <span className="text-sm font-bold text-slate-600 ml-1">°C</span>
                  </>
                ) : (
                  <span className="text-xs text-amber-600 font-semibold">Sensor Failed</span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5">DHT11 Sensor</p>
            </div>
          </div>

          {/* 2. Humidity */}
          <div className="p-3.5 rounded-xl bg-sky-50/50 border border-sky-100 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 text-sky-800 text-xs font-semibold mb-2">
              <Droplets className="w-4 h-4 text-sky-600" />
              <span>Humidity</span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-900 tracking-tight">
                {sensor.humidity !== null && sensor.humidity !== undefined ? (
                  <>
                    {sensor.humidity}
                    <span className="text-sm font-bold text-slate-600 ml-1">%</span>
                  </>
                ) : (
                  <span className="text-xs text-amber-600 font-semibold">Sensor Failed</span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5">DHT11 Sensor</p>
            </div>
          </div>

          {/* 3. Gas Value */}
          <div className="p-3.5 rounded-xl bg-amber-50/50 border border-amber-100 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 text-amber-800 text-xs font-semibold mb-2">
              <Wind className="w-4 h-4 text-amber-600" />
              <span>Gas Value</span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-900 tracking-tight">
                {gasVal !== null ? (
                  gasVal
                ) : (
                  <span className="text-xs text-amber-600 font-semibold">Reading...</span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5">MQ-135 (ADC Raw)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sync Footer */}
      <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
        <span className="flex items-center gap-1 font-mono">
          <Wifi className={`w-3 h-3 ${isLive ? 'text-emerald-500' : 'text-slate-400'}`} />
          <span>Device: {sensor.deviceCode || sensor.nodeId}</span>
        </span>
        <span className="font-mono">
          {sensor.lastSync ? `Updated ${formatRelativeTime(sensor.lastSync)}` : 'Pending sync'}
        </span>
      </div>
    </Card>
  )
}

export default SensorGauge
