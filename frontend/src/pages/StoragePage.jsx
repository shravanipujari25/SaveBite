import React, { useState } from 'react'
import { useStorage } from '../hooks/useStorage'
import SensorGauge from '../components/storage/SensorGauge'
import Card, { CardHeader } from '../components/common/Card'
import Badge from '../components/common/Badge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Thermometer,
  Droplets,
  Wind,
  Activity,
  AlertTriangle,
  CheckCircle2,
  SlidersHorizontal,
  Info
} from 'lucide-react'
import Button from '../components/common/Button'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import { formatRelativeTime } from '../utils/formatters'
import { SENSOR_BOUNDARIES } from '../services/sensorSimulator'

export function StoragePage() {
  const {
    sensors,
    alerts,
    loading,
    simStatus,
    toggleSimulation,
    setSimulationMode,
    resetSimulation
  } = useStorage()

  const [showBoundaries, setShowBoundaries] = useState(false)

  // Primary active sensor node from simulation engine
  const activeSensor = sensors[0] || null
  const historyData = activeSensor?.readingsHistory || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              IoT Sensor Telemetry
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time simulated environmental sensory engine (Temperature, Humidity, Gas Value).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="primary" dot size="md">
            <Sparkles className="w-3.5 h-3.5 mr-1 inline" />
            DEMO MODE ACTIVE
          </Badge>
          <Badge variant={simStatus.isRunning ? 'fresh' : 'neutral'} dot size="md">
            {simStatus.isRunning ? 'Auto-Generating (5s)' : 'Paused'}
          </Badge>
        </div>
      </div>

      {/* Demo Scenario Control Panel */}
      <Card className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white border-0 shadow-lg">
        <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tracking-wider uppercase text-emerald-400">
                  Simulation Control Center
                </span>
                <span className="text-[10px] text-slate-400 font-mono">5s Tick</span>
              </div>
              <p className="text-xs text-slate-300">
                Switch environmental states to test live dashboard reactions, boundary alerts, and trend charts.
              </p>
            </div>
          </div>

          {/* Quick Scenario Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center bg-slate-800/90 rounded-lg p-1 border border-slate-700/80">
              <button
                onClick={() => setSimulationMode('normal')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  simStatus.currentMode === 'normal'
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                }`}
              >
                Normal
              </button>
              <button
                onClick={() => setSimulationMode('warning')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  simStatus.currentMode === 'warning'
                    ? 'bg-amber-500 text-slate-900 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                }`}
              >
                Warning
              </button>
              <button
                onClick={() => setSimulationMode('critical')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  simStatus.currentMode === 'critical'
                    ? 'bg-rose-500 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                }`}
              >
                Critical
              </button>
              <button
                onClick={() => setSimulationMode('fluctuating')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  simStatus.currentMode === 'fluctuating'
                    ? 'bg-sky-500 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                }`}
              >
                Organic Drift
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              icon={simStatus.isRunning ? Pause : Play}
              onClick={toggleSimulation}
              className="bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700"
            >
              {simStatus.isRunning ? 'Pause' : 'Resume'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              icon={RotateCcw}
              onClick={resetSimulation}
              className="bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700"
            >
              Reset
            </Button>

            <button
              onClick={() => setShowBoundaries((prev) => !prev)}
              className="px-2.5 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium flex items-center gap-1 rounded-md hover:bg-slate-800"
              title="View configured thresholds"
            >
              <Info className="w-3.5 h-3.5" />
              <span>Limits</span>
            </button>
          </div>
        </div>

        {/* Expandable Boundary Reference Drawer */}
        {showBoundaries && (
          <div className="border-t border-slate-800 p-4 bg-slate-950/60 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-emerald-400 font-bold block mb-1">Temperature Safe Boundaries</span>
              <span className="text-slate-300 font-mono">
                Safe: {SENSOR_BOUNDARIES.temperature.warningMin}°C – {SENSOR_BOUNDARIES.temperature.warningMax}°C<br />
                Critical: &lt;{SENSOR_BOUNDARIES.temperature.min}°C or &gt;{SENSOR_BOUNDARIES.temperature.max}°C
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-sky-400 font-bold block mb-1">Humidity Safe Boundaries</span>
              <span className="text-slate-300 font-mono">
                Safe: {SENSOR_BOUNDARIES.humidity.warningMin}% – {SENSOR_BOUNDARIES.humidity.warningMax}%<br />
                Critical: &lt;{SENSOR_BOUNDARIES.humidity.min}% or &gt;{SENSOR_BOUNDARIES.humidity.max}%
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-amber-400 font-bold block mb-1">Gas Value Boundaries (MQ-135)</span>
              <span className="text-slate-300 font-mono">
                Clean: &lt;{SENSOR_BOUNDARIES.gasValue.normalMax} ADC<br />
                Elevated: {SENSOR_BOUNDARIES.gasValue.normalMax} – {SENSOR_BOUNDARIES.gasValue.warningMax} ADC<br />
                High / Spoilage: &gt;{SENSOR_BOUNDARIES.gasValue.warningMax} ADC
              </span>
            </div>
          </div>
        )}
      </Card>

      {loading ? (
        <LoadingSpinner message="Initializing simulated sensor telemetry..." />
      ) : (
        <>
          {/* Active Sensor Nodes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Simulated Hardware Nodes ({sensors.length})
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                Scenario: <span className="text-slate-700 font-semibold uppercase">{simStatus.currentMode}</span>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sensors.map((sensor) => (
                <SensorGauge key={sensor.nodeId} sensor={sensor} />
              ))}
            </div>
          </div>

          {/* Real-Time Telemetry Trends */}
          {activeSensor && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-600" />
                  Live Sensor History (Auto-Updating)
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">
                  {activeSensor.lastSync ? `Updated ${formatRelativeTime(activeSensor.lastSync)}` : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. Temperature Chart */}
                <Card>
                  <CardHeader
                    title="Temperature (°C)"
                    action={<Thermometer className="w-4 h-4 text-emerald-600" />}
                  />
                  <div className="p-3 pt-0">
                    <div className="text-xl font-black text-slate-900 mb-2">
                      {activeSensor.temperature !== null ? `${activeSensor.temperature} °C` : '--'}
                    </div>
                    <div className="h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={historyData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis
                            dataKey="time"
                            tickFormatter={(t) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')}
                            tick={{ fontSize: 9, fill: '#94a3b8' }}
                          />
                          <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                          <Tooltip
                            labelFormatter={(t) => (t ? new Date(t).toLocaleTimeString() : '')}
                            formatter={(val) => [`${val} °C`, 'Temperature']}
                          />
                          <Line
                            type="monotone"
                            dataKey="temperature"
                            stroke="#10b981"
                            strokeWidth={2}
                            dot={{ r: 2 }}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </Card>

                {/* 2. Humidity Chart */}
                <Card>
                  <CardHeader
                    title="Humidity (%)"
                    action={<Droplets className="w-4 h-4 text-sky-600" />}
                  />
                  <div className="p-3 pt-0">
                    <div className="text-xl font-black text-slate-900 mb-2">
                      {activeSensor.humidity !== null ? `${activeSensor.humidity} %` : '--'}
                    </div>
                    <div className="h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={historyData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis
                            dataKey="time"
                            tickFormatter={(t) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')}
                            tick={{ fontSize: 9, fill: '#94a3b8' }}
                          />
                          <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                          <Tooltip
                            labelFormatter={(t) => (t ? new Date(t).toLocaleTimeString() : '')}
                            formatter={(val) => [`${val} %`, 'Humidity']}
                          />
                          <Line
                            type="monotone"
                            dataKey="humidity"
                            stroke="#0284c7"
                            strokeWidth={2}
                            dot={{ r: 2 }}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </Card>

                {/* 3. Gas Value Chart */}
                <Card>
                  <CardHeader
                    title="Gas Value (Raw ADC)"
                    action={<Wind className="w-4 h-4 text-amber-600" />}
                  />
                  <div className="p-3 pt-0">
                    <div className="text-xl font-black text-slate-900 mb-2">
                      {activeSensor.gasValue !== null ? activeSensor.gasValue : '--'}
                    </div>
                    <div className="h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={historyData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis
                            dataKey="time"
                            tickFormatter={(t) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')}
                            tick={{ fontSize: 9, fill: '#94a3b8' }}
                          />
                          <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                          <Tooltip
                            labelFormatter={(t) => (t ? new Date(t).toLocaleTimeString() : '')}
                            formatter={(val) => [`${val}`, 'Gas Value']}
                          />
                          <Line
                            type="monotone"
                            dataKey="gasValue"
                            stroke="#f59e0b"
                            strokeWidth={2}
                            dot={{ r: 2 }}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* Environmental Boundary Status & Alert Panel */}
          {alerts && alerts.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                Simulated Environmental Diagnostics & Alerts ({alerts.length})
              </h3>
              <div className="space-y-2.5">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
                      alert.severity === 'critical'
                        ? 'bg-rose-50/80 border-rose-200 text-rose-950'
                        : 'bg-amber-50/80 border-amber-200 text-amber-950'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {alert.severity === 'critical' ? (
                          <AlertTriangle className="w-4 h-4 text-rose-600" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-amber-600" />
                        )}
                      </div>
                      <div>
                        <h4 className="text-xs font-bold">{alert.title}</h4>
                        <p className="text-xs text-slate-600 mt-0.5">{alert.message}</p>
                        {alert.recommendation && (
                          <p className="text-[11px] font-semibold mt-1 text-slate-700">
                            Action: {alert.recommendation}
                          </p>
                        )}
                      </div>
                    </div>

                    <Badge variant={alert.severity === 'critical' ? 'critical' : 'warning'} size="sm">
                      {alert.severity.toUpperCase()}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default StoragePage
