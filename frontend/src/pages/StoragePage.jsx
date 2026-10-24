import React, { useEffect, useState } from 'react'
import { useStorage } from '../hooks/useStorage'
import SensorGauge from '../components/storage/SensorGauge'
import Card, { CardHeader } from '../components/common/Card'
import Badge from '../components/common/Badge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import { Cpu, AlertTriangle, Radio, RefreshCw, CheckCircle2, X } from 'lucide-react'
import Button from '../components/common/Button'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import { SENSOR_THRESHOLDS } from '../config/sensorThresholds'
import { formatRelativeTime } from '../utils/formatters'

export function StoragePage() {
  const { sensors, alerts, loading, refresh, startSimulation, stopSimulation, getSimulationStatus } = useStorage()
  const [visibleAlerts, setVisibleAlerts] = useState(alerts)
  const [simInfo, setSimInfo] = useState({ isRunning: false, lastUpdated: null })

  useEffect(() => {
    setVisibleAlerts(alerts)
  }, [alerts])

  const dismissAlert = (id) => {
    setVisibleAlerts((prev) => prev.filter((a) => a.id !== id))
  }

  const fetchSimInfo = async () => {
    const info = await getSimulationStatus()
    setSimInfo(info || { isRunning: false, lastUpdated: null })
  }

  useEffect(() => {
    fetchSimInfo()
    const interval = setInterval(fetchSimInfo, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              IoT Climate & Storage Telemetry
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time sensory telemetry tracking temperature, humidity, ethylene gas, and door seals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="fresh" dot size="md">
            MQTT Broker Connected
          </Badge>
          <Button variant="outline" size="sm" icon={RefreshCw} onClick={refresh}>
            Sync
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner message="Polling sensor telemetry..." />
      ) : (
        <>
          {/* Active Sensor Nodes */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Active Sensor Hardware Nodes ({sensors.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {sensors.map((sensor) => (
                <SensorGauge key={sensor.nodeId} sensor={sensor} />
              ))}
            </div>
          </div>

          {/* Environmental Storage Alerts */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Climate Diagnostics & Storage Alerts
            </h3>
            {/* Simulation Controls */}
            <div className="flex items-center gap-4 mb-4">
              <Button variant="solid" size="sm" onClick={simInfo.isRunning ? stopSimulation : startSimulation}>
                {simInfo.isRunning ? 'Stop Simulation' : 'Start Simulation'}
              </Button>
              <span className="text-xs text-slate-500">
                {simInfo.isRunning ? 'Running' : 'Stopped'} – Last update: {simInfo.lastUpdated ? formatRelativeTime(simInfo.lastUpdated) : 'N/A'}
              </span>
            </div>

            {/* Overall Storage Status */}
            <Card className="mb-4">
              <CardHeader title="Storage Condition" />
              <div className="p-4">
                {(() => {
                  const critical = alerts.some(a => a.severity === 'critical');
                  const warning = alerts.some(a => a.severity === 'warning');
                  if (critical) return <Badge variant="critical" size="md">Critical Condition</Badge>;
                  if (warning) return <Badge variant="warning" size="md">Warning Condition</Badge>;
                  return <Badge variant="fresh" size="md">All Good</Badge>;
                })()}
              </div>
            </Card>

            {/* Device Info */}
            <Card className="mb-4">
              <CardHeader title="Device Info" />
              <div className="p-4 space-y-2 text-xs">
                <div>Connection: <span className={simInfo.isRunning ? 'text-emerald-600' : 'text-rose-600'}>{simInfo.isRunning ? 'Online' : 'Offline'}</span></div>
                <div>Simulation Mode: <span className="font-semibold">{simInfo.isRunning ? 'Enabled' : 'Disabled'}</span></div>
              </div>
            </Card>

            {/* Charts */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {/* Temperature */}
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={sensors.map(s => ({ time: s.lastUpdated, value: s.temperature }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} />
                  <YAxis domain={['auto', 'auto']} />
                  <Tooltip labelFormatter={t => `Time: ${new Date(t).toLocaleString()}`} />
                  <Line type="monotone" dataKey="value" stroke="#10b981" dot={false} />
                </LineChart>
              </ResponsiveContainer>
              {/* Humidity */}
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={sensors.map(s => ({ time: s.lastUpdated, value: s.humidity }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} />
                  <YAxis domain={['auto', 'auto']} />
                  <Tooltip labelFormatter={t => `Time: ${new Date(t).toLocaleString()}`} />
                  <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={false} />
                </LineChart>
              </ResponsiveContainer>
              {/* VOC */}
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={sensors.map(s => ({ time: s.lastUpdated, value: s.voc }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} />
                  <YAxis domain={['auto', 'auto']} />
                  <Tooltip labelFormatter={t => `Time: ${new Date(t).toLocaleString()}`} />
                  <Line type="monotone" dataKey="value" stroke="#ef4444" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Alerts */}
            <Card>

              <div className="space-y-3">
                {visibleAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      alert.severity === 'critical'
                        ? 'bg-rose-50/60 border-rose-200 text-rose-900'
                        : alert.severity === 'warning'
                        ? 'bg-amber-50/60 border-amber-200 text-amber-900'
                        : 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {alert.severity === 'critical' ? (
                          <AlertTriangle className="w-5 h-5 text-rose-600" />
                        ) : alert.severity === 'warning' ? (
                          <AlertTriangle className="w-5 h-5 text-amber-600" />
                        ) : (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold">{alert.title}</h4>
                        <p className="text-xs opacity-90 mt-0.5">{alert.message}</p>
                        {alert.recommendation && (
                          <p className="text-xs font-semibold mt-1.5 underline decoration-emerald-500/30">
                            Recommended Action: {alert.recommendation}
                          </p>
                        )}
                      </div>
                    </div>

                    <Badge
                      variant={
                        alert.severity === 'critical'
                          ? 'critical'
                          : alert.severity === 'warning'
                          ? 'warning'
                          : 'fresh'
                      }
                      size="sm"
                    >
                      {alert.zone} zone
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
            <p className="text-xs text-gray-500 mt-2">Guidance: This simulation uses configurable demonstration thresholds and is not a certified food‑safety guarantee.</p>
          </div>

          {/* IoT Telemetry Protocol Contract Details */}
          <div className="p-4 bg-slate-900 text-slate-200 rounded-2xl text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                <Radio className="w-4 h-4" /> MQTT Telemetry Topic Spec
              </span>
              <span className="text-slate-400 font-mono">QoS 1 • Keepalive 60s</span>
            </div>
            <p className="text-slate-400 leading-relaxed font-mono">
              Topic: <code>savebite/devices/&#123;nodeId&#125;/telemetry</code> &bull; Payload: <code>&#123; temp_c, humidity_pct, ethylene_ppm, door_open, battery_pct &#125;</code>
            </p>
          </div>
        </>
      )}
    </div>
  )
}

export default StoragePage
