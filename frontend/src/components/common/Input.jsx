import React, { forwardRef } from 'react'

export const Input = forwardRef(function Input(
  {
    label,
    error,
    hint,
    id,
    type = 'text',
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    className = '',
    required = false,
    ...props
  },
  ref
) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
        >
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <div className="relative rounded-xl shadow-xs">
        {LeftIcon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
            <LeftIcon className="h-4 w-4" aria-hidden="true" />
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          required={required}
          className={`
            block w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-slate-900 transition-colors
            placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent
            ${LeftIcon ? 'pl-10' : ''}
            ${RightIcon ? 'pr-10' : ''}
            ${error ? 'border-rose-400 text-rose-900 focus:ring-rose-500' : 'border-slate-200 hover:border-slate-300'}
            ${className}
          `}
          {...props}
        />
        {RightIcon && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400">
            <RightIcon className="h-4 w-4" aria-hidden="true" />
          </div>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-rose-600 font-medium">{error}</p>}
      {hint && !error && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
})

export default Input
