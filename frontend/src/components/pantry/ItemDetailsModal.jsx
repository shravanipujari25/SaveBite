import React from 'react'
import Modal from '../common/Modal'
import Button from '../common/Button'
import Badge from '../common/Badge'
import {
  Calendar,
  MapPin,
  Tag,
  Barcode,
  PackageOpen,
  Check,
  Trash2,
  AlertCircle,
  FileText,
} from 'lucide-react'
import { formatDate, formatCurrency } from '../../utils/formatters'
import { getFreshnessStyle } from '../../utils/freshness'

export function ItemDetailsModal({
  isOpen,
  onClose,
  item,
  onTriggerAction,
  onDelete,
}) {
  if (!item) return null

  const days = item.daysRemaining
  const badgeVariant =
    item.status === 'critical'
      ? 'critical'
      : item.status === 'use_soon'
      ? 'warning'
      : item.status === 'expired'
      ? 'neutral'
      : 'fresh'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={item.name}
      subtitle={`${item.category} • ${item.quantity} ${item.unit}`}
      maxWidth="max-w-xl"
    >
      <div className="space-y-5">
        {/* Top Header Card */}
        <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
          <div className="flex items-center gap-3">
            <span className="text-4xl">{item.imageEmoji || '🥦'}</span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">{item.name}</h3>
                <Badge variant={badgeVariant} dot size="sm">
                  {days <= 0 ? 'Expiring Today' : `${days}d left`}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {item.quantity} {item.unit} &bull; {item.location} ({item.storageZone || 'Shelf'})
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">
              Estimated Value
            </span>
            <span className="text-base font-black text-emerald-800">
              {formatCurrency(item.estimatedCost)}
            </span>
          </div>
        </div>

        {/* Priority Reason Alert Banner */}
        {item.priorityReason && (
          <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Prioritization Assessment:</span>
              <p className="text-[11px] mt-0.5">{item.priorityReason}</p>
            </div>
          </div>
        )}

        {/* Detailed Metadata Grid */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-white border border-slate-200">
            <span className="text-slate-400 text-[10px] uppercase font-bold block mb-1">
              Storage Location
            </span>
            <span className="font-semibold text-slate-800 capitalize flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              {item.location} &bull; {item.storageZone || 'General Shelf'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-white border border-slate-200">
            <span className="text-slate-400 text-[10px] uppercase font-bold block mb-1">
              Expiry Date
            </span>
            <span className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-rose-500" />
              {formatDate(item.expiryDate)}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-white border border-slate-200">
            <span className="text-slate-400 text-[10px] uppercase font-bold block mb-1">
              Purchase Date
            </span>
            <span className="font-semibold text-slate-800">
              {formatDate(item.purchaseDate)}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-white border border-slate-200">
            <span className="text-slate-400 text-[10px] uppercase font-bold block mb-1">
              Package Status
            </span>
            <span
              className={`font-semibold flex items-center gap-1.5 ${
                item.isOpened ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              <PackageOpen className="w-3.5 h-3.5" />
              {item.isOpened
                ? `Opened (${item.openedDate ? formatDate(item.openedDate) : 'Recently'})`
                : 'Sealed / Unopened'}
            </span>
          </div>
        </div>

        {/* Notes & Barcode */}
        <div className="space-y-2 text-xs">
          {item.notes && (
            <div className="p-3 rounded-xl bg-cream-50 border border-[#edebe4]">
              <span className="font-bold text-slate-700 block mb-0.5 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-slate-400" /> Storage Notes
              </span>
              <p className="text-slate-600 text-[11px] leading-relaxed">{item.notes}</p>
            </div>
          )}

          {item.barcode && (
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-xl text-[11px] text-slate-500 border border-slate-100">
              <span className="flex items-center gap-1.5">
                <Barcode className="w-3.5 h-3.5" /> Barcode GTIN:
              </span>
              <span className="font-mono text-slate-700">{item.barcode}</span>
            </div>
          )}
        </div>

        {/* Action Triggers Footer */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            onClick={() => {
              onClose()
              onDelete?.(item.id)
            }}
            className="text-rose-600 hover:bg-rose-50"
          >
            Delete
          </Button>

          <div className="flex items-center gap-2">
            {!item.isOpened && (
              <Button
                variant="outline"
                size="sm"
                icon={PackageOpen}
                onClick={() => {
                  onClose()
                  onTriggerAction?.(item, 'open')
                }}
              >
                Mark Opened
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              icon={Trash2}
              onClick={() => {
                onClose()
                onTriggerAction?.(item, 'waste')
              }}
              className="border-rose-200 text-rose-700 hover:bg-rose-50"
            >
              Log Waste
            </Button>

            <Button
              variant="primary"
              size="sm"
              icon={Check}
              onClick={() => {
                onClose()
                onTriggerAction?.(item, 'consume')
              }}
            >
              Consume
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default ItemDetailsModal
