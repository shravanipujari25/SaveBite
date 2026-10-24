import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePantry } from '../context/PantryContext'
import { api } from '../api/client'
import Card from '../components/common/Card'
import Input from '../components/common/Input'
import Button from '../components/common/Button'
import {
  PlusCircle,
  ArrowLeft,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Barcode,
  UploadCloud,
  FileText,
  Search,
  Sparkles
} from 'lucide-react'

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

  const [activeTab, setActiveTab] = useState('manual') // 'manual' | 'barcode' | 'receipt'
  const [formData, setFormData] = useState(initialFormState)
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // Barcode Lookup state
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeLoading, setBarcodeLoading] = useState(false)
  const [barcodeResult, setBarcodeResult] = useState(null)
  const [barcodeError, setBarcodeError] = useState('')

  // Receipt Upload state
  const [receiptFile, setReceiptFile] = useState(null)
  const [receiptUploading, setReceiptUploading] = useState(false)
  const [receiptResult, setReceiptResult] = useState(null)
  const [receiptError, setReceiptError] = useState('')

  // Quick preset helper
  const addDaysToToday = (days) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  // Comprehensive field validation
  const validate = () => {
    const errs = {}

    if (!formData.name.trim()) {
      errs.name = 'Product name is required'
    } else if (formData.name.trim().length < 2) {
      errs.name = 'Product name must be at least 2 characters'
    }

    if (!formData.category) {
      errs.category = 'Please select a category'
    }

    const qty = Number(formData.quantity)
    if (!formData.quantity || isNaN(qty)) {
      errs.quantity = 'Quantity must be a valid number'
    } else if (qty <= 0) {
      errs.quantity = 'Quantity must be greater than 0'
    }

    if (!formData.unit) {
      errs.unit = 'Unit is required'
    }

    if (formData.estimatedCost !== '') {
      const price = Number(formData.estimatedCost)
      if (isNaN(price)) {
        errs.estimatedCost = 'Price must be a valid number'
      } else if (price < 0) {
        errs.estimatedCost = 'Price cannot be negative'
      }
    }

    const today = getTodayString()
    if (!formData.purchaseDate) {
      errs.purchaseDate = 'Purchase date is required'
    } else if (formData.purchaseDate > today) {
      errs.purchaseDate = 'Purchase date cannot be in the future'
    }

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

  // Handle Barcode lookup
  const handleBarcodeSearch = async (e) => {
    if (e) e.preventDefault()
    if (!barcodeInput.trim()) return

    setBarcodeLoading(true)
    setBarcodeError('')
    setBarcodeResult(null)

    try {
      const res = await api.barcodes.lookup(barcodeInput.trim())
      if (res.error) {
        setBarcodeError(res.error)
      } else {
        const prod = res.data?.product || res.data
        setBarcodeResult(prod)
      }
    } catch (err) {
      setBarcodeError(err.message || 'Error communicating with barcode service')
    } finally {
      setBarcodeLoading(false)
    }
  }

  const handleUseBarcodeProduct = (product) => {
    setFormData((prev) => ({
      ...prev,
      name: product.name || prev.name,
      category: 'Pantry Staples',
      expiryDate: addDaysToToday(14),
      estimatedCost: '4.50',
      imageEmoji: '🥫',
      notes: `Looked up via Barcode: ${product.barcode} (${product.brand || 'Open Food Facts'})`,
    }))
    setActiveTab('manual')
    setSuccessMessage(`Pre-filled manual entry with "${product.name}"! Verify dates and click Save.`)
  }

  // Handle Receipt Upload
  const handleReceiptUpload = async (e) => {
    e.preventDefault()
    if (!receiptFile) return

    setReceiptUploading(true)
    setReceiptError('')
    setReceiptResult(null)

    try {
      const res = await api.receipts.upload(receiptFile)
      if (res.error) {
        setReceiptError(res.error)
      } else {
        const receipt = res.data?.receipt || res.data
        setReceiptResult(receipt)

        // Attempt parse
        if (receipt.id) {
          const parseRes = await api.receipts.parse(receipt.id)
          if (parseRes.error) {
            setReceiptError(`Receipt uploaded successfully, but OCR parsing failed: ${parseRes.error}`)
          } else {
            setReceiptResult((prev) => ({ ...prev, parsed: parseRes.data }))
          }
        }
      }
    } catch (err) {
      setReceiptError(err.message || 'Failed to process receipt')
    } finally {
      setReceiptUploading(false)
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
              Manual entry, live Open Food Facts barcode lookup, or receipt document upload.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('manual')}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'manual'
              ? 'bg-emerald-900 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
          }`}
        >
          <PlusCircle className="w-4 h-4" />
          <span>Manual Entry</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('barcode')}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'barcode'
              ? 'bg-emerald-900 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
          }`}
        >
          <Barcode className="w-4 h-4" />
          <span>Barcode Lookup</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('receipt')}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'receipt'
              ? 'bg-emerald-900 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
          }`}
        >
          <UploadCloud className="w-4 h-4" />
          <span>Receipt Upload</span>
        </button>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-900 font-bold animate-in fade-in">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* TAB 1: MANUAL ENTRY */}
      {activeTab === 'manual' && (
        <>
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

              {/* Quantity, Unit & Purchase Price */}
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
        </>
      )}

      {/* TAB 2: BARCODE LOOKUP */}
      {activeTab === 'barcode' && (
        <Card padding="p-6" className="space-y-5">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Open Food Facts Barcode Scanner & Lookup
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Look up global food products by their EAN-13, UPC-A, or GTIN barcode through verified Open Food Facts integration.
            </p>
          </div>

          <form onSubmit={handleBarcodeSearch} className="flex gap-2">
            <input
              type="text"
              placeholder="Enter Barcode (e.g. 3017620422003 for Nutella)..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              icon={Search}
              isLoading={barcodeLoading}
            >
              Lookup
            </Button>
          </form>

          {/* Quick preset chips */}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Try sample barcodes:</span>
            <button
              type="button"
              onClick={() => {
                setBarcodeInput('3017620422003')
              }}
              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 font-mono text-[11px] cursor-pointer"
            >
              3017620422003 (Nutella)
            </button>
            <button
              type="button"
              onClick={() => {
                setBarcodeInput('5449000000996')
              }}
              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 font-mono text-[11px] cursor-pointer"
            >
              5449000000996 (Coca-Cola)
            </button>
          </div>

          {barcodeError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2.5 text-xs text-rose-800 font-medium">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{barcodeError}</span>
            </div>
          )}

          {barcodeResult && (
            <div className="p-4 bg-emerald-50/50 border border-emerald-200 rounded-2xl space-y-3">
              <div className="flex items-start gap-4">
                {barcodeResult.image_url ? (
                  <img
                    src={barcodeResult.image_url}
                    alt={barcodeResult.name}
                    className="w-16 h-16 object-cover rounded-xl border border-emerald-200 shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 bg-emerald-100 rounded-xl flex items-center justify-center text-2xl shrink-0">
                    🥫
                  </div>
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                      Verified Product
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      #{barcodeResult.barcode}
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-base">{barcodeResult.name}</h4>
                  <p className="text-xs text-slate-600">
                    {barcodeResult.brand ? `Brand: ${barcodeResult.brand}` : ''} &bull;{' '}
                    {barcodeResult.quantity ? `Size: ${barcodeResult.quantity}` : ''}
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-emerald-200/60 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Data source: {barcodeResult.attribution || 'Open Food Facts'}
                </span>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  icon={PlusCircle}
                  onClick={() => handleUseBarcodeProduct(barcodeResult)}
                >
                  Use Product to Pre-fill Entry
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* TAB 3: RECEIPT UPLOAD */}
      {activeTab === 'receipt' && (
        <Card padding="p-6" className="space-y-5">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Receipt Document Ingestion
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Upload a supermarket paper receipt (JPEG, PNG, WebP, PDF) to automatically extract grocery line items into your household inventory.
            </p>
          </div>

          <form onSubmit={handleReceiptUpload} className="space-y-4">
            <div className="border-2 border-dashed border-slate-200 hover:border-emerald-600 transition-colors rounded-2xl p-6 text-center cursor-pointer">
              <input
                type="file"
                id="receiptFileInput"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              <label htmlFor="receiptFileInput" className="cursor-pointer space-y-2 block">
                <FileText className="w-10 h-10 text-emerald-800 mx-auto" />
                <div className="text-xs font-semibold text-slate-700">
                  {receiptFile ? (
                    <span className="text-emerald-800 font-bold">{receiptFile.name}</span>
                  ) : (
                    <span>Click to browse or drag receipt file here</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">Supported formats: JPG, PNG, WebP, PDF (max 10MB)</p>
              </label>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="md"
                icon={UploadCloud}
                disabled={!receiptFile || receiptUploading}
                isLoading={receiptUploading}
              >
                Upload & Process Receipt
              </Button>
            </div>
          </form>

          {receiptError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2.5 text-xs text-rose-800 font-medium">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{receiptError}</span>
            </div>
          )}

          {receiptResult && (
            <div className="p-4 bg-emerald-50/50 border border-emerald-200 rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-900">Receipt Registered</span>
                <span className="text-[10px] font-mono text-slate-500">ID: {receiptResult.id}</span>
              </div>
              <p className="text-xs text-slate-600">
                Status: <span className="font-semibold text-emerald-800">{receiptResult.status}</span>.
                File: {receiptResult.file_name} ({Math.round((receiptResult.file_size_bytes || 0) / 1024)} KB)
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

export default AddGroceryPage
