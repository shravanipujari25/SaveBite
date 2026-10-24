import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authService } from '../api/authService'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)

  const checkAuth = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await authService.getCurrentUser()
      if (data) {
        setUser(data)
      } else {
        setUser(null)
      }
      setAuthError(error || null)
    } catch (err) {
      console.error('[AuthContext] Session verification error:', err)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const login = async (credentials) => {
    setAuthError(null)
    const { data, error, status } = await authService.login(credentials)
    if (error) {
      setAuthError(error)
      const err = new Error(error)
      err.status = status
      throw err
    }
    setUser(data.user)
    return data.user
  }

  const signup = async (userData) => {
    setAuthError(null)
    const { data, error, status } = await authService.signup(userData)
    if (error) {
      setAuthError(error)
      const err = new Error(error)
      err.status = status
      throw err
    }
    setUser(data.user)
    return data.user
  }

  const logout = async () => {
    await authService.logout()
    setUser(null)
    setAuthError(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: Boolean(user),
        isMockMode: authService.isMockMode,
        authError,
        login,
        signup,
        logout,
        refreshUser: checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export default AuthContext
