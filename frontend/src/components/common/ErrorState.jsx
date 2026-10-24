import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import Button from './Button'

export function ErrorState({
  title = 'Something went wrong',
  message = 'An unexpected error occurred while loading this section.',
  onRetry,
  className = '',
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center p-8 bg-rose-50/50 rounded-2xl border border-rose-200/60 ${className}`}
    >
      <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-3">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <h3 className="text-sm font-bold text-slate-900 mb-1">{title}</h3>
      <p className="text-xs text-slate-600 max-w-sm mb-4">{message}</p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          icon={RefreshCw}
          onClick={onRetry}
          className="bg-white border-rose-200 text-rose-700 hover:bg-rose-50"
        >
          Try Again
        </Button>
      )}
    </div>
  )
}

export default ErrorState
