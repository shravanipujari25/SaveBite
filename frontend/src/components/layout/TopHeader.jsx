import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Plus, Sparkles } from 'lucide-react'
import NotificationBell from './NotificationBell'
import UserProfileMenu from './UserProfileMenu'
import Button from '../common/Button'
import { api } from '../../api/client'

const routeTitles = {
  '/dashboard': 'Pantry Overview',
  '/pantry': 'My Grocery Inventory',
  '/groceries/add': 'Log Groceries',
  '/storage': 'IoT Storage Telemetry',
  '/recipes': 'Waste-Less Kitchen',
  '/shopping-list': 'Smart Shopping List',
  '/analytics': 'Food Waste Insights',
  '/assistant': 'SaveBite AI Assistant',
  '/profile': 'Household Profile',
  '/settings': 'System Settings',
}

export function TopHeader() {
  const location = useLocation()
  const pageTitle = routeTitles[location.pathname] || 'SaveBite'

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#edebe4] bg-white/95 px-4 sm:px-6 backdrop-blur-md">
      {/* Mobile brand & title */}
      <div className="flex items-center gap-3">
        <Link to="/dashboard" className="md:hidden flex items-center gap-2">
          <span className="text-2xl" role="img" aria-label="SaveBite Avocado">🥑</span>
          <span className="font-extrabold text-base tracking-tight text-emerald-900">SaveBite</span>
        </Link>
        <div className="hidden md:block">
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">{pageTitle}</h1>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2 sm:gap-3">

        



        {/* Quick Add Button */}
        <Link to="/groceries/add" className="hidden sm:inline-flex">
          <Button size="sm" icon={Plus} variant="primary">
            Add Grocery
          </Button>
        </Link>

        {/* Notification Bell */}
        <NotificationBell />

        {/* User Profile */}
        <UserProfileMenu />
      </div>
    </header>
  )
}

export default TopHeader
