import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Refrigerator,
  Plus,
  Cpu,
  Bot,
  ChefHat,
} from 'lucide-react'

export function BottomNav() {
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 border-t border-[#edebe4] backdrop-blur-md pb-[env(safe-area-inset-bottom)] shadow-lg"
      aria-label="Mobile Navigation"
    >
      <div className="flex items-center justify-around h-16 px-2">
        {/* Dashboard */}
        <NavLink
          to="/dashboard"
          className={({ isActive }) => `
            flex flex-col items-center justify-center flex-1 py-1 text-[10px] font-semibold transition-colors
            ${isActive ? 'text-emerald-800' : 'text-slate-500 hover:text-slate-800'}
          `}
        >
          <LayoutDashboard className="w-5 h-5 mb-1" />
          <span>Dashboard</span>
        </NavLink>

        {/* Pantry */}
        <NavLink
          to="/pantry"
          className={({ isActive }) => `
            flex flex-col items-center justify-center flex-1 py-1 text-[10px] font-semibold transition-colors
            ${isActive ? 'text-emerald-800' : 'text-slate-500 hover:text-slate-800'}
          `}
        >
          <Refrigerator className="w-5 h-5 mb-1" />
          <span>Pantry</span>
        </NavLink>

        {/* Floating Center Action: Add Grocery */}
        <div className="flex flex-col items-center justify-center px-1 -mt-4">
          <NavLink
            to="/groceries/add"
            className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-800 text-white shadow-lg shadow-emerald-900/30 active:scale-95 transition-transform"
            aria-label="Add Groceries"
          >
            <Plus className="w-6 h-6" />
          </NavLink>
          <span className="text-[10px] font-semibold text-slate-600 mt-1">Add</span>
        </div>

        {/* Storage */}
        <NavLink
          to="/storage"
          className={({ isActive }) => `
            flex flex-col items-center justify-center flex-1 py-1 text-[10px] font-semibold transition-colors
            ${isActive ? 'text-emerald-800' : 'text-slate-500 hover:text-slate-800'}
          `}
        >
          <Cpu className="w-5 h-5 mb-1" />
          <span>Storage</span>
        </NavLink>

        {/* AI Assistant */}
        <NavLink
          to="/assistant"
          className={({ isActive }) => `
            flex flex-col items-center justify-center flex-1 py-1 text-[10px] font-semibold transition-colors
            ${isActive ? 'text-emerald-800' : 'text-slate-500 hover:text-slate-800'}
          `}
        >
          <Bot className="w-5 h-5 mb-1" />
          <span>Assistant</span>
        </NavLink>
      </div>
    </nav>
  )
}

export default BottomNav
