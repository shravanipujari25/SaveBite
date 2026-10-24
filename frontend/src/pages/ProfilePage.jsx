import React, { useState, useEffect } from 'react'
import { api } from '../api/client'
import Card, { CardHeader } from '../components/common/Card'
import Button from '../components/common/Button'
import Badge from '../components/common/Badge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import { User, Users, Shield, Award, Flame, HeartHandshake, CheckCircle } from 'lucide-react'

export function ProfilePage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: res } = await api.user.getPreferences()
        if (res) setData(res)
      } catch (err) {
        console.error('Failed to load profile:', err)
      } finally {
        setLoading(false)
      }
    }
    loadProfile()
  }, [])

  if (loading || !data) {
    return <LoadingSpinner message="Loading household profile..." />
  }

  const { user, preferences } = data

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Profile Header Card */}
      <Card padding="p-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
          <div className="w-20 h-20 rounded-3xl bg-emerald-800 text-white flex items-center justify-center text-3xl font-bold ring-4 ring-emerald-600/20 shadow-md">
            {user.avatar ? (
              <img src={user.avatar} alt={user.name} className="w-full h-full object-cover rounded-3xl" />
            ) : (
              'SM'
            )}
          </div>

          <div className="text-center sm:text-left flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <h2 className="text-xl font-black text-slate-900">{user.name}</h2>
              <Badge variant="brand" size="sm">
                {user.role}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{user.email}</p>

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
              <span className="flex items-center gap-1.5 font-semibold">
                <Users className="w-4 h-4 text-emerald-600" />
                {user.householdSize} Household Members
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-amber-700">
                <Flame className="w-4 h-4 text-amber-500" />
                19-Day Rescue Streak
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Household Preferences & Dietary Restrictions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader
            title="Dietary Focus & Allergies"
            subtitle="Recipe recommendation criteria"
          />
          <div className="flex flex-wrap gap-2">
            {preferences.dietaryRestrictions?.map((d) => (
              <span
                key={d}
                className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200"
              >
                🌱 {d}
              </span>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Eco & Financial Targets"
            subtitle="Target monthly goals"
          />
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Savings Target:</span>
              <span className="font-bold text-slate-900">₹{preferences.ecoGoals?.monthlySavingsTarget}/mo</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Zero Waste Streak Target:</span>
              <span className="font-bold text-slate-900">{preferences.ecoGoals?.zeroWasteStreakTargetDays} Days</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Notification Threshold:</span>
              <span className="font-bold text-slate-900">{preferences.warningDaysThreshold} Days Before Expiry</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default ProfilePage
