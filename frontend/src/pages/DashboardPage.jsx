import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePantry } from '../context/PantryContext'
import { useDashboard } from '../hooks/useDashboard'
import MetricsSummary from '../components/dashboard/MetricsSummary'
import UseFirstSection from '../components/dashboard/UseFirstSection'
import RecentActivityFeed from '../components/dashboard/RecentActivityFeed'
import FreshnessDonut from '../components/dashboard/FreshnessDonut'
import StorageCard from '../components/storage/StorageCard'
import ItemDetailsModal from '../components/pantry/ItemDetailsModal'
import ItemActionModal from '../components/pantry/ItemActionModal'
import Button from '../components/common/Button'
import { Plus, Refrigerator, ChefHat, ArrowUpRight, CheckCircle } from 'lucide-react'
import { formatCurrency } from '../utils/formatters'

export function DashboardPage() {
  const { user } = useAuth()
  const {
    items,
    activityLogs,
    dashboardSummary,
    loading: pantryLoading,
    consumeItem,
    wasteItem,
    openItem,
    deleteItem,
  } = usePantry()

  const { buckets, loading: dashboardLoading } = useDashboard()

  // Modal interactions
  const [selectedItem, setSelectedItem] = useState(null)
  const [actionModalState, setActionModalState] = useState({
    isOpen: false,
    item: null,
    actionType: null,
  })
  const [toastMessage, setToastMessage] = useState('')

  const showToast = (msg) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(''), 3000)
  }

  const handleOpenAction = (item, type) => {
    setActionModalState({
      isOpen: true,
      item,
      actionType: type,
    })
  }

  const handleConfirmAction = async (itemId, qty, extra1, extra2) => {
    const type = actionModalState.actionType
    if (type === 'consume') {
      await consumeItem(itemId, qty, extra1)
      showToast('Item marked as consumed! Pantry value saved.')
    } else if (type === 'waste') {
      await wasteItem(itemId, qty, extra1, extra2)
      showToast('Food waste logged to analytics.')
    } else if (type === 'open') {
      await openItem(itemId)
      showToast('Package marked as opened.')
    }
  }

  const handleDelete = async (id) => {
    if (window.confirm('Delete this item from pantry inventory?')) {
      await deleteItem(id)
      showToast('Item deleted.')
    }
  }

  const userName = user?.name ? user.name.split(' ')[0] : 'Sarah'

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-20 sm:bottom-6 right-6 z-50 p-3.5 bg-slate-900 text-white rounded-2xl shadow-xl flex items-center gap-2.5 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hero Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-emerald-900 via-emerald-800 to-emerald-950 text-white p-6 rounded-3xl shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
              SaveBite Household Dashboard
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight">
            Welcome back, {userName}!
          </h2>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          <Link to="/pantry">
            <Button
              variant="secondary"
              size="sm"
              icon={Refrigerator}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20"
            >
              View Full Pantry
            </Button>
          </Link>
          <Link to="/groceries/add">
            <Button
              variant="primary"
              size="sm"
              icon={Plus}
              className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold"
            >
              Add Groceries
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <MetricsSummary summary={dashboardSummary} loading={pantryLoading} />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 spans): Use First & Recent Activity */}
        <div className="lg:col-span-2 space-y-6">
          {/* Use First Priority Queue */}
          <UseFirstSection
            items={dashboardSummary?.itemsToUseFirst || []}
            onConsume={(item) => handleOpenAction(item, 'consume')}
            onOpenDetails={setSelectedItem}
          />

          {/* Recent Pantry Activity */}
          <RecentActivityFeed activities={activityLogs} />
        </div>

        {/* Right Column (1 span): Donut Chart & Quick Insights */}
        <div className="space-y-6">
          {/* Freshness Health Index Chart */}
          <FreshnessDonut buckets={buckets} loading={dashboardLoading} />

          {/* Quick Storage Zones Telemetry Link */}
          <div className="p-4 rounded-2xl bg-white border border-[#edebe4] shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Storage Climate
              </span>
              <Link
                to="/storage"
                className="text-xs font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1"
              >
                <span>Live Sensors</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="flex items-center gap-2 text-slate-700 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Refrigerator
                </span>
                <span className="font-bold text-slate-900">3.8°C • Optimal</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="flex items-center gap-2 text-slate-700 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Deep Freezer
                </span>
                <span className="font-bold text-slate-900">-18.4°C • Stable</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Item Details Modal */}
      <ItemDetailsModal
        isOpen={Boolean(selectedItem)}
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onTriggerAction={handleOpenAction}
        onDelete={handleDelete}
      />

      {/* Action Modal (Consume, Waste, Open) */}
      <ItemActionModal
        isOpen={actionModalState.isOpen}
        item={actionModalState.item}
        actionType={actionModalState.actionType}
        onClose={() => setActionModalState({ isOpen: false, item: null, actionType: null })}
        onConfirm={handleConfirmAction}
      />
    </div>
  )
}

export default DashboardPage
