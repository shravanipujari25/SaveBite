import React, { useState, useEffect } from 'react'
import { api } from '../api/client'
import Card from '../components/common/Card'
import Button from '../components/common/Button'
import Input from '../components/common/Input'
import Badge from '../components/common/Badge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import { ShoppingBag, Plus, Trash2, CheckCircle, Sparkles } from 'lucide-react'
import { formatCurrency } from '../utils/formatters'

export function ShoppingListPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [newItemName, setNewItemName] = useState('')
  const [newItemCategory, setNewItemCategory] = useState('Produce')
  const [newItemPrice, setNewItemPrice] = useState('')

  useEffect(() => {
    async function loadList() {
      try {
        const { data } = await api.shoppingList.getAll()
        if (data) setItems(data)
      } catch (err) {
        console.error('Failed to load shopping list:', err)
      } finally {
        setLoading(false)
      }
    }
    loadList()
  }, [])

  const handleToggle = async (id) => {
    try {
      const { data } = await api.shoppingList.toggleItem(id)
      if (data) setItems(data)
    } catch (err) {
      console.error('Failed to toggle item:', err)
    }
  }

  const handleAddItem = async (e) => {
    e.preventDefault()
    if (!newItemName.trim()) return

    try {
      const newItem = {
        name: newItemName.trim(),
        category: newItemCategory,
        quantity: 1,
        unit: 'pack',
        estimatedPrice: newItemPrice ? parseFloat(newItemPrice) : 3.5,
        suggestedReason: 'Manually added by user',
      }
      const { data } = await api.shoppingList.addItem(newItem)
      if (data) {
        setItems((prev) => [data, ...prev])
        setNewItemName('')
        setNewItemPrice('')
      }
    } catch (err) {
      console.error('Failed to add shopping item:', err)
    }
  }

  const handleRemove = async (id) => {
    try {
      await api.shoppingList.removeItem(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
    } catch (err) {
      console.error('Failed to remove item:', err)
    }
  }

  const totalCost = items
    .filter((i) => !i.isCompleted)
    .reduce((sum, item) => sum + (item.estimatedPrice || 0), 0)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🛒</span>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Smart Replenishment List
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Auto-generated suggestions based on expiring groceries and household staples.
          </p>
        </div>

        <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200/80 text-right">
          <span className="text-[10px] uppercase font-bold text-emerald-800 tracking-wider block">
            Est. Basket Total
          </span>
          <span className="text-lg font-black text-emerald-950">{formatCurrency(totalCost)}</span>
        </div>
      </div>

      {/* Quick Add Form */}
      <Card padding="p-4">
        <form onSubmit={handleAddItem} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <input
              type="text"
              placeholder="Add item to shopping list (e.g. Oat Milk, Tomatoes)..."
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div className="w-full sm:w-36">
            <select
              value={newItemCategory}
              onChange={(e) => setNewItemCategory(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="Produce">Produce</option>
              <option value="Dairy & Eggs">Dairy & Eggs</option>
              <option value="Bakery">Bakery</option>
              <option value="Meat & Seafood">Meat & Seafood</option>
              <option value="Pantry Staples">Pantry</option>
            </select>
          </div>

          <div className="w-full sm:w-28">
            <input
              type="number"
              step="0.01"
              placeholder="Est. ₹"
              value={newItemPrice}
              onChange={(e) => setNewItemPrice(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <Button type="submit" variant="primary" size="md" icon={Plus} className="w-full sm:w-auto">
            Add
          </Button>
        </form>
      </Card>

      {/* Shopping List Items */}
      {loading ? (
        <LoadingSpinner message="Loading shopping list..." />
      ) : (
        <Card>
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => handleToggle(item.id)}
                className={`p-3.5 flex items-center justify-between gap-3 transition-colors cursor-pointer hover:bg-slate-50 ${
                  item.isCompleted ? 'opacity-50 line-through bg-slate-50/50' : ''
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={item.isCompleted}
                    onChange={() => handleToggle(item.id)}
                    className="w-4 h-4 rounded text-emerald-700 focus:ring-emerald-600 cursor-pointer"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{item.name}</span>
                      {item.isAutoSuggested && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                          <Sparkles className="w-3 h-3 text-emerald-600" /> Auto-Restock
                        </span>
                      )}
                    </div>
                    {item.suggestedReason && (
                      <p className="text-[11px] text-slate-500 mt-0.5">{item.suggestedReason}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs font-bold text-slate-800">
                    {formatCurrency(item.estimatedPrice)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemove(item.id)
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

export default ShoppingListPage
