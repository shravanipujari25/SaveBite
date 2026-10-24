/**
 * SaveBite Authentication Service
 * Communicates with the Node.js + Express + JWT backend.
 * When VITE_USE_MOCKS=true, provides explicit demo/mock authentication for local development.
 * Never silently falls back to mock authentication if real requests fail.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

const TOKEN_KEY = 'savebite_jwt_token'
const MOCK_USER_KEY = 'savebite_mock_auth_user'

const delay = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms))

export const authService = {
  isMockMode: USE_MOCKS,

  getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },

  setToken(token) {
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token)
      } else {
        localStorage.removeItem(TOKEN_KEY)
      }
    } catch (e) {
      console.warn('[authService] Failed to persist token:', e)
    }
  },

  clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(MOCK_USER_KEY)
    } catch (e) {
      console.warn('[authService] Failed to clear session:', e)
    }
  },

  /**
   * Log in user
   * @param {{ email: string, password: string }} credentials
   */
  async login({ email, password }) {
    // 1. Mock Authentication Mode
    if (USE_MOCKS) {
      await delay(200)

      if (!email || !password) {
        return { data: null, error: 'Email and password are required', status: 400 }
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email.trim())) {
        return { data: null, error: 'Please enter a valid email address', status: 400 }
      }

      // Successful mock session
      const mockUser = {
        id: 'usr_demo_' + Date.now().toString(36),
        name: email.split('@')[0].replace('.', ' '),
        email: email.trim().toLowerCase(),
        role: 'Household Admin',
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
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Support HttpOnly cookies if configured
        body: JSON.stringify({ email: email.trim(), password }),
      })

      const result = await response.json().catch(() => null)

      if (!response.ok) {
        let errorMessage = 'Invalid credentials or login failed'
        if (response.status === 401) {
          errorMessage = result?.message || 'Invalid email or password. Please try again.'
        } else if (response.status === 429) {
          errorMessage = 'Too many failed login attempts. Please wait a moment.'
        } else if (result?.message) {
          errorMessage = result.message
        }

        return {
          data: null,
          error: errorMessage,
          status: response.status,
        }
      }

      // If backend returns bearer token in response body, store safely
      const token = result?.token || result?.accessToken || result?.data?.token
      if (token) {
        this.setToken(token)
      }

      const user = result?.user || result?.data?.user || result?.data || {
        email: email.trim(),
        name: email.split('@')[0],
      }

      return {
        data: { user, token },
        error: null,
        status: response.status,
      }
    } catch (err) {
      // Network failure / Backend offline
      return {
        data: null,
        error: `Cannot reach authentication server at ${API_BASE_URL}. Ensure the Node.js backend is running or enable mock mode (VITE_USE_MOCKS=true).`,
        status: 0,
      }
    }
  },

  /**
   * Register new household account
   * @param {{ name: string, email: string, password: string, householdSize?: number }} userData
   */
  async signup({ name, email, password, householdSize = 2 }) {
    // 1. Mock Authentication Mode
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
        role: 'Household Admin',
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

    // 2. Real Backend Node.js JWT Mode
    try {
      const response = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          householdSize: Number(householdSize) || 2,
        }),
      })

      const result = await response.json().catch(() => null)

      if (!response.ok) {
        let errorMessage = 'Signup registration failed'
        if (response.status === 409) {
          errorMessage = result?.message || 'An account with this email address already exists. Please sign in instead.'
        } else if (result?.message) {
          errorMessage = result.message
        }

        return {
          data: null,
          error: errorMessage,
          status: response.status,
        }
      }

      const token = result?.token || result?.accessToken || result?.data?.token
      if (token) {
        this.setToken(token)
      }

      const user = result?.user || result?.data?.user || result?.data || {
        name: name.trim(),
        email: email.trim(),
        householdSize,
      }

      return {
        data: { user, token },
        error: null,
        status: response.status,
      }
    } catch (err) {
      return {
        data: null,
        error: `Cannot reach authentication server at ${API_BASE_URL}. Ensure the Node.js backend is running or enable mock mode.`,
        status: 0,
      }
    }
  },

  /**
   * Fetch currently authenticated user session
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

      // Default mock admin user
      const defaultUser = {
        id: 'usr_demo_admin',
        name: 'Sarah Miller',
        email: 'sarah.miller@example.com',
        role: 'Household Admin',
        householdSize: 2,
        isDemoAccount: true,
      }
      return { data: defaultUser, error: null }
    }

    // Real backend verification
    const token = this.getToken()
    const headers = { 'Content-Type': 'application/json' }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
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
      const user = result?.user || result?.data || result
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
   */
  async logout() {
    if (!USE_MOCKS) {
      const token = this.getToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      try {
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers,
          credentials: 'include',
        })
      } catch (e) {
        console.warn('Logout request error:', e)
      }
    }

    this.clearSession()
    return { success: true }
  },
}

export default authService
