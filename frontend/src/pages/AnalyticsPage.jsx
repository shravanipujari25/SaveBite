import React, { useState, useEffect } from 'react'
import { api } from '../api/client'
import Card, { CardHeader } from '../components/common/Card'
import LoadingSpinner from '../components/common/LoadingSpinner'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { TrendingUp, AlertTriangle, Lightbulb, PiggyBank, Leaf } from 'lucide-react'
import { formatCurrency } from '../utils/formatters'

export function AnalyticsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadAnalytics() {
      try {
        const { data: res } = await api.analytics.getWasteReport()
        if (res) setData(res)
      } catch (err) {
        console.error('Failed to load waste analytics:', err)
      } finally {
        setLoading(false)
      }
    }
    loadAnalytics()
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Food Waste & Savings Analytics
          </h2>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          Quantify grocery expenses, food waste diversion, and ecological impact over time.
        </p>
      </div>

      {loading || !data ? (
        <LoadingSpinner message="Calculating savings and waste reduction metrics..." />
      ) : (
        <>
          {/* Top Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card padding="p-5" className="bg-emerald-900 text-white">
              <span className="text-xs uppercase font-bold text-emerald-300 tracking-wider">
                Total Grocery Saved
              </span>
              <div className="text-3xl font-black mt-1">
                {formatCurrency(data.monthlySummary.totalSaved)}
              </div>
              <p className="text-xs text-emerald-200 mt-1">
                {data.monthlySummary.wasteReductionPercentage}% waste diversion rate
              </p>
            </Card>

            <Card padding="p-5">
              <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                Unavoidable Waste Loss
              </span>
              <div className="text-3xl font-black text-rose-600 mt-1">
                {formatCurrency(data.monthlySummary.totalWasted)}
              </div>
              <p className="text-xs text-slate-500 mt-1">Down 68% from last month</p>
            </Card>

            <Card padding="p-5">
              <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                Ecological Impact
              </span>
              <div className="text-3xl font-black text-emerald-800 mt-1">
                {data.monthlySummary.carbonSavedKg} kg
              </div>
              <p className="text-xs text-slate-500 mt-1">CO₂ greenhouse gas prevented</p>
            </Card>
          </div>

          {/* Weekly Trends Chart */}
          <Card>
            <CardHeader
              title="Weekly Grocery Flow (₹ Saved vs ₹ Wasted)"
              subtitle="Progress tracking across current billing cycle"
            />
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.weeklyTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-slate-900 text-white text-xs p-2.5 rounded-xl shadow-lg space-y-1">
                            <p className="font-bold">{label}</p>
                            <p className="text-emerald-400">Saved: ₹{payload[0]?.value}</p>
                            <p className="text-rose-400">Wasted: ₹{payload[1]?.value}</p>
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Legend />
                  <Bar dataKey="saved" name="Value Saved (₹)" fill="#047857" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="wasted" name="Value Lost (₹)" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Bottom Grid: Top Wasted Categories + Prevention Tips */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Top Wasted Categories */}
            <Card>
              <CardHeader
                title="Top Wasted Categories"
                subtitle="High-risk food groups requiring storage adjustments"
              />
              <div className="space-y-3">
                {(!data.topWastedCategories || data.topWastedCategories.length === 0) ? (
                  <div className="p-4 text-center text-xs text-slate-500 bg-slate-50 rounded-xl">
                    No food waste recorded for this period. Great job keeping your kitchen waste-free!
                  </div>
                ) : (
                  data.topWastedCategories.map((cat, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-slate-800">{cat.category}</span>
                        <span className="text-rose-600 font-bold">{formatCurrency(cat.loss)} lost</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-rose-500 h-2 rounded-full"
                          style={{ width: `${cat.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Practical AI Prevention Tips */}
            <Card>
              <CardHeader
                title="AI Pantry Storage Tips"
                subtitle="Actionable steps to eliminate residual waste"
              />
              <div className="space-y-2.5">
                {data.preventionTips.map((tip, idx) => (
                  <div
                    key={idx}
                    className="flex gap-2.5 p-3 rounded-xl bg-emerald-50/60 border border-emerald-100 text-xs text-slate-700"
                  >
                    <Lightbulb className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

export default AnalyticsPage
