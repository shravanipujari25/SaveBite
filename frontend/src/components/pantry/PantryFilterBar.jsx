import React from 'react'
import { Search, LayoutGrid, List, SlidersHorizontal } from 'lucide-react'

export function PantryFilterBar({
  searchQuery,
  onSearchChange,
  activeLocation,
  onLocationChange,
  activeCategory,
  onCategoryChange,
  activeStatus,
  onStatusChange,
  viewMode,
  onViewModeChange,
}) {
  const locations = [
    { id: 'all', label: 'All Zones' },
    { id: 'fridge', label: 'Refrigerator ❄️' },
    { id: 'freezer', label: 'Freezer 🧊' },
    { id: 'pantry', label: 'Pantry Shelf 🥫' },
  ]

  const categories = [
    'All Categories',
    'Produce',
    'Dairy & Eggs',
    'Bakery',
    'Meat & Seafood',
    'Pantry Staples',
    'Beverages',
    'Snacks',
  ]

  const statuses = [
    { id: 'all', label: 'All Freshness' },
    { id: 'critical', label: '🔴 Critical (<=1d)' },
    { id: 'use_soon', label: '🟠 Use Soon (2-4d)' },
    { id: 'fresh', label: '🟢 Fresh' },
    { id: 'opened', label: '🟡 Opened' },
    { id: 'expired', label: '⚫ Expired' },
  ]

  return (
    <div className="flex flex-col gap-3 mb-6 bg-white p-4 rounded-2xl border border-[#edebe4] shadow-xs">
      {/* Search Input & View Toggle */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search groceries by name, notes, or storage zone..."
            className="w-full bg-[#fcfbf9] rounded-xl border border-slate-200 pl-10 pr-10 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* Category Dropdown */}
        <div className="hidden sm:block w-44">
          <select
            value={activeCategory}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-[#fcfbf9] px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 cursor-pointer"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => onViewModeChange('grid')}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
            title="Grid View"
            aria-label="Grid view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('list')}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              viewMode === 'list'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
            title="List View"
            aria-label="List view"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter Tabs & Freshness Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
        {/* Storage Location selector */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
          {locations.map((loc) => (
            <button
              key={loc.id}
              type="button"
              onClick={() => onLocationChange(loc.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                activeLocation === loc.id
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'bg-slate-100/70 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {loc.label}
            </button>
          ))}
        </div>

        {/* Freshness Bucket Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
          {statuses.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => onStatusChange(st.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                activeStatus === st.id
                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default PantryFilterBar
