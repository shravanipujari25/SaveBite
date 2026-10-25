import React from 'react'
import { Card } from '../common/Card'
import Badge from '../common/Badge'
import { Thermometer, Droplets, Wind, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react'
import { formatRelativeTime } from '../../utils/formatters'
import { SENSOR_BOUNDARIES } from '../../services/sensorSimulator'

export function SensorGauge({ sensor }) {
  // Determine boundary status for each metric based on SENSOR_BOUNDARIES
  const temp = sensor.temperature
  const hum = sensor.humidity
  const gas = sensor.gasValue

  const tempStatus =
    temp === null || temp === undefined
      ? 'unknown'
      : temp < SENSOR_BOUNDARIES.temperature.warningMin || temp > SENSOR_BOUNDARIES.temperature.warningMax
      ? temp <= SENSOR_BOUNDARIES.temperature.min || temp >= SENSOR_BOUNDARIES.temperature.max
        ? 'critical'
        : 'warning'
      : 'safe'

  const humStatus =
    hum === null || hum === undefined
      ? 'unknown'
      : hum < SENSOR_BOUNDARIES.humidity.warningMin || hum > SENSOR_BOUNDARIES.humidity.warningMax
      ? hum <= SENSOR_BOUNDARIES.humidity.min || hum >= SENSOR_BOUNDARIES.humidity.max
        ? 'critical'
        : 'warning'
      : 'safe'

  const gasStatus =
    gas === null || gas === undefined
      ? 'unknown'
      : gas > SENSOR_BOUNDARIES.gasValue.warningMax
      ? 'critical'
      : gas > SENSOR_BOUNDARIES.gasValue.normalMax
      ? 'warning'
      : 'safe'

  const overallStatus =
    tempStatus === 'critical' || humStatus === 'critical' || gasStatus === 'critical'
      ? 'critical'
      : tempStatus === 'warning' || humStatus === 'warning' || gasStatus === 'warning'
      ? 'warning'
      : 'safe'

  return (
    <Card className="flex flex-col justify-between hover:shadow-md transition-shadow border-slate-200">
      <div>
        {/* Node Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  overallStatus === 'critical'
                    ? 'bg-rose-500 animate-pulse'
                    : overallStatus === 'warning'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-emerald-500 animate-pulse'
                }`}
              />
              <h4 className="font-bold text-slate-900 text-sm">{sensor.name}</h4>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{sensor.locationName || 'Smart Storage Node'}</p>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Badge variant="primary" size="sm">
              <Sparkles className="w-3 h-3 mr-1 inline" />
              SIMULATED DATA
            </Badge>
            <Badge
              variant={
                overallStatus === 'critical'
                  ? 'critical'
                  : overallStatus === 'warning'
                  ? 'warning'
                  : 'fresh'
              }
              dot
              size="sm"
            >
              {overallStatus === 'critical'
                ? 'Critical Condition'
                : overallStatus === 'warning'
                ? 'Warning State'
                : 'Optimal Condition'}
            </Badge>
          </div>
        </div>

        {/* 3 Primary Sensor Metrics: Temperature, Humidity, Gas Value */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-2">
          {/* 1. Temperature */}
          <div
            className={`p-3.5 rounded-xl border flex flex-col justify-between transition-colors ${
              tempStatus === 'critical'
                ? 'bg-rose-50/70 border-rose-200'
                : tempStatus === 'warning'
                ? 'bg-amber-50/70 border-amber-200'
                : 'bg-emerald-50/50 border-emerald-100'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold mb-2">
              <span className="flex items-center gap-1.5 text-slate-700">
                <Thermometer className="w-4 h-4 text-emerald-600" />
                <span>Temperature</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {SENSOR_BOUNDARIES.temperature.warningMin}-{SENSOR_BOUNDARIES.temperature.warningMax}°C safe
              </span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-900 tracking-tight">
                {temp !== null && temp !== undefined ? (
                  <>
                    {temp > 0 ? `+${temp}` : temp}
                    <span className="text-sm font-bold text-slate-600 ml-1">°C</span>
                  </>
                ) : (
                  <span className="text-xs text-amber-600 font-semibold">Unavailable</span>
                )}
              </div>
              <p
                className={`text-[10px] font-semibold mt-1 flex items-center gap-1 ${
                  tempStatus === 'critical'
                    ? 'text-rose-700'
                    : tempStatus === 'warning'
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                {tempStatus === 'critical' ? (
                  <>
                    <AlertTriangle className="w-3 h-3 text-rose-600" /> Out of Safe Bounds
                  </>
                ) : tempStatus === 'warning' ? (
                  <>
                    <AlertTriangle className="w-3 h-3 text-amber-600" /> Nearing Boundary
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Safe Range Met
                  </>
                )}
              </p>
            </div>
          </div>

          {/* 2. Humidity */}
          <div
            className={`p-3.5 rounded-xl border flex flex-col justify-between transition-colors ${
              humStatus === 'critical'
                ? 'bg-rose-50/70 border-rose-200'
                : humStatus === 'warning'
                ? 'bg-amber-50/70 border-amber-200'
                : 'bg-sky-50/50 border-sky-100'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold mb-2">
              <span className="flex items-center gap-1.5 text-slate-700">
                <Droplets className="w-4 h-4 text-sky-600" />
                <span>Humidity</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {SENSOR_BOUNDARIES.humidity.warningMin}-{SENSOR_BOUNDARIES.humidity.warningMax}% safe
              </span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-900 tracking-tight">
                {hum !== null && hum !== undefined ? (
                  <>
                    {hum}
                    <span className="text-sm font-bold text-slate-600 ml-1">%</span>
                  </>
                ) : (
                  <span className="text-xs text-amber-600 font-semibold">Unavailable</span>
                )}
              </div>
              <p
                className={`text-[10px] font-semibold mt-1 flex items-center gap-1 ${
                  humStatus === 'critical'
                    ? 'text-rose-700'
                    : humStatus === 'warning'
                    ? 'text-amber-700'
                    : 'text-sky-700'
                }`}
              >
                {humStatus === 'critical' ? (
                  <>
                    <AlertTriangle className="w-3 h-3 text-rose-600" /> Moisture Danger
                  </>
                ) : humStatus === 'warning' ? (
                  <>
                    <AlertTriangle className="w-3 h-3 text-amber-600" /> Elevated Moisture
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-sky-600" /> Ideal Moisture
                  </>
                )}
              </p>
            </div>
          </div>

          {/* 3. Gas Value */}
          <div
            className={`p-3.5 rounded-xl border flex flex-col justify-between transition-colors ${
              gasStatus === 'critical'
                ? 'bg-rose-50/70 border-rose-200'
                : gasStatus === 'warning'
                ? 'bg-amber-50/70 border-amber-200'
                : 'bg-amber-50/50 border-amber-100'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold mb-2">
              <span className="flex items-center gap-1.5 text-slate-700">
                <Wind className="w-4 h-4 text-amber-600" />
                <span>Gas Value</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                &lt;{SENSOR_BOUNDARIES.gasValue.normalMax} safe
              </span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-900 tracking-tight">
                {gas !== null && gas !== undefined ? (
                  <>
                    {gas}
                    <span className="text-xs font-bold text-slate-500 ml-1">ADC</span>
                  </>
                ) : (
                  <span className="text-xs text-amber-600 font-semibold">Unavailable</span>
                )}
              </div>
              <p
                className={`text-[10px] font-semibold mt-1 flex items-center gap-1 ${
                  gasStatus === 'critical'
                    ? 'text-rose-700'
                    : gasStatus === 'warning'
                    ? 'text-amber-700'
                    : 'text-amber-800'
                }`}
              >
                {gasStatus === 'critical' ? (
                  <>
                    <AlertTriangle className="w-3 h-3 text-rose-600" /> Spoilage/VOC Gas High
                  </>
                ) : gasStatus === 'warning' ? (
                  <>
                    <AlertTriangle className="w-3 h-3 text-amber-600" /> Elevated Trace Gas
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Clean Air Quality
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sync Footer */}
      <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
        <span className="flex items-center gap-1 font-mono">
          <span>Mode: Simulated Stream</span>
        </span>
        <span className="font-mono">
          {sensor.lastSync ? `Updated ${formatRelativeTime(sensor.lastSync)}` : 'Generating...'}
        </span>
      </div>
    </Card>
  )
}

export default SensorGauge
