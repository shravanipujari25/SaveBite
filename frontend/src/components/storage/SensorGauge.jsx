import React from 'react'
import { Card } from '../common/Card'
import Badge from '../common/Badge'
import { Thermometer, Droplets, Wind, Battery, Wifi, DoorOpen, DoorClosed } from 'lucide-react'
import { formatRelativeTime } from '../../utils/formatters'

export function SensorGauge({ sensor }) {
  const isOptimalTemp =
    sensor.temperature >= sensor.targetTempRange.min &&
    sensor.temperature <= sensor.targetTempRange.max

  return (
    <Card className="flex flex-col justify-between">
      <div>
        {/* Node Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h4 className="font-bold text-slate-900 text-sm">{sensor.name}</h4>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{sensor.locationName}</p>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
              <Battery className="w-3.5 h-3.5 text-slate-400" />
              {sensor.batteryLevel}%
            </span>
            <Badge variant="fresh" size="sm">
              Online
            </Badge>
          </div>
        </div>

        {/* Telemetry Metric Tiles */}
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          {/* Temperature */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60">
            <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
              <span className="flex items-center gap-1">
                <Thermometer className="w-3.5 h-3.5 text-emerald-600" />
                Temp
              </span>
              <span className="text-[10px] text-slate-400">
                {sensor.targetTempRange.min}° to {sensor.targetTempRange.max}°
              </span>
            </div>
            <div className="text-xl font-black text-slate-900">
              {sensor.temperature > 0 ? `+${sensor.temperature}` : sensor.temperature}
              <span className="text-xs font-semibold text-slate-500 ml-0.5">
                {sensor.unitTemp}
              </span>
            </div>
            <span
              className={`text-[10px] font-bold ${
                isOptimalTemp ? 'text-emerald-700' : 'text-amber-600'
              }`}
            >
              {isOptimalTemp ? 'Target range met' : 'Slight temperature variance'}
            </span>
          </div>

          {/* Humidity */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60">
            <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
              <span className="flex items-center gap-1">
                <Droplets className="w-3.5 h-3.5 text-sky-600" />
                Humidity
              </span>
              <span className="text-[10px] text-slate-400">
                {sensor.targetHumidityRange.min}-{sensor.targetHumidityRange.max}%
              </span>
            </div>
            <div className="text-xl font-black text-slate-900">
              {sensor.humidity}
              <span className="text-xs font-semibold text-slate-500 ml-0.5">
                {sensor.unitHumidity}
              </span>
            </div>
            <span className="text-[10px] font-bold text-sky-700">Good moisture</span>
          </div>
        </div>

        {/* Ethylene Gas & Door Status */}
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between p-2 rounded-lg bg-cream-50 border border-[#edebe4]">
            <span className="flex items-center gap-2 text-slate-600">
              <Wind className="w-3.5 h-3.5 text-amber-500" />
              <span>Ethylene Gas Sensor:</span>
            </span>
            <span className="font-bold text-slate-900">
              {sensor.ethyleneGasPpm} ppm ({sensor.ethyleneStatus})
            </span>
          </div>

          <div className="flex items-center justify-between p-2 rounded-lg bg-cream-50 border border-[#edebe4]">
            <span className="flex items-center gap-2 text-slate-600">
              {sensor.doorOpen ? (
                <DoorOpen className="w-3.5 h-3.5 text-rose-500" />
              ) : (
                <DoorClosed className="w-3.5 h-3.5 text-emerald-600" />
              )}
              <span>Door Status:</span>
            </span>
            <span
              className={`font-bold ${
                sensor.doorOpen ? 'text-rose-600 animate-pulse' : 'text-slate-900'
              }`}
            >
              {sensor.doorOpen ? 'Open Alert!' : 'Securely Closed'}
            </span>
          </div>
        </div>
      </div>

      {/* Sync Footer */}
      <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <Wifi className="w-3 h-3 text-emerald-500" />
          <span>MQTT: telemetry/nodes/{sensor.nodeId}</span>
        </span>
        <span>Synced {formatRelativeTime(sensor.lastSync)}</span>
      </div>
    </Card>
  )
}

export default SensorGauge
