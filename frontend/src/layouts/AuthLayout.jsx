import React from 'react'
import { Outlet, Link } from 'react-router-dom'
import { ShieldCheck, Sparkles } from 'lucide-react'

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-[#f9f8f3] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      {/* Brand Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link to="/" className="inline-flex items-center gap-2 mb-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-800 text-white flex items-center justify-center text-2xl shadow-md shadow-emerald-900/20">
            🥑
          </div>
          <span className="font-extrabold text-2xl text-emerald-950 tracking-tight">SaveBite</span>
        </Link>
        <p className="text-sm font-semibold text-emerald-800">
          Save Food. Save Money. Waste Less.
        </p>
        <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
          Intelligent pantry management with real-time freshness telemetry.
        </p>
      </div>

      {/* Auth Card */}
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white py-8 px-6 sm:px-10 rounded-3xl border border-[#edebe4] shadow-sm">
          <Outlet />
        </div>

        {/* Footer info */}
        <div className="mt-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Local Mock Mode Active &bull; Safe Test Environment</span>
        </div>
      </div>
    </div>
  )
}

export default AuthLayout
