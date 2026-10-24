import React from 'react'

export function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  dot = false,
  className = '',
}) {
  const variants = {
    fresh: 'bg-emerald-50 text-emerald-800 border-emerald-200/80',
    warning: 'bg-amber-50 text-amber-800 border-amber-200/80',
    critical: 'bg-rose-50 text-rose-800 border-rose-200/80',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    info: 'bg-sky-50 text-sky-800 border-sky-200/80',
    brand: 'bg-emerald-800 text-white border-transparent',
  }

  const dotColors = {
    fresh: 'bg-emerald-500',
    warning: 'bg-amber-500',
    critical: 'bg-rose-500 animate-pulse',
    neutral: 'bg-slate-400',
    info: 'bg-sky-500',
    brand: 'bg-emerald-300',
  }

  const sizes = {
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5',
  }

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 font-medium rounded-full border
        ${variants[variant] || variants.neutral}
        ${sizes[size] || sizes.md}
        ${className}
      `}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${dotColors[variant] || 'bg-slate-400'}`}
        />
      )}
      {children}
    </span>
  )
}

export default Badge
