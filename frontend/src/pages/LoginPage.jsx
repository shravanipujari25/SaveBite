import React, { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Input from '../components/common/Input'
import Button from '../components/common/Button'
import { Mail, Lock, ArrowRight, Sparkles, Eye, EyeOff, AlertCircle } from 'lucide-react'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isMockMode } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Validate form
  const validate = () => {
    const errs = {}
    if (!email.trim()) {
      errs.email = 'Email address is required'
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email.trim())) {
        errs.email = 'Please enter a valid email address'
      }
    }

    if (!password) {
      errs.password = 'Password is required'
    } else if (password.length < 6) {
      errs.password = 'Password must be at least 6 characters'
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setServerError('')

    if (!validate()) return

    setIsLoading(true)
    try {
      await login({ email, password })
      const destination = location.state?.from?.pathname || '/dashboard'
      navigate(destination, { replace: true })
    } catch (err) {
      setServerError(err.message || 'Login failed. Please verify credentials.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAutofillDemo = () => {
    setEmail('sarah.miller@example.com')
    setPassword('DemoPass2026!')
    setErrors({})
    setServerError('')
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="text-center">
        <h2 className="text-xl font-black text-slate-900 tracking-tight">
          Welcome to SaveBite
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Sign in to manage household groceries, IoT telemetry, and waste analytics.
        </p>
      </div>

      {/* Mode Indicator Banner (only in mock mode) */}
      {isMockMode && (
        <div className="p-3 bg-emerald-50 border border-emerald-200/90 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-900">
          <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block">Demo / Mock Auth Mode Active</span>
            <span className="text-[11px] text-emerald-700 leading-normal">
              Authentication is simulated locally via <code>VITE_USE_MOCKS=true</code>. Click below to autofill demo credentials.
            </span>
          </div>
        </div>
      )}

      {/* Server Error Alert */}
      {serverError && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 text-xs text-rose-800 animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold block">Authentication Notice</span>
            <span>{serverError}</span>
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Email */}
        <Input
          label="Email Address"
          type="email"
          required
          leftIcon={Mail}
          placeholder="sarah.miller@example.com"
          value={email}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (errors.email) setErrors((prev) => ({ ...prev, email: '' }))
          }}
        />

        {/* Password with Show/Hide Toggle */}
        <div className="relative">
          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            required
            leftIcon={Lock}
            placeholder="••••••••"
            value={password}
            error={errors.password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (errors.password) setErrors((prev) => ({ ...prev, password: '' }))
            }}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-[34px] text-slate-400 hover:text-slate-600 p-1 cursor-pointer transition-colors"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          variant="primary"
          fullWidth
          size="lg"
          isLoading={isLoading}
          icon={ArrowRight}
          iconPosition="right"
        >
          Sign In
        </Button>
      </form>

      {/* Demo Account Autofill Button */}
      {isMockMode && (
        <div className="pt-2 border-t border-slate-100 text-center">
          <button
            type="button"
            onClick={handleAutofillDemo}
            className="text-xs text-emerald-800 hover:text-emerald-950 font-bold inline-flex items-center gap-1.5 cursor-pointer py-1 px-3 rounded-lg hover:bg-emerald-50 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Autofill Demo Household Credentials</span>
          </button>
        </div>
      )}

      {/* Footer Navigation */}
      <div className="text-center text-xs text-slate-500 pt-1">
        Don't have a SaveBite household account?{' '}
        <Link to="/signup" className="text-emerald-800 font-bold hover:underline">
          Create Household
        </Link>
      </div>
    </div>
  )
}

export default LoginPage
