import React, { useState, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePantry } from '../context/PantryContext'
import PantryFilterBar from '../components/pantry/PantryFilterBar'
import PantryItemCard from '../components/pantry/PantryItemCard'
import ItemDetailsModal from '../components/pantry/ItemDetailsModal'
import ItemActionModal from '../components/pantry/ItemActionModal'
import FreshnessLegend from '../components/pantry/FreshnessLegend'
import EmptyState from '../components/common/EmptyState'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Badge from '../components/common/Badge'
import Button from '../components/common/Button'
import { Plus, Refrigerator, CheckCircle, PackageOpen, Trash2, Eye } from 'lucide-react'
import { formatDate, formatCurrency } from '../utils/formatters'

export function PantryPage() {
  const [searchParams] = useSearchParams()
  const initialLocation = searchParams.get('location') || 'all'

  const {
    items,
    loading,
    error,
    consumeItem,
    wasteItem,
    openItem,
    deleteItem,
    refresh,
  } = usePantry()

  const [searchQuery, setSearchQuery] = useState('')
  const [activeLocation, setActiveLocation] = useState(initialLocation)
  const [activeCategory, setActiveCategory] = useState('All Categories')
  const [activeStatus, setActiveStatus] = useState('all')
  const [viewMode, setViewMode] = useState('grid')

  // Modals state
  const [selectedItem, setSelectedItem] = useState(null)
  const [actionModalState, setActionModalState] = useState({
    isOpen: false,
    item: null,
    actionType: null, // 'consume' | 'waste' | 'open'
  })
  const [feedbackToast, setFeedbackToast] = useState('')

  const showToast = (msg) => {
    setFeedbackToast(msg)
    setTimeout(() => setFeedbackToast(''), 3000)
  }

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Location filter
      if (activeLocation !== 'all' && item.location !== activeLocation) return false

      // Category filter
      if (activeCategory !== 'All Categories' && item.category !== activeCategory) return false

      // Status / Freshness filter
      if (activeStatus === 'opened') {
        if (!item.isOpened) return false
      } else if (activeStatus !== 'all') {
        if (item.status !== activeStatus) return false
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const matchName = item.name.toLowerCase().includes(query)
        const matchCat = item.category?.toLowerCase().includes(query)
        const matchNotes = item.notes?.toLowerCase().includes(query)
        const matchZone = item.storageZone?.toLowerCase().includes(query)
        return matchName || matchCat || matchNotes || matchZone
      }

      return true
    })
  }, [items, activeLocation, activeCategory, activeStatus, searchQuery])

  // Handlers
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
      showToast('Item successfully marked as consumed! Value added to monthly savings.')
    } else if (type === 'waste') {
      await wasteItem(itemId, qty, extra1, extra2)
      showToast('Food waste logged to analytics to assist future shopping optimization.')
    } else if (type === 'open') {
      await openItem(itemId)
      showToast('Item marked as opened! Moved to priority use queue.')
    }
  }

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to remove this item from your pantry?')) {
      await deleteItem(id)
      showToast('Item removed from pantry inventory.')
    }
  }

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {feedbackToast && (
        <div className="fixed bottom-20 sm:bottom-6 right-6 z-50 p-3.5 bg-slate-900 text-white rounded-2xl shadow-xl flex items-center gap-2.5 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{feedbackToast}</span>
        </div>
      )}

      {/* Header with Title and Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            My Grocery Pantry
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time grocery inventory tracking freshness, estimated INR values, and package opening dates.
          </p>
        </div>

        <Link to="/groceries/add">
          <Button variant="primary" icon={Plus} size="sm">
            Add Groceries
          </Button>
        </Link>
      </div>

      {/* Filter and Search Bar */}
      <PantryFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeLocation={activeLocation}
        onLocationChange={setActiveLocation}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        activeStatus={activeStatus}
        onStatusChange={setActiveStatus}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {/* Main List / Grid */}
      {loading ? (
        <LoadingSpinner message="Scanning pantry inventory..." />
      ) : error ? (
        <div className="p-6 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200">
          <p className="font-bold">Failed to load pantry</p>
          <p className="text-xs mt-1">{error}</p>
          <Button variant="outline" size="sm" onClick={refresh} className="mt-3">
            Retry
          </Button>
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={Refrigerator}
          title="No grocery items found"
          description={
            searchQuery || activeLocation !== 'all' || activeCategory !== 'All Categories' || activeStatus !== 'all'
              ? 'No pantry items match your active filters. Try clearing your search or category selection.'
              : 'Your pantry is currently empty. Add your first grocery item to start tracking freshness!'
          }
          actionLabel="Log a Grocery Item"
          onAction={() => (window.location.href = '/groceries/add')}
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => (
            <PantryItemCard
              key={item.id}
              item={item}
              onSelect={setSelectedItem}
              onDelete={handleDelete}
              onConsume={(i) => handleOpenAction(i, 'consume')}
            />
          ))}
        </div>
      ) : (
        /* List View */
        <div className="bg-white rounded-2xl border border-[#edebe4] shadow-xs overflow-hidden">
          <div className="divide-y divide-slate-100">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl shrink-0">{item.imageEmoji || '🥦'}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-slate-900 truncate">{item.name}</p>
                      {item.isOpened && (
                        <span className="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded">
                          Opened
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {item.quantity} {item.unit} &bull; {item.location} ({item.storageZone || 'Shelf'})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs font-bold text-emerald-800">
                      {formatCurrency(item.estimatedCost)}
                    </p>
                    <p className="text-[10px] text-slate-400">Exp: {formatDate(item.expiryDate)}</p>
                  </div>

                  <Badge
                    variant={
                      item.status === 'critical'
                        ? 'critical'
                        : item.status === 'use_soon'
                        ? 'warning'
                        : item.status === 'expired'
                        ? 'neutral'
                        : 'fresh'
                    }
                    dot
                    size="sm"
                  >
                    {item.daysRemaining <= 0 ? 'Today' : `${item.daysRemaining}d`}
                  </Badge>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenAction(item, 'consume')
                    }}
                    className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                    title="Consume"
                  >
                    <CheckCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Freshness Legend */}
      <FreshnessLegend />

      {/* Item Details Modal */}
      <ItemDetailsModal
        isOpen={Boolean(selectedItem)}
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onTriggerAction={handleOpenAction}
        onDelete={handleDelete}
      />

      {/* Action Confirmation Modal (Consume, Waste, Open) */}
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

export default PantryPage
