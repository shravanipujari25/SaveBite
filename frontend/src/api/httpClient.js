/**
 * SaveBite Centralized HTTP Client
 * Handles authenticated API requests, error parsing, timeouts, and token injection.
 */

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1'
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'
export const TOKEN_STORAGE_KEY = 'savebite_jwt_token'

/**
 * Standard HTTP request wrapper
 *
 * @param {string} endpoint - API path relative to base URL (e.g. '/dashboard')
 * @param {object} [options={}] - Fetch options (method, headers, body, timeoutMs, etc.)
 * @returns {Promise<{ data: any, error: string|null, status: number }>}
 */
export async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
  const headers = {
    ...(options.headers || {}),
  }

  // Automatically inject Bearer JWT if token exists
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // Only set application/json if body is not FormData
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  const timeoutMs = options.timeoutMs || 15000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let onCallerAbort = null
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer)
      return { data: null, error: null, status: 0, aborted: true }
    }
    onCallerAbort = () => controller.abort()
    options.signal.addEventListener('abort', onCallerAbort, { once: true })
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (onCallerAbort && options.signal) {
      options.signal.removeEventListener('abort', onCallerAbort)
    }

    let json = null
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      json = await response.json().catch(() => null)
    }

    if (!response.ok) {
      // Parse backend validation error structures
      let errorMsg = `Request failed with status ${response.status}`
      if (json) {
        if (json.error?.message) {
          errorMsg = json.error.message
        } else if (json.message) {
          errorMsg = json.message
        } else if (typeof json.error === 'string') {
          errorMsg = json.error
        }
        // If validation errors are present in details
        if (json.error?.details && Array.isArray(json.error.details)) {
          const detailMsgs = json.error.details.map((d) => d.message || d.field).filter(Boolean)
          if (detailMsgs.length > 0) {
            errorMsg = detailMsgs.join('; ')
          }
        }
      }

      // Handle 401 unauthorized
      if (response.status === 401) {
        // Clear token if invalid or revoked
        if (token && !endpoint.includes('/auth/signin') && !endpoint.includes('/auth/signup')) {
          localStorage.removeItem(TOKEN_STORAGE_KEY)
          window.dispatchEvent(new CustomEvent('savebite:auth_expired'))
        }
      }

      return {
        data: null,
        error: errorMsg,
        status: response.status,
      }
    }

    // Backend typically envelopes responses in { status: "success", data: ... }
    const responseData = (json && json.status === 'success' && json.data !== undefined)
      ? json.data
      : (json !== null ? json : true)

    return { data: responseData, error: null, status: response.status }
  } catch (err) {
    clearTimeout(timer)
    if (onCallerAbort && options.signal) {
      options.signal.removeEventListener('abort', onCallerAbort)
    }

    if (options.signal?.aborted) {
      return {
        data: null,
        error: null,
        status: 0,
        aborted: true,
      }
    }

    if (err.name === 'AbortError') {
      return {
        data: null,
        error: 'Request timed out after 15 seconds. Please check your connection.',
        status: 408,
      }
    }
    return {
      data: null,
      error: err.message || 'Network communication error',
      status: 0,
    }
  }
}
