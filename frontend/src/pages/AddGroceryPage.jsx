import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePantry } from '../context/PantryContext'
import Card from '../components/common/Card'
import Input from '../components/common/Input'
import Button from '../components/common/Button'
import { PlusCircle, ArrowLeft, RotateCcw, CheckCircle, AlertCircle } from 'lucide-react'

const categories = [
  'Produce',
  'Dairy & Eggs',
  'Bakery',
  'Meat & Seafood',
  'Pantry Staples',
  'Beverages',
  'Snacks',
  'Frozen Foods',
]

const emojis = ['🥑', '🥛', '🥬', '🍞', '🥚', '🍗', '🧀', '🍓', '🥕', '🍎', '🥣', '🫒', '🥩', '☕', '🍇', '🌽']

const getTodayString = () => new Date().toISOString().split('T')[0]

const initialFormState = {
  name: '',
  category: 'Produce',
  quantity: '1',
  unit: 'pcs',
  location: 'fridge',
  storageZone: '',
  purchaseDate: getTodayString(),
  expiryDate: '',
  estimatedCost: '',
  imageEmoji: '🥑',
  notes: '',
}

export function AddGroceryPage() {
  const navigate = useNavigate()
  const { addItem } = usePantry()

  const [formData, setFormData] = useState(initialFormState)
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // Quick preset helper
  const addDaysToToday = (days) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  // Comprehensive field validation
  const validate = () => {
    const errs = {}

    // Product name
    if (!formData.name.trim()) {
      errs.name = 'Product name is required'
    } else if (formData.name.trim().length < 2) {
      errs.name = 'Product name must be at least 2 characters'
    }

    // Category
    if (!formData.category) {
      errs.category = 'Please select a category'
    }

    // Quantity validation (positive number > 0)
    const qty = Number(formData.quantity)
    if (!formData.quantity || isNaN(qty)) {
      errs.quantity = 'Quantity must be a valid number'
    } else if (qty <= 0) {
      errs.quantity = 'Quantity must be greater than 0'
    }

    // Unit
    if (!formData.unit) {
      errs.unit = 'Unit is required'
    }

    // Estimated Price (numeric, reject negative)
    if (formData.estimatedCost !== '') {
      const price = Number(formData.estimatedCost)
      if (isNaN(price)) {
        errs.estimatedCost = 'Price must be a valid number'
      } else if (price < 0) {
        errs.estimatedCost = 'Price cannot be negative'
      }
    }

    // Purchase Date (cannot be in the future)
    const today = getTodayString()
    if (!formData.purchaseDate) {
      errs.purchaseDate = 'Purchase date is required'
    } else if (formData.purchaseDate > today) {
      errs.purchaseDate = 'Purchase date cannot be in the future'
    }

    // Expiry Date (must be >= purchase date)
    if (!formData.expiryDate) {
      errs.expiryDate = 'Expiration or best-before date is required'
    } else if (formData.purchaseDate && formData.expiryDate < formData.purchaseDate) {
      errs.expiryDate = 'Expiration date cannot precede purchase date'
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }))
    }
  }

  const handleReset = () => {
    if (window.confirm('Reset form fields to blank defaults?')) {
      setFormData(initialFormState)
      setErrors({})
      setSuccessMessage('')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSuccessMessage('')

    if (!validate()) return

    setIsSubmitting(true)
    try {
      await addItem({
        name: formData.name.trim(),
        category: formData.category,
        quantity: Number(formData.quantity),
        unit: formData.unit,
        location: formData.location,
        storageZone: formData.storageZone.trim() || undefined,
        purchaseDate: formData.purchaseDate,
        expiryDate: formData.expiryDate,
        estimatedCost: formData.estimatedCost !== '' ? parseFloat(formData.estimatedCost) : 0,
        imageEmoji: formData.imageEmoji,
        notes: formData.notes.trim() || undefined,
      })

      setSuccessMessage(`Successfully added "${formData.name}" to inventory!`)
      setTimeout(() => {
        navigate('/pantry')
      }, 700)
    } catch (err) {
      setErrors({ form: err.message || 'Failed to save grocery item' })
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back button & Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/pantry')}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Back to pantry"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Log Groceries to Inventory
            </h2>
            <p className="text-xs text-slate-500">
              Manual entry with storage climate zones, expiry validation, and INR tracking.
            </p>
          </div>
        </div>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-900 font-bold animate-in fade-in">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Form Error Banner */}
      {errors.form && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2.5 text-xs text-rose-800 font-medium animate-in fade-in">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>{errors.form}</span>
        </div>
      )}

      <Card padding="p-6">
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* Emoji / Visual Marker Picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Item Visual Icon
            </label>
            <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
              {emojis.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => handleChange('imageEmoji', em)}
                  className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all cursor-pointer ${
                    formData.imageEmoji === em
                      ? 'bg-emerald-100 border-2 border-emerald-600 scale-105 shadow-xs'
                      : 'bg-slate-50 border border-slate-200 hover:bg-slate-100'
                  }`}
                  aria-label={`Select icon ${em}`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          {/* Name & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Grocery Item Name"
              required
              placeholder="e.g. Organic Whole Milk, Sourdough"
              value={formData.name}
              error={errors.name}
              onChange={(e) => handleChange('name', e.target.value)}
            />

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Category <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.category}
                onChange={(e) => handleChange('category', e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {errors.category && (
                <p className="mt-1.5 text-xs text-rose-600 font-medium">{errors.category}</p>
              )}
            </div>
          </div>

          {/* Quantity, Unit & Purchase Price (INR) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Quantity"
              type="number"
              min="0.01"
              step="any"
              required
              value={formData.quantity}
              error={errors.quantity}
              onChange={(e) => handleChange('quantity', e.target.value)}
            />

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Unit <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.unit}
                onChange={(e) => handleChange('unit', e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="pcs">pieces (pcs)</option>
                <option value="g">grams (g)</option>
                <option value="kg">kilograms (kg)</option>
                <option value="liter">liters (L)</option>
                <option value="ml">milliliters (ml)</option>
                <option value="pack">pack</option>
                <option value="loaf">loaf</option>
                <option value="tubs">tubs</option>
                <option value="eggs">eggs</option>
                <option value="bunch">bunch</option>
              </select>
            </div>

            <Input
              label="Price / Value (₹ INR)"
              type="number"
              min="0"
              step="any"
              placeholder="e.g. 65.00"
              value={formData.estimatedCost}
              error={errors.estimatedCost}
              onChange={(e) => handleChange('estimatedCost', e.target.value)}
            />
          </div>

          {/* Storage Climate Zone & Sub-Zone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Storage Climate Zone <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'fridge', label: 'Fridge ❄️' },
                  { id: 'pantry', label: 'Pantry 🥫' },
                  { id: 'freezer', label: 'Freezer 🧊' },
                ].map((loc) => (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => handleChange('location', loc.id)}
                    className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      formData.location === loc.id
                        ? 'bg-emerald-800 text-white border-emerald-800 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {loc.label}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label="Shelf / Sub-Zone (Optional)"
              placeholder="e.g. Crisper Left, Door Shelf, Top Rack"
              value={formData.storageZone}
              onChange={(e) => handleChange('storageZone', e.target.value)}
            />
          </div>

          {/* Purchase Date & Expiration Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Purchase Date"
              type="date"
              required
              max={getTodayString()}
              value={formData.purchaseDate}
              error={errors.purchaseDate}
              onChange={(e) => handleChange('purchaseDate', e.target.value)}
            />

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Expiry / Best Before <span className="text-rose-500">*</span>
                </label>
                <div className="flex items-center gap-1 text-[10px] text-slate-500">
                  <span>Quick presets:</span>
                  <button
                    type="button"
                    onClick={() => handleChange('expiryDate', addDaysToToday(2))}
                    className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                  >
                    +2d
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChange('expiryDate', addDaysToToday(5))}
                    className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                  >
                    +5d
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChange('expiryDate', addDaysToToday(14))}
                    className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                  >
                    +2w
                  </button>
                </div>
              </div>
              <Input
                type="date"
                required
                min={formData.purchaseDate || getTodayString()}
                value={formData.expiryDate}
                error={errors.expiryDate}
                onChange={(e) => handleChange('expiryDate', e.target.value)}
              />
            </div>
          </div>

          {/* Optional Storage Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Storage Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="e.g. Keep sealed in airtight container / store away from onions"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          {/* Actions: Save, Cancel, Reset */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              onClick={handleReset}
              disabled={isSubmitting}
            >
              Reset Form
            </Button>

            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => navigate('/pantry')}
                disabled={isSubmitting}
              >
                Cancel
              </Button>

              <Button
                type="submit"
                variant="primary"
                size="md"
                icon={PlusCircle}
                isLoading={isSubmitting}
              >
                Save Grocery Item
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  )
}

export default AddGroceryPage
