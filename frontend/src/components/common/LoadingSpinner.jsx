import React from 'react'

export function LoadingSpinner({ size = 'md', className = '', message }) {
  const sizes = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-3',
    lg: 'w-12 h-12 border-4',
  }

  return (
    <div className={`flex flex-col items-center justify-center py-8 ${className}`}>
      <div
        className={`
          animate-spin rounded-full border-slate-200 border-t-emerald-700
          ${sizes[size] || sizes.md}
        `}
      />
      {message && <p className="mt-3 text-xs text-slate-500 font-medium">{message}</p>}
    </div>
  )
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-200/70 rounded-xl ${className}`} />
}

export default LoadingSpinner
