import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

export function useStorage() {
  const [sensors, setSensors] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadData = useCallback(async (isBackground = false) => {
    if (!isBackground) {
      setLoading(true)
    }
    setError(null)
    try {
      const [sRes, aRes] = await Promise.all([
        api.storage.getSensors(),
        api.storage.getAlerts(),
      ])
      if (sRes.error) throw new Error(sRes.error)
      if (aRes.error) throw new Error(aRes.error)
      setSensors(sRes.data || [])
      setAlerts(aRes.data || [])
    } catch (err) {
      setError(err.message || 'Failed to load storage telemetry')
    } finally {
      if (!isBackground) {
        setLoading(false)
      }
    }
  }, [])

  const startSimulation = useCallback(async () => {
    try {
      await api.storage.startSimulation()
      await loadData()
    } catch (e) {
      console.error('Failed to start simulation', e)
    }
  }, [loadData])

  const stopSimulation = useCallback(async () => {
    try {
      await api.storage.stopSimulation()
      await loadData()
    } catch (e) {
      console.error('Failed to stop simulation', e)
    }
  }, [loadData])

  const getSimulationStatus = useCallback(async () => {
    try {
      const { data } = await api.storage.getSimulationStatus()
      return data
    } catch (e) {
      console.error('Failed to get simulation status', e)
      return null
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  return { sensors, alerts, loading, error, refresh: loadData, startSimulation, stopSimulation, getSimulationStatus }
}
