import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../components/layout/Sidebar'
import TopHeader from '../components/layout/TopHeader'
import BottomNav from '../components/layout/BottomNav'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-[#f9f8f3] text-slate-800 flex">
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopHeader />

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>

        {/* Mobile Bottom Navigation */}
        <BottomNav />
      </div>
    </div>
  )
}

export default AppLayout
