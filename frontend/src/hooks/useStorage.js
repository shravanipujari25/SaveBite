import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { subscribeToSimulator } from '../services/sensorSimulator'

export function useStorage() {
  const [sensors, setSensors] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [simStatus, setSimStatus] = useState({ isRunning: true, currentMode: 'fluctuating', lastUpdated: null })

  // Listen directly to simulated sensor updates in real time
  useEffect(() => {
    setLoading(true)
    const unsubscribe = subscribeToSimulator((payload) => {
      setSensors(payload.sensors || [])
      setAlerts(payload.alerts || [])
      setSimStatus({
        isRunning: payload.isRunning,
        currentMode: payload.currentMode,
        lastUpdated: payload.lastUpdated
      })
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [sRes, aRes] = await Promise.all([
        api.storage.getSensors(),
        api.storage.getAlerts(),
      ])
      if (sRes.data) setSensors(sRes.data)
      if (aRes.data) setAlerts(aRes.data)
    } catch (err) {
      setError(err.message || 'Failed to refresh telemetry')
    }
  }, [])

  const startSimulation = useCallback(async () => {
    await api.storage.startSimulation()
  }, [])

  const stopSimulation = useCallback(async () => {
    await api.storage.stopSimulation()
  }, [])

  const toggleSimulation = useCallback(async () => {
    await api.storage.toggleSimulation()
  }, [])

  const setSimulationMode = useCallback(async (mode) => {
    await api.storage.setSimulationMode(mode)
  }, [])

  const resetSimulation = useCallback(async () => {
    await api.storage.resetSimulation()
  }, [])

  const getSimulationStatus = useCallback(async () => {
    const { data } = await api.storage.getSimulationStatus()
    return data
  }, [])

  return {
    sensors,
    alerts,
    loading,
    error,
    simStatus,
    refresh,
    startSimulation,
    stopSimulation,
    toggleSimulation,
    setSimulationMode,
    resetSimulation,
    getSimulationStatus
  }
}

