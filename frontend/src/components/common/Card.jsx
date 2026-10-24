import React from 'react'

export function Card({
  children,
  className = '',
  hoverEffect = false,
  padding = 'p-5',
  onClick,
  ...props
}) {
  return (
    <div
      onClick={onClick}
      className={`
        bg-white rounded-2xl border border-[#edebe4] shadow-xs
        ${hoverEffect ? 'hover:shadow-md hover:border-emerald-200/80 transition-all duration-200 cursor-pointer' : ''}
        ${padding}
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`flex items-start justify-between mb-4 pb-1 ${className}`}>
      <div>
        <h3 className="font-bold text-slate-900 text-base tracking-tight">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}

export default Card
