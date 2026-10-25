import React from 'react'
import {
  Sparkles,
  Info,
  LayoutDashboard,
  Refrigerator,
  ScanLine,
  Cpu,
  ChefHat,
  ShoppingBag,
  BarChart3,
  ShieldCheck,
  Settings,
} from 'lucide-react'

const ICON_MAP = {
  Sparkles,
  Info,
  LayoutDashboard,
  Refrigerator,
  ScanLine,
  Cpu,
  ChefHat,
  ShoppingBag,
  BarChart3,
  ShieldCheck,
  Settings,
}

export function FAQCategories({ categories, selectedCategory, onSelectCategory }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 no-scrollbar scroll-smooth">
      {categories.map((cat) => {
        const IconComponent = ICON_MAP[cat.icon] || Sparkles
        const isSelected = selectedCategory === cat.id

        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelectCategory(cat.id)}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer shrink-0
              ${
                isSelected
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }
            `}
          >
            <IconComponent className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-emerald-700'}`} />
            <span>{cat.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default FAQCategories
