import React, { useState, useEffect, useMemo } from 'react'
import { api } from '../api/client'
import Card from '../components/common/Card'
import Button from '../components/common/Button'
import Badge from '../components/common/Badge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import {
  ShoppingBag,
  Plus,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Sparkles,
  Search,
  ShoppingCart,
  Edit2,
  X,
  PackageCheck,
  RefreshCw,
  Info,
  DollarSign,
  Layers,
  ArrowRight
} from 'lucide-react'
import { formatCurrency } from '../utils/formatters'

export function ShoppingListPage() {
  // Primary state
  const [items, setItems] = useState([])
  const [recommendations, setRecommendations] = useState([])
  const [loading, setLoading] = useState(true)
  const [recLoading, setRecLoading] = useState(false)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  // Filters & Tabs
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'needed' | 'cart' | 'purchased'
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')

  // Quick Manual Add Form state
  const [newItemName, setNewItemName] = useState('')
  const [newItemCategory, setNewItemCategory] = useState('Produce')
  const [newItemQuantity, setNewItemQuantity] = useState('1')
  const [newItemUnit, setNewItemUnit] = useState('piece')
  const [newItemPrice, setNewItemPrice] = useState('')
  const [newItemNotes, setNewItemNotes] = useState('')
  const [duplicateWarning, setDuplicateWarning] = useState(null)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Edit Item Modal state
  const [editingItem, setEditingItem] = useState(null)
  const [editForm, setEditForm] = useState({
    name: '',
    quantity: 1,
    unit: 'piece',
    category: 'Produce',
    notes: '',
    estimatedPrice: ''
  })

  // Purchase Modal state
  const [purchasingItem, setPurchasingItem] = useState(null)
  const [purchaseForm, setPurchaseForm] = useState({
    purchasedQuantity: 1,
    purchasePrice: '',
    storageLocation: 'pantry',
    purchaseDate: new Date().toISOString().split('T')[0],
    expiryDate: ''
  })
  const [purchaseSubmitting, setPurchaseSubmitting] = useState(false)

  // Auto-dismiss alerts
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  // Load shopping list & recommendations
  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [listRes, recRes] = await Promise.all([
        api.shoppingList.getAll(),
        api.shoppingList.getRecommendations({ replenishment_days: 7 })
      ])

      if (listRes.error) {
        setError(listRes.error)
      } else if (listRes.data) {
        setItems(listRes.data)
      }

      if (recRes.data?.recommendations) {
        setRecommendations(recRes.data.recommendations)
      }
    } catch (err) {
      console.error('Failed to load shopping data:', err)
      setError('Failed to connect to shopping list service.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Duplicate pre-check debouncer on name/quantity/unit change in add form
  useEffect(() => {
    if (!newItemName.trim() || newItemName.trim().length < 2) {
      setDuplicateWarning(null)
      return
    }

    const timer = setTimeout(async () => {
      setIsEvaluating(true)
      try {
        const res = await api.shoppingList.evaluateDuplicate({
          name: newItemName.trim(),
          quantity: parseFloat(newItemQuantity) || 1,
          unit: newItemUnit
        })

        if (res.data?.warnings?.length > 0) {
          setDuplicateWarning({
            warning: res.data.warnings[0],
            pantryMatch: res.data.pantryMatch
          })
        } else {
          setDuplicateWarning(null)
        }
      } catch (e) {
        // Silent evaluation error
      } finally {
        setIsEvaluating(false)
      }
    }, 450)

    return () => clearTimeout(timer)
  }, [newItemName, newItemQuantity, newItemUnit])

  // Add Item to list
  const handleAddItem = async (e) => {
    if (e) e.preventDefault()
    if (!newItemName.trim()) return

    const qty = parseFloat(newItemQuantity)
    if (isNaN(qty) || qty <= 0) {
      setError('Quantity must be greater than zero.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const payload = {
        name: newItemName.trim(),
        category: newItemCategory,
        quantity: qty,
        unit: newItemUnit,
        notes: newItemNotes.trim() || null,
        estimatedPrice: newItemPrice ? parseFloat(newItemPrice) : 3.50,
        status: 'needed',
        sourceType: 'manual'
      }

      const res = await api.shoppingList.addItem(payload)
      if (res.error) {
        setError(res.error)
      } else if (res.data) {
        setItems(prev => [res.data, ...prev])
        setNewItemName('')
        setNewItemQuantity('1')
        setNewItemPrice('')
        setNewItemNotes('')
        setDuplicateWarning(null)
        setSuccessMessage(`Added '${res.data.name}' to your shopping list!`)

        // Refresh recommendations to exclude added item
        const recRes = await api.shoppingList.getRecommendations({ replenishment_days: 7 })
        if (recRes.data?.recommendations) {
          setRecommendations(recRes.data.recommendations)
        }
      }
    } catch (err) {
      console.error('Error adding shopping item:', err)
      setError('Unable to add item. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Quick accept recommendation
  const handleAcceptRecommendation = async (rec) => {
    try {
      const payload = {
        name: rec.name,
        category: rec.category,
        quantity: rec.suggested_quantity,
        unit: rec.unit,
        estimatedPrice: rec.estimated_price !== null && rec.estimated_price !== undefined ? Number(rec.estimated_price) : 3.50,
        notes: rec.reason,
        recommendationReason: rec.reason,
        sourceType: 'recommendation',
        status: 'needed'
      }

      const res = await api.shoppingList.addItem(payload)
      if (res.data) {
        setItems(prev => [res.data, ...prev])
        setRecommendations(prev => prev.filter(r => r.id !== rec.id))
        setSuccessMessage(`Added suggested restock for '${rec.name}'!`)
      }
    } catch (err) {
      console.error('Failed to add recommendation:', err)
      setError('Failed to accept recommendation.')
    }
  }

  // Remove Item
  const handleRemove = async (id, name) => {
    try {
      await api.shoppingList.removeItem(id)
      setItems(prev => prev.filter(i => i.id !== id))
      setSuccessMessage(`Removed '${name}' from shopping list.`)
    } catch (err) {
      console.error('Failed to remove item:', err)
      setError('Failed to delete item.')
    }
  }

  // Status Change (needed <-> in_cart)
  const handleStatusChange = async (item, newStatus) => {
    try {
      const res = await api.shoppingList.updateItem(item.id, {
        status: newStatus,
        isCompleted: false
      })

      if (res.data) {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: newStatus, isCompleted: false } : i))
      }
    } catch (err) {
      console.error('Failed to update status:', err)
      setError('Failed to update item status.')
    }
  }

  // Open Edit Modal
  const openEditModal = (item) => {
    setEditingItem(item)
    setEditForm({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit || 'piece',
      category: item.category || 'Produce',
      notes: item.notes || '',
      estimatedPrice: item.estimatedPrice || ''
    })
  }

  // Save Edit Item
  const handleSaveEdit = async (e) => {
    e.preventDefault()
    if (!editingItem) return

    const qty = parseFloat(editForm.quantity)
    if (isNaN(qty) || qty <= 0) {
      setError('Quantity must be greater than zero.')
      return
    }

    try {
      const res = await api.shoppingList.updateItem(editingItem.id, {
        name: editForm.name.trim(),
        quantity: qty,
        unit: editForm.unit,
        category: editForm.category,
        notes: editForm.notes.trim() || null,
        estimatedPrice: editForm.estimatedPrice ? parseFloat(editForm.estimatedPrice) : 3.50
      })

      if (res.data) {
        setItems(prev => prev.map(i => i.id === editingItem.id ? { ...i, ...res.data, isCompleted: Boolean(res.data.is_purchased) } : i))
        setEditingItem(null)
        setSuccessMessage(`Updated '${editForm.name}'.`)
      }
    } catch (err) {
      console.error('Failed to save edits:', err)
      setError('Failed to update item details.')
    }
  }

  // Open Purchase Modal
  const openPurchaseModal = (item) => {
    setPurchasingItem(item)
    setPurchaseForm({
      purchasedQuantity: item.quantity,
      purchasePrice: item.estimatedPrice ? (item.estimatedPrice * item.quantity).toFixed(2) : '',
      storageLocation: 'pantry',
      purchaseDate: new Date().toISOString().split('T')[0],
      expiryDate: ''
    })
  }

  // Confirm Purchase & Update Pantry Inventory
  const handleConfirmPurchase = async (e) => {
    e.preventDefault()
    if (!purchasingItem) return

    const qty = parseFloat(purchaseForm.purchasedQuantity)
    if (isNaN(qty) || qty <= 0) {
      setError('Purchased quantity must be greater than zero.')
      return
    }

    setPurchaseSubmitting(true)
    setError(null)

    try {
      const res = await api.shoppingList.markPurchased(purchasingItem.id, {
        purchasedQuantity: qty,
        purchasePrice: purchaseForm.purchasePrice ? parseFloat(purchaseForm.purchasePrice) : undefined,
        purchaseDate: purchaseForm.purchaseDate,
        expiryDate: purchaseForm.expiryDate || undefined,
        storageLocation: purchaseForm.storageLocation
      })

      if (res.error) {
        setError(res.error)
      } else {
        const result = res.data
        if (result.partial) {
          // Partial purchase: update remaining quantity on active list
          setItems(prev => prev.map(i => i.id === purchasingItem.id ? { ...i, quantity: result.item.quantity } : i))
          setSuccessMessage(`Partially purchased ${qty} ${purchasingItem.unit} of '${purchasingItem.name}'. Stock added to pantry!`)
        } else {
          // Complete purchase: mark purchased
          setItems(prev => prev.map(i => i.id === purchasingItem.id ? { ...i, status: 'purchased', isCompleted: true, purchasedAt: new Date().toISOString() } : i))
          setSuccessMessage(`Purchased '${purchasingItem.name}'! Added ${qty} ${purchasingItem.unit} to your pantry.`)
        }
        setPurchasingItem(null)

        // Reload recommendations & list stock data
        loadData()
      }
    } catch (err) {
      console.error('Purchase failed:', err)
      setError('Failed to complete purchase.')
    } finally {
      setPurchaseSubmitting(false)
    }
  }

  // Metrics computation
  const summaryMetrics = useMemo(() => {
    const totalItems = items.length
    const toBuyItems = items.filter(i => !i.isCompleted && i.status !== 'purchased')
    const inCartItems = items.filter(i => i.status === 'in_cart' && !i.isCompleted)
    const purchasedItems = items.filter(i => i.isCompleted || i.status === 'purchased')

    const potentialDuplicates = items.filter(
      i => !i.isCompleted && i.pantryStock && i.pantryStock.has_stock
    ).length

    const estimatedTotalCost = toBuyItems.reduce((acc, i) => {
      const price = parseFloat(i.estimatedPrice)
      const qty = parseFloat(i.quantity)
      const validPrice = !isNaN(price) && price >= 0 ? price : 3.50
      const validQty = !isNaN(qty) && qty > 0 ? qty : 1
      return acc + (validPrice * validQty)
    }, 0)

    return {
      totalItems,
      toBuyCount: toBuyItems.length,
      inCartCount: inCartItems.length,
      purchasedCount: purchasedItems.length,
      potentialDuplicates,
      estimatedTotalCost
    }
  }, [items])

  // Filtered items list
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // Tab filter
      if (activeTab === 'needed' && (item.isCompleted || item.status !== 'needed')) return false
      if (activeTab === 'cart' && (item.isCompleted || item.status !== 'in_cart')) return false
      if (activeTab === 'purchased' && (!item.isCompleted && item.status !== 'purchased')) return false
      if (activeTab === 'active' && (item.isCompleted || item.status === 'purchased')) return false

      // Category filter
      if (categoryFilter !== 'all') {
        const cat = (item.category || '').toLowerCase()
        if (cat !== categoryFilter.toLowerCase()) return false
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchesName = (item.name || '').toLowerCase().includes(q)
        const matchesNotes = (item.notes || '').toLowerCase().includes(q)
        if (!matchesName && !matchesNotes) return false
      }

      return true
    })
  }, [items, activeTab, categoryFilter, searchQuery])

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">
      {/* 1. Header & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 bg-emerald-100/80 rounded-2xl text-emerald-800 text-xl shadow-xs">
              🛒
            </span>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                Smart Shopping List
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Pantry-aware replenishment intelligence that prevents duplicate overbuying.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            icon={RefreshCw}
            onClick={loadData}
            isLoading={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-rose-900 text-sm animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-emerald-900 text-sm animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Summary Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card padding="p-4 sm:p-5" className="bg-white border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Items
            </span>
            <span className="p-2 bg-slate-100 rounded-xl text-slate-600">
              <ShoppingBag className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {summaryMetrics.totalItems}
            </span>
            <span className="text-xs text-slate-500 font-medium">in list</span>
          </div>
        </Card>

        <Card padding="p-4 sm:p-5" className="bg-white border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Items To Buy
            </span>
            <span className="p-2 bg-emerald-50 rounded-xl text-emerald-700">
              <ShoppingCart className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-emerald-950">
              {summaryMetrics.toBuyCount}
            </span>
            <span className="text-xs text-emerald-800 font-medium">
              ({summaryMetrics.inCartCount} in cart)
            </span>
          </div>
        </Card>

        <Card padding="p-4 sm:p-5" className="bg-white border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              Pantry Duplicates
            </span>
            <span className="p-2 bg-amber-50 rounded-xl text-amber-700">
              <AlertTriangle className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-amber-950">
              {summaryMetrics.potentialDuplicates}
            </span>
            <span className="text-xs text-amber-700 font-medium">items in stock</span>
          </div>
        </Card>

        <Card padding="p-4 sm:p-5" className="bg-emerald-50/70 border-emerald-200/80">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
              Estimated Total Cost
            </span>
            <span className="p-2 bg-emerald-100 rounded-xl text-emerald-800">
              <DollarSign className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl sm:text-3xl font-black text-emerald-950">
              {formatCurrency(summaryMetrics.estimatedTotalCost)}
            </span>
          </div>
        </Card>
      </div>

      {/* 3. Smart Recommendations Carousel / Section */}
      {recommendations.length > 0 && (
        <Card padding="p-5" className="bg-gradient-to-br from-emerald-50/50 via-white to-amber-50/30 border-emerald-200/70">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-emerald-600 text-white rounded-lg">
                <Sparkles className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                  Pantry Intelligence Recommendations
                </h3>
                <p className="text-xs text-slate-500">
                  Calculated from low-stock pantry thresholds and actual past consumption history.
                </p>
              </div>
            </div>
            <Badge variant="brand" size="sm">
              {recommendations.length} Suggestions
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recommendations.map(rec => (
              <div
                key={rec.id}
                className="p-3.5 bg-white rounded-xl border border-emerald-200/60 shadow-2xs hover:border-emerald-400 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-sm text-slate-900">{rec.name}</span>
                    <Badge
                      variant={rec.type === 'consumption_based' ? 'fresh' : 'warning'}
                      size="sm"
                    >
                      {rec.badge}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                    {rec.reason}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <span>Suggests:</span>
                    <span className="font-bold text-slate-900">
                      {rec.suggested_quantity} {rec.unit}
                    </span>
                    <span className="text-slate-300">•</span>
                    <span>Usable: {rec.current_usable_stock} {rec.unit}</span>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-end">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={Plus}
                    onClick={() => handleAcceptRecommendation(rec)}
                  >
                    Add to List
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 4. Manual Add Item Form with Live Duplicate Checking */}
      <Card padding="p-5" className="bg-white border-slate-200">
        <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4 text-emerald-700" />
          Add Item to Shopping List
        </h3>

        <form onSubmit={handleAddItem} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            {/* Item Name */}
            <div className="sm:col-span-4">
              <input
                type="text"
                placeholder="Product name (e.g. Whole Milk, Brown Eggs)..."
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                required
              />
            </div>

            {/* Quantity */}
            <div className="sm:col-span-2">
              <input
                type="number"
                step="any"
                min="0.1"
                placeholder="Qty"
                value={newItemQuantity}
                onChange={(e) => setNewItemQuantity(e.target.value)}
                className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                required
              />
            </div>

            {/* Unit */}
            <div className="sm:col-span-2">
              <select
                value={newItemUnit}
                onChange={(e) => setNewItemUnit(e.target.value)}
                className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-2.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="piece">piece</option>
                <option value="litre">litre</option>
                <option value="ml">ml</option>
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="bottle">bottle</option>
                <option value="pack">pack</option>
                <option value="box">box</option>
                <option value="can">can</option>
                <option value="jar">jar</option>
                <option value="bunch">bunch</option>
              </select>
            </div>

            {/* Category */}
            <div className="sm:col-span-2">
              <select
                value={newItemCategory}
                onChange={(e) => setNewItemCategory(e.target.value)}
                className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-2.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="Produce">Produce</option>
                <option value="Dairy & Eggs">Dairy & Eggs</option>
                <option value="Bakery">Bakery</option>
                <option value="Meat & Seafood">Meat & Seafood</option>
                <option value="Pantry Staples">Pantry Staples</option>
                <option value="Beverages">Beverages</option>
                <option value="Snacks">Snacks</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Est. Price */}
            <div className="sm:col-span-2">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Est. ₹ Price"
                value={newItemPrice}
                onChange={(e) => setNewItemPrice(e.target.value)}
                className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          {/* Notes optional */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <input
              type="text"
              placeholder="Optional notes or brand preference..."
              value={newItemNotes}
              onChange={(e) => setNewItemNotes(e.target.value)}
              className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />

            <Button
              type="submit"
              variant="primary"
              size="md"
              icon={Plus}
              isLoading={submitting}
              className="w-full sm:w-auto shrink-0"
            >
              Add Item
            </Button>
          </div>

          {/* Live Duplicate Warning Banner */}
          {duplicateWarning && (
            <div className="p-3.5 bg-amber-50/90 border border-amber-200 rounded-xl text-amber-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Pantry Availability Warning:</span>
                  <span>{duplicateWarning.warning.message}</span>
                  {duplicateWarning.pantryMatch && (
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-amber-800">
                      <span>In stock: <strong>{duplicateWarning.pantryMatch.existing_quantity} {duplicateWarning.pantryMatch.unit}</strong></span>
                      <span>•</span>
                      <span>Surplus: <strong>{duplicateWarning.pantryMatch.surplus} {duplicateWarning.pantryMatch.unit}</strong></span>
                      {duplicateWarning.pantryMatch.expiry_date && (
                        <>
                          <span>•</span>
                          <span>Expires: {duplicateWarning.pantryMatch.expiry_date}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-amber-700 italic">You can still keep and add this item.</span>
              </div>
            </div>
          )}
        </form>
      </Card>

      {/* 5. Filter Controls & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        {/* Status Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl w-fit overflow-x-auto">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Items ({items.length})
          </button>
          <button
            onClick={() => setActiveTab('needed')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'needed' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Needed ({items.filter(i => !i.isCompleted && i.status === 'needed').length})
          </button>
          <button
            onClick={() => setActiveTab('cart')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'cart' ? 'bg-white text-sky-800 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            In Cart ({summaryMetrics.inCartCount})
          </button>
          <button
            onClick={() => setActiveTab('purchased')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'purchased' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Purchased ({summaryMetrics.purchasedCount})
          </button>
        </div>

        {/* Search & Category Filter */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search shopping list..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            <option value="all">All Categories</option>
            <option value="produce">Produce</option>
            <option value="dairy">Dairy & Eggs</option>
            <option value="bakery">Bakery</option>
            <option value="meat">Meat & Seafood</option>
            <option value="pantry">Pantry Staples</option>
            <option value="beverages">Beverages</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* 6. Shopping List Items List */}
      {loading ? (
        <LoadingSpinner message="Loading shopping list and pantry intelligence..." />
      ) : filteredItems.length === 0 ? (
        <Card padding="p-12" className="text-center bg-white border-slate-200">
          <div className="max-w-md mx-auto space-y-3">
            <span className="p-3 bg-emerald-50 rounded-2xl text-emerald-800 inline-block text-2xl">
              📝
            </span>
            <h3 className="text-base font-bold text-slate-900">
              {searchQuery ? 'No matching grocery items found' : 'Your shopping list is clear!'}
            </h3>
            <p className="text-xs text-slate-500">
              {searchQuery
                ? 'Try adjusting your search query or category filters.'
                : 'Add groceries manually using the quick form above, or check the recommendations carousel for restock alerts.'}
            </p>
          </div>
        </Card>
      ) : (
        <Card padding="p-0" className="overflow-hidden bg-white border-slate-200 shadow-xs">
          <div className="divide-y divide-slate-100">
            {filteredItems.map(item => {
              const isPurchased = Boolean(item.isCompleted || item.status === 'purchased')
              const hasPantryStock = item.pantryStock && item.pantryStock.has_stock

              return (
                <div
                  key={item.id}
                  className={`p-4 transition-colors ${
                    isPurchased ? 'bg-slate-50/60 opacity-60' : 'hover:bg-slate-50/80'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    {/* Item Information */}
                    <div className="flex items-start gap-3 min-w-0">
                      {/* Status Action / Indicator */}
                      <button
                        type="button"
                        onClick={() => {
                          if (isPurchased) {
                            handleStatusChange(item, 'needed')
                          } else if (item.status === 'needed') {
                            handleStatusChange(item, 'in_cart')
                          } else {
                            handleStatusChange(item, 'needed')
                          }
                        }}
                        className="mt-0.5 shrink-0 cursor-pointer text-slate-400 hover:text-emerald-700 transition-colors"
                        title={isPurchased ? 'Mark as needed' : item.status === 'in_cart' ? 'Move to Needed' : 'Move to In Cart'}
                      >
                        {isPurchased ? (
                          <CheckCircle className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                        ) : item.status === 'in_cart' ? (
                          <div className="w-5 h-5 rounded-full border-2 border-sky-600 bg-sky-50 flex items-center justify-center text-[10px] font-bold text-sky-800">
                            🛒
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-slate-300 hover:border-emerald-600" />
                        )}
                      </button>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm font-bold text-slate-900 ${isPurchased ? 'line-through text-slate-500' : ''}`}>
                            {item.name}
                          </span>

                          <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md">
                            {item.quantity} {item.unit}
                          </span>

                          <span className="text-[11px] text-slate-400">
                            ({item.category})
                          </span>

                          {/* Status Badge */}
                          <Badge
                            variant={
                              isPurchased ? 'fresh' : item.status === 'in_cart' ? 'info' : 'neutral'
                            }
                            size="sm"
                          >
                            {isPurchased ? 'Purchased' : item.status === 'in_cart' ? 'In Cart' : 'Needed'}
                          </Badge>

                          {/* Auto-Suggested Badge */}
                          {item.isAutoSuggested && (
                            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                              <Sparkles className="w-3 h-3 text-emerald-600" /> Auto-Restock
                            </span>
                          )}
                        </div>

                        {/* Recommendation reason if available */}
                        {item.recommendationReason && (
                          <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                            <Info className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{item.recommendationReason}</span>
                          </p>
                        )}

                        {/* Notes if available */}
                        {item.notes && !item.recommendationReason && (
                          <p className="text-[11px] text-slate-500 mt-1">
                            {item.notes}
                          </p>
                        )}

                        {/* Pantry Duplicate Alert Badge */}
                        {!isPurchased && hasPantryStock && (
                          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-900 border border-amber-200/80 rounded-lg text-[11px]">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>
                              You already have <strong>{item.pantryStock.available_quantity} {item.pantryStock.unit}</strong> in your pantry
                              {item.pantryStock.closest_expiry ? ` (expires ${item.pantryStock.closest_expiry})` : ''}.
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions and Cost */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-slate-100">
                      <div className="text-right">
                        <span className="text-xs font-bold text-slate-900 block">
                          {formatCurrency((parseFloat(item.estimatedPrice) || 0) * (parseFloat(item.quantity) || 0))}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {formatCurrency(parseFloat(item.estimatedPrice) || 0)}/{item.unit || 'unit'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Edit details */}
                        {!isPurchased && (
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
                            title="Edit Item Details"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}

                        {/* Mark Purchased Button */}
                        {!isPurchased && (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={PackageCheck}
                            onClick={() => openPurchaseModal(item)}
                          >
                            Buy
                          </Button>
                        )}

                        {/* Remove Button */}
                        <button
                          type="button"
                          onClick={() => handleRemove(item.id, item.name)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                          title="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* 7. Edit Item Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Edit Shopping List Item</h3>
              <button onClick={() => setEditingItem(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Item Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3.5 py-2 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Quantity</label>
                  <input
                    type="number"
                    step="any"
                    min="0.1"
                    value={editForm.quantity}
                    onChange={(e) => setEditForm(prev => ({ ...prev, quantity: e.target.value }))}
                    className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Unit</label>
                  <select
                    value={editForm.unit}
                    onChange={(e) => setEditForm(prev => ({ ...prev, unit: e.target.value }))}
                    className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    <option value="piece">piece</option>
                    <option value="litre">litre</option>
                    <option value="ml">ml</option>
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="bottle">bottle</option>
                    <option value="pack">pack</option>
                    <option value="box">box</option>
                    <option value="can">can</option>
                    <option value="jar">jar</option>
                    <option value="bunch">bunch</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Category</label>
                  <select
                    value={editForm.category}
                    onChange={(e) => setEditForm(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    <option value="Produce">Produce</option>
                    <option value="Dairy & Eggs">Dairy & Eggs</option>
                    <option value="Bakery">Bakery</option>
                    <option value="Meat & Seafood">Meat & Seafood</option>
                    <option value="Pantry Staples">Pantry Staples</option>
                    <option value="Beverages">Beverages</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Est. Unit Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.estimatedPrice}
                    onChange={(e) => setEditForm(prev => ({ ...prev, estimatedPrice: e.target.value }))}
                    className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Notes</label>
                <textarea
                  rows="2"
                  value={editForm.notes}
                  onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  placeholder="Additional details..."
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <Button variant="outline" size="md" onClick={() => setEditingItem(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="md">
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8. Purchase & Add to Pantry Modal */}
      {purchasingItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="p-2 bg-emerald-100 rounded-xl text-emerald-800">
                  <PackageCheck className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Record Purchase & Add to Pantry</h3>
                  <p className="text-xs text-slate-500">Adding to real household inventory</p>
                </div>
              </div>
              <button onClick={() => setPurchasingItem(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmPurchase} className="mt-4 space-y-4">
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
                <span className="text-xs text-slate-500 block">Item to Purchase:</span>
                <span className="text-sm font-bold text-slate-900">
                  {purchasingItem.name} ({purchasingItem.quantity} {purchasingItem.unit} requested)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Purchased Quantity ({purchasingItem.unit})
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.1"
                    max={purchasingItem.quantity * 5}
                    value={purchaseForm.purchasedQuantity}
                    onChange={(e) => setPurchaseForm(prev => ({ ...prev, purchasedQuantity: e.target.value }))}
                    className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    required
                  />
                  {parseFloat(purchaseForm.purchasedQuantity) < purchasingItem.quantity && (
                    <span className="text-[10px] text-amber-700 font-medium mt-1 block">
                      Partial purchase: {(purchasingItem.quantity - parseFloat(purchaseForm.purchasedQuantity)).toFixed(2)} will stay on list.
                    </span>
                  )}
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Total Paid (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 120"
                    value={purchaseForm.purchasePrice}
                    onChange={(e) => setPurchaseForm(prev => ({ ...prev, purchasePrice: e.target.value }))}
                    className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Storage Location</label>
                  <select
                    value={purchaseForm.storageLocation}
                    onChange={(e) => setPurchaseForm(prev => ({ ...prev, storageLocation: e.target.value }))}
                    className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    <option value="pantry">Pantry</option>
                    <option value="refrigerator">Refrigerator</option>
                    <option value="freezer">Freezer</option>
                    <option value="counter">Counter</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Purchase Date</label>
                  <input
                    type="date"
                    value={purchaseForm.purchaseDate}
                    onChange={(e) => setPurchaseForm(prev => ({ ...prev, purchaseDate: e.target.value }))}
                    className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Estimated Expiry Date (Optional)
                </label>
                <input
                  type="date"
                  value={purchaseForm.expiryDate}
                  onChange={(e) => setPurchaseForm(prev => ({ ...prev, expiryDate: e.target.value }))}
                  className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <Button variant="outline" size="md" onClick={() => setPurchasingItem(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  icon={CheckCircle}
                  isLoading={purchaseSubmitting}
                >
                  Confirm & Add to Pantry
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default ShoppingListPage
