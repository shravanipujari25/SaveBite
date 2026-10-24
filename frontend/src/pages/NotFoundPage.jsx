import React from 'react'
import { Link } from 'react-router-dom'
import Button from '../components/common/Button'
import { Home, ArrowLeft } from 'lucide-react'

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-[#f9f8f3] flex flex-col items-center justify-center p-6 text-center">
      <div className="text-6xl mb-4">🥑</div>
      <h1 className="text-3xl font-black text-slate-900 tracking-tight">404 — Page Not Found</h1>
      <p className="text-sm text-slate-500 mt-2 max-w-md">
        The grocery shelf you are looking for has been moved, consumed, or doesn't exist yet.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <Link to="/dashboard">
          <Button variant="primary" icon={Home}>
            Return to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  )
}

export default NotFoundPage
