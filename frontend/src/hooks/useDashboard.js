import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { usePantry } from '../context/PantryContext'

export function useDashboard() {
  const { items } = usePantry()
  const [metrics, setMetrics] = useState(null)
  const [buckets, setBuckets] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [mRes, bRes] = await Promise.all([
        api.dashboard.getMetrics(),
        api.dashboard.getFreshnessBuckets(),
      ])
      if (mRes.error) throw new Error(mRes.error)
      if (bRes.error) throw new Error(bRes.error)
      setMetrics(mRes.data)
      setBuckets(bRes.data)
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData, items])

  return { metrics, buckets, loading, error, refresh: loadData }
}
