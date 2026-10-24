import React, { useState } from 'react'
import Modal from '../common/Modal'
import Button from '../common/Button'
import Input from '../common/Input'
import { Check, Trash2, PackageOpen, AlertTriangle } from 'lucide-react'
import { formatCurrency } from '../../utils/formatters'

export function ItemActionModal({
  isOpen,
  onClose,
  item,
  actionType, // 'consume' | 'waste' | 'open'
  onConfirm,
}) {
  if (!item || !actionType) return null

  const [quantity, setQuantity] = useState(item.quantity)
  const [reason, setReason] = useState('Past Expiry')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const unitPrice = item.estimatedCost ? item.estimatedCost / (item.quantity || 1) : 0
  const calculatedValue = (unitPrice * (Number(quantity) || 0)).toFixed(2)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const qty = Number(quantity)
    if (actionType !== 'open') {
      if (!qty || qty <= 0) {
        setError('Please enter a valid quantity greater than 0')
        return
      }
      if (qty > item.quantity) {
        setError(`Quantity cannot exceed current pantry stock (${item.quantity} ${item.unit})`)
        return
      }
    }

    setIsSubmitting(true)
    try {
      if (actionType === 'consume') {
        await onConfirm(item.id, qty, notes)
      } else if (actionType === 'waste') {
        await onConfirm(item.id, qty, reason, notes)
      } else if (actionType === 'open') {
        await onConfirm(item.id)
      }
      onClose()
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getTitle = () => {
    if (actionType === 'consume') return `Consume ${item.name}`
    if (actionType === 'waste') return `Log Waste: ${item.name}`
    return `Open Package: ${item.name}`
  }

  const getSubtitle = () => {
    if (actionType === 'consume') return 'Record groceries used to prevent food waste'
    if (actionType === 'waste') return 'Track unavoidable spoilage to adjust future shopping'
    return 'Track package opening date to update shelf life'
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={getTitle()} subtitle={getSubtitle()}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
            {error}
          </div>
        )}

        {/* Item Mini Card */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{item.imageEmoji || '🥦'}</span>
            <div>
              <p className="text-xs font-bold text-slate-900">{item.name}</p>
              <p className="text-[11px] text-slate-500">
                Current stock: {item.quantity} {item.unit} &bull; {item.location}
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-slate-800">
            {formatCurrency(item.estimatedCost)}
          </span>
        </div>

        {/* Quantity Selection for Consume & Waste */}
        {actionType !== 'open' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={`Quantity (${item.unit})`}
                type="number"
                step="any"
                min="0.01"
                max={item.quantity}
                value={quantity}
                required
                onChange={(e) => setQuantity(e.target.value)}
              />

              <div className="flex flex-col justify-end pb-1">
                <button
                  type="button"
                  onClick={() => setQuantity(item.quantity)}
                  className="text-xs text-emerald-800 hover:text-emerald-950 font-bold underline cursor-pointer text-left py-2"
                >
                  Use entire stock ({item.quantity} {item.unit})
                </button>
              </div>
            </div>

            {/* Financial Impact preview in INR */}
            <div className="p-2.5 rounded-xl bg-cream-100 border border-[#edebe4] flex justify-between items-center text-xs">
              <span className="text-slate-600 font-medium">
                {actionType === 'consume' ? 'Pantry Value Rescued:' : 'Financial Loss:'}
              </span>
              <span
                className={`font-black text-sm ${
                  actionType === 'consume' ? 'text-emerald-800' : 'text-rose-600'
                }`}
              >
                {formatCurrency(calculatedValue)}
              </span>
            </div>
          </div>
        )}

        {/* Waste Reason Dropdown */}
        {actionType === 'waste' && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Reason for Waste
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="Past Expiration Date">Past Expiration Date</option>
              <option value="Mold / Visible Spoilage">Mold / Visible Spoilage</option>
              <option value="Off Smell / Sour">Off Smell / Sour</option>
              <option value="Left Out of Refrigerator">Left Out of Refrigerator</option>
              <option value="Freezer Burn">Freezer Burn</option>
              <option value="Taste / Texture Degraded">Taste / Texture Degraded</option>
              <option value="Other">Other</option>
            </select>
          </div>
        )}

        {/* Open Package confirmation message */}
        {actionType === 'open' && (
          <div className="p-3.5 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-900 space-y-1">
            <span className="font-bold block flex items-center gap-1.5">
              <PackageOpen className="w-4 h-4 text-amber-600" /> Package Will Be Flagged As Opened
            </span>
            <p className="text-[11px] leading-relaxed">
              Marking this item as opened records today's timestamp and moves it to the "Use First" priority queue on your dashboard.
            </p>
          </div>
        )}

        {/* Optional Notes */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Activity Notes (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. Used for breakfast / discovered in back of drawer"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>

        {/* Actions */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>

          {actionType === 'consume' && (
            <Button
              type="submit"
              variant="primary"
              size="sm"
              icon={Check}
              isLoading={isSubmitting}
              className="bg-emerald-700 hover:bg-emerald-800"
            >
              Confirm Consumed
            </Button>
          )}

          {actionType === 'waste' && (
            <Button
              type="submit"
              variant="danger"
              size="sm"
              icon={Trash2}
              isLoading={isSubmitting}
            >
              Record Waste
            </Button>
          )}

          {actionType === 'open' && (
            <Button
              type="submit"
              variant="primary"
              size="sm"
              icon={PackageOpen}
              isLoading={isSubmitting}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Confirm Opened
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

export default ItemActionModal
