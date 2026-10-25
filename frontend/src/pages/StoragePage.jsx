import React, { useEffect } from 'react'
import { useStorage } from '../hooks/useStorage'
import SensorGauge from '../components/storage/SensorGauge'
import Card, { CardHeader } from '../components/common/Card'
import Badge from '../components/common/Badge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import { RefreshCw, Thermometer, Droplets, Wind, Activity } from 'lucide-react'
import Button from '../components/common/Button'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import { formatRelativeTime } from '../utils/formatters'

export function StoragePage() {
  const { sensors, loading, refresh } = useStorage()

  // Real-time auto-poll every 3 seconds silently in the background
  useEffect(() => {
    const interval = setInterval(() => {
      refresh(true)
    }, 3000)
    return () => clearInterval(interval)
  }, [refresh])

  // Extract history points from the primary active sensor node
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
            Real-time live telemetry directly from your ESP32 hardware node (DHT11 & MQ-135).
          </p>
        </div>

        <div className="flex items-center gap-2">
          {sensors && sensors.length > 0 ? (
            <Badge variant="fresh" dot size="md">
              Live Stream Active
            </Badge>
          ) : (
            <Badge variant="neutral" dot size="md">
              Waiting for ESP32...
            </Badge>
          )}
          <Button variant="outline" size="sm" icon={RefreshCw} onClick={() => refresh(false)}>
            Sync Now
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner message="Connecting to ESP32 telemetry stream..." />
      ) : (
        <>
          {/* Active Sensor Nodes */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Live Hardware Nodes ({sensors.length})
            </h3>
            {sensors.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 bg-white rounded-2xl border border-slate-200">
                No active sensor nodes transmitting. Ensure your ESP32 is powered on and connected to Wi-Fi.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sensors.map((sensor) => (
                  <SensorGauge key={sensor.nodeId} sensor={sensor} />
                ))}
              </div>
            )}
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
                  {activeSensor.lastSync ? `Latest reading: ${formatRelativeTime(activeSensor.lastSync)}` : ''}
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
        </>
      )}
    </div>
  )
}

export default StoragePage
