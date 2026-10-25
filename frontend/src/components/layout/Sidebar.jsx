import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Refrigerator,
  PlusCircle,
  Cpu,
  ChefHat,
  ShoppingBag,
  BarChart3,
  Bot,
  Settings,
  Sparkles,
} from 'lucide-react'
import logoImg from '../../assets/logo.png'

const navItems = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { name: 'Pantry Inventory', path: '/pantry', icon: Refrigerator },
  { name: 'Add Grocery', path: '/groceries/add', icon: PlusCircle },
  { name: 'IoT Storage', path: '/storage', icon: Cpu },
  { name: 'Rescue Recipes', path: '/recipes', icon: ChefHat },
  { name: 'Shopping List', path: '/shopping-list', icon: ShoppingBag },
  { name: 'Waste Analytics', path: '/analytics', icon: BarChart3 },
  { name: 'AI Assistant', path: '/assistant', icon: Bot, badge: 'Smart' },
]

export function Sidebar() {
  return (
    <aside className="hidden md:flex md:w-64 flex-col justify-between border-r border-[#edebe4] bg-[#fdfcf9] p-4 shrink-0 h-screen sticky top-0">
      <div className="flex flex-col gap-6">
        {/* Brand identity */}
        <div className="flex items-center gap-3 px-2 py-1">
          <div className="w-10 h-10 rounded-2xl bg-white border border-emerald-100 p-1 flex items-center justify-center shadow-sm shadow-emerald-900/10 overflow-hidden">
            <img src={logoImg} alt="SaveBite Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <span className="font-extrabold text-lg tracking-tight text-emerald-950 block leading-tight">
              SaveBite
            </span>
            <span className="text-[10px] font-medium text-emerald-700 tracking-wide block uppercase">
              Waste Less • Eat Fresh
            </span>
          </div>
        </div>

        {/* Navigation list */}
        <nav className="flex flex-col gap-1" aria-label="Main Navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `
                  flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150
                  ${isActive
                    ? 'bg-emerald-800 text-white shadow-xs shadow-emerald-900/10'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                  }
                `}
              >
                {({ isActive }) => (
                  <>
                    <div className="flex items-center gap-3">
                      <Icon
                        className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'
                          }`}
                      />
                      <span>{item.name}</span>
                    </div>
                    {item.badge && (
                      <span
                        className={`text-[9px] uppercase px-1.5 py-0.5 rounded-full font-bold ${isActive ? 'bg-emerald-950 text-emerald-200' : 'bg-emerald-100 text-emerald-800'
                          }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>
      </div>

      {/* Footer Navigation */}
      <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
        <NavLink
          to="/settings"
          className={({ isActive }) => `
            flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-medium transition-colors
            ${isActive ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}
          `}
        >
          <Settings className="w-4 h-4 text-slate-400" />
          <span>System Settings</span>
        </NavLink>
      </div>
    </aside>
  )
}

export default Sidebar
