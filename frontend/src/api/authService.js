/**
 * SaveBite Authentication Service
 * Communicates with the Node.js + Express + custom JWT backend.
 * When VITE_USE_MOCKS=true, provides explicit demo/mock authentication for local development.
 * Never silently falls back to mock authentication if real requests fail.
 */

import { API_BASE_URL, TOKEN_STORAGE_KEY } from './httpClient'

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'
const MOCK_USER_KEY = 'savebite_mock_auth_user'
const delay = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))

export const authService = {
  isMockMode: USE_MOCKS,

  getToken() {
    return localStorage.getItem(TOKEN_STORAGE_KEY)
  },

  setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  },

  clearSession() {
    this.setToken(null)
    try {
      localStorage.removeItem(MOCK_USER_KEY)
      localStorage.removeItem('savebite_auth_token')
    } catch (e) {
      console.warn('[authService] Failed to clear session:', e)
    }
  },

  /**
   * Log in user using email and password
   * Connects to POST /api/v1/auth/signin
   * @param {{ email: string, password: string }} credentials
   */
  async login({ email, password }) {
    // 1. Explicit Mock Authentication Mode
    if (USE_MOCKS) {
      await delay(200)

      if (!email || !password) {
        return { data: null, error: 'Email and password are required', status: 400 }
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email.trim())) {
        return { data: null, error: 'Please enter a valid email address', status: 400 }
      }

      const mockUser = {
        id: 'usr_demo_' + Date.now().toString(36),
        name: email.split('@')[0].replace('.', ' '),
        email: email.trim().toLowerCase(),
        role: 'user',
        householdSize: 2,
        isDemoAccount: true,
      }

      const mockToken = 'mock_jwt_token_' + btoa(JSON.stringify({ sub: mockUser.id, email: mockUser.email, iat: Date.now() }))
      this.setToken(mockToken)
      try {
        localStorage.setItem(MOCK_USER_KEY, JSON.stringify(mockUser))
      } catch (e) {
        console.warn('Failed to store mock user', e)
      }

      return {
        data: { user: mockUser, token: mockToken },
        error: null,
        status: 200,
      }
    }

    // 2. Real Backend Node.js JWT Authentication Mode
    try {
      const response = await fetch(`${API_BASE_URL}/auth/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      })

      const result = await response.json().catch(() => null)

      if (!response.ok) {
        let errorMessage = 'Invalid credentials or login failed'
        if (response.status === 401) {
          errorMessage = result?.message || result?.error?.message || 'Invalid email or password. Please try again.'
        } else if (response.status === 429) {
          errorMessage = 'Too many failed login attempts. Please wait a moment.'
        } else if (result?.error?.details && Array.isArray(result.error.details)) {
          errorMessage = result.error.details.map((d) => d.message).join('. ')
        } else if (result?.message || result?.error?.message) {
          errorMessage = result.message || result.error.message
        }

        return {
          data: null,
          error: errorMessage,
          status: response.status,
        }
      }

      // Backend returns: { status: 'success', data: { user, household, accessToken } }
      const authData = result?.data || result
      const token = authData?.accessToken || authData?.token
      if (token) {
        this.setToken(token)
      }

      const user = authData?.user || {
        email: email.trim(),
        name: email.split('@')[0],
      }

      return {
        data: {
          user: {
            ...user,
            household: authData?.household,
          },
          token,
        },
        error: null,
        status: response.status,
      }
    } catch (err) {
      return {
        data: null,
        error: `Cannot reach backend at ${API_BASE_URL}. Ensure the SaveBite backend server is running on port 5000.`,
        status: 0,
      }
    }
  },

  /**
   * Register new household account
   * Connects to POST /api/v1/auth/signup
   * @param {{ name: string, email: string, password: string, householdSize?: number }} userData
   */
  async signup({ name, email, password, householdSize = 2 }) {
    if (USE_MOCKS) {
      await delay(250)

      if (!name || !email || !password) {
        return { data: null, error: 'All fields are required', status: 400 }
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email.trim())) {
        return { data: null, error: 'Please enter a valid email address', status: 400 }
      }

      if (password.length < 8) {
        return { data: null, error: 'Password must be at least 8 characters long', status: 400 }
      }

      const mockUser = {
        id: 'usr_new_' + Date.now().toString(36),
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: 'user',
        householdSize: Number(householdSize) || 2,
        isDemoAccount: true,
      }

      const mockToken = 'mock_jwt_token_' + btoa(JSON.stringify({ sub: mockUser.id, email: mockUser.email, iat: Date.now() }))
      this.setToken(mockToken)
      try {
        localStorage.setItem(MOCK_USER_KEY, JSON.stringify(mockUser))
      } catch (e) {
        console.warn('Failed to store mock user', e)
      }

      return {
        data: { user: mockUser, token: mockToken },
        error: null,
        status: 201,
      }
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      })

      const result = await response.json().catch(() => null)

      if (!response.ok) {
        let errorMessage = 'Signup registration failed'
        if (response.status === 409) {
          errorMessage = result?.message || result?.error?.message || 'An account with this email address already exists. Please sign in instead.'
        } else if (result?.error?.details && Array.isArray(result.error.details)) {
          errorMessage = result.error.details.map((d) => d.message).join('. ')
        } else if (result?.message || result?.error?.message) {
          errorMessage = result.message || result.error.message
        }

        return {
          data: null,
          error: errorMessage,
          status: response.status,
        }
      }

      // Backend returns: { status: 'success', data: { user, household, accessToken } }
      const authData = result?.data || result
      const token = authData?.accessToken || authData?.token
      if (token) {
        this.setToken(token)
      }

      const user = authData?.user || {
        name: name.trim(),
        email: email.trim(),
      }

      return {
        data: {
          user: {
            ...user,
            household: authData?.household,
          },
          token,
        },
        error: null,
        status: response.status,
      }
    } catch (err) {
      return {
        data: null,
        error: `Cannot reach backend at ${API_BASE_URL}. Ensure the SaveBite backend server is running on port 5000.`,
        status: 0,
      }
    }
  },

  /**
   * Fetch currently authenticated user session
   * Connects to GET /api/v1/auth/me
   */
  async getCurrentUser() {
    if (USE_MOCKS) {
      await delay(100)
      try {
        const stored = localStorage.getItem(MOCK_USER_KEY)
        if (stored) {
          return { data: JSON.parse(stored), error: null }
        }
      } catch (e) {
        console.warn('Error reading mock user:', e)
      }

      return {
        data: {
          id: 'usr_demo_admin',
          name: 'Demo Chef',
          email: 'demo@savebite.com',
          role: 'user',
          isDemoAccount: true,
        },
        error: null,
      }
    }

    const token = this.getToken()
    if (!token) {
      return { data: null, error: null, status: 401 }
    }

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'GET',
        headers,
        credentials: 'include',
      })

      if (!response.ok) {
        if (response.status === 401) {
          this.clearSession()
        }
        return { data: null, error: 'Session expired or unauthenticated', status: response.status }
      }

      const result = await response.json().catch(() => null)
      const user = result?.data?.user || result?.data || result?.user
      return { data: user, error: null, status: response.status }
    } catch (err) {
      return {
        data: null,
        error: 'Network error verifying authentication session',
        status: 0,
      }
    }
  },

  /**
   * Log out session
   * Connects to POST /api/v1/auth/logout
   */
  async logout() {
    if (!USE_MOCKS) {
      const token = this.getToken()
      if (token) {
        try {
          await fetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            credentials: 'include',
          })
        } catch (e) {
          console.warn('Logout request error:', e)
        }
      }
    }

    this.clearSession()
    return { success: true }
  },
}

export default authService
