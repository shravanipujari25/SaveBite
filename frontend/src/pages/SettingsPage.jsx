import React, { useState, useEffect } from 'react'
import { api } from '../api/client'
import { isSupabaseConfigured } from '../lib/supabase'
import Card, { CardHeader } from '../components/common/Card'
import Button from '../components/common/Button'
import Badge from '../components/common/Badge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import { Settings, Bell, Server, Check, Save } from 'lucide-react'

export function SettingsPage() {
  const [prefs, setPrefs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savedSuccess, setSavedSuccess] = useState(false)

  useEffect(() => {
    async function loadSettings() {
      try {
        const { data } = await api.user.getPreferences()
        if (data) setPrefs(data.preferences)
      } catch (err) {
        console.error('Failed to load settings:', err)
      } finally {
        setLoading(false)
      }
    }
    loadSettings()
  }, [])

  const handleToggle = (key) => {
    setPrefs((prev) => ({
      ...prev,
      pushAlerts: {
        ...prev.pushAlerts,
        [key]: !prev.pushAlerts[key],
      },
    }))
  }

  const handleSave = async () => {
    try {
      await api.user.updatePreferences({ preferences: prefs })
      setSavedSuccess(true)
      setTimeout(() => setSavedSuccess(false), 2500)
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }

  if (loading || !prefs) {
    return <LoadingSpinner message="Loading settings..." />
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            System & Notification Settings
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure freshness thresholds, IoT alerts, and backend API contracts.
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          icon={savedSuccess ? Check : Save}
          onClick={handleSave}
          className={savedSuccess ? 'bg-emerald-600' : ''}
        >
          {savedSuccess ? 'Saved!' : 'Save Preferences'}
        </Button>
      </div>

      {/* Freshness & Units */}
      <Card>
        <CardHeader
          title="Regional Preferences & Units"
          subtitle="Display units for temperature and currency"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Temperature Scale
            </label>
            <div className="grid grid-cols-2 gap-2">
              {['°C', '°F'].map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => setPrefs({ ...prefs, temperatureUnit: unit })}
                  className={`py-2 text-xs font-bold rounded-xl border transition-colors cursor-pointer ${
                    prefs.temperatureUnit === unit
                      ? 'bg-emerald-800 text-white border-emerald-800'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Celsius ({unit})
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Currency
            </label>
            <select
              value={prefs.currency}
              onChange={(e) => setPrefs({ ...prefs, currency: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="USD">USD ($ - United States Dollar)</option>
              <option value="EUR">EUR (€ - Euro)</option>
              <option value="INR">INR (₹ - Indian Rupee)</option>
              <option value="GBP">GBP (£ - British Pound)</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Push & Realtime Alerts */}
      <Card>
        <CardHeader
          title="Notification Triggers"
          subtitle="Control automated alerts for food expiry and storage anomalies"
        />

        <div className="space-y-3">
          {[
            {
              key: 'expiringItems',
              title: 'Expiring Items Alert',
              desc: 'Notify when groceries reach <= 48h before estimated expiration.',
            },
            {
              key: 'sensorWarnings',
              title: 'IoT Storage Diagnostics',
              desc: 'Warn when temperature exceeds 4.5°C or ethylene gas reaches >0.8 ppm.',
            },
            {
              key: 'recipeSuggestions',
              title: 'Waste-Less Meal Recommendations',
              desc: 'Daily dinner suggestion matching high-risk pantry items.',
            },
            {
              key: 'weeklySummary',
              title: 'Weekly Waste Reduction Report',
              desc: 'Weekly email digest showing financial savings and carbon footprint diverted.',
            },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between p-3 rounded-xl bg-slate-50/70 border border-slate-200/60"
            >
              <div className="pr-4">
                <p className="text-xs font-bold text-slate-900">{item.title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
              </div>
              <input
                type="checkbox"
                checked={Boolean(prefs.pushAlerts?.[item.key])}
                onChange={() => handleToggle(item.key)}
                className="w-4 h-4 rounded text-emerald-700 focus:ring-emerald-600 cursor-pointer"
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Backend & Mock System Status */}
      <Card>
        <CardHeader
          title="Infrastructure & API Status"
          subtitle="Phase 0 client integration telemetry"
        />

        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/60">
            <div>
              <p className="font-bold text-slate-800">Frontend Mock Mode</p>
              <p className="text-slate-500 text-[11px]">
                {api.isMockMode
                  ? 'Active (VITE_USE_MOCKS=true) - Persistent via browser storage'
                  : 'Inactive - Connected to live backend'}
              </p>
            </div>
            <Badge variant={api.isMockMode ? 'fresh' : 'neutral'} dot size="sm">
              {api.isMockMode ? 'Mock Active' : 'Live API'}
            </Badge>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/60">
            <div>
              <p className="font-bold text-slate-800">Supabase Client Status</p>
              <p className="text-slate-500 text-[11px]">
                {isSupabaseConfigured
                  ? 'Connected to remote Supabase project'
                  : 'Safe offline fallback (Set VITE_SUPABASE_URL & ANON_KEY to link)'}
              </p>
            </div>
            <Badge variant={isSupabaseConfigured ? 'fresh' : 'neutral'} size="sm">
              {isSupabaseConfigured ? 'Linked' : 'Offline / Standby'}
            </Badge>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60">
            <p className="font-bold text-slate-800">Configured Base URL</p>
            <p className="text-slate-500 text-[11px] font-mono mt-0.5">{api.baseUrl}</p>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default SettingsPage
