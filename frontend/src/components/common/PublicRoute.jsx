import React from 'react'
import { Navigate, useLocation, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import LoadingSpinner from './LoadingSpinner'

export function PublicRoute({ children }) {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f9f8f3]">
        <LoadingSpinner message="Checking session..." />
      </div>
    )
  }

  if (isAuthenticated) {
    const destination = location.state?.from?.pathname || '/dashboard'
    return <Navigate to={destination} replace />
  }

  return children ? children : <Outlet />
}

export default PublicRoute
