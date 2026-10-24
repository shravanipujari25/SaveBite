import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Input from '../components/common/Input'
import Button from '../components/common/Button'
import { Mail, Lock, User, Users, ArrowRight, Eye, EyeOff, AlertCircle, Sparkles } from 'lucide-react'

export function SignupPage() {
  const navigate = useNavigate()
  const { signup, isMockMode } = useAuth()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [householdSize, setHouseholdSize] = useState('2')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const validate = () => {
    const errs = {}

    if (!name.trim()) {
      errs.name = 'Full name is required'
    } else if (name.trim().length < 2) {
      errs.name = 'Name must be at least 2 characters'
    }

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
    } else if (password.length < 8) {
      errs.password = 'Password must be at least 8 characters'
    } else if (!/(?=.*[a-zA-Z])(?=.*[0-9])/.test(password)) {
      errs.password = 'Password must include at least one letter and one number'
    }

    if (!householdSize || Number(householdSize) < 1) {
      errs.householdSize = 'Minimum 1 person'
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
      await signup({
        name: name.trim(),
        email: email.trim(),
        password,
        householdSize: Number(householdSize),
      })
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setServerError(err.message || 'Registration failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="text-center">
        <h2 className="text-xl font-black text-slate-900 tracking-tight">
          Create Household Account
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Join SaveBite to monitor freshness and eliminate grocery waste.
        </p>
      </div>

      {/* Mode Banner */}
      {isMockMode && (
        <div className="p-3 bg-emerald-50 border border-emerald-200/90 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-900">
          <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block">Demo Registration Mode Active</span>
            <span className="text-[11px] text-emerald-700 leading-normal">
              Creates a local sandbox session instantly.
            </span>
          </div>
        </div>
      )}

      {/* Server Error Alert */}
      {serverError && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 text-xs text-rose-800 animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold block">Registration Notice</span>
            <span>{serverError}</span>
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Name */}
        <Input
          label="Full Name"
          type="text"
          required
          leftIcon={User}
          placeholder="Sarah Miller"
          value={name}
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value)
            if (errors.name) setErrors((prev) => ({ ...prev, name: '' }))
          }}
        />

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

        {/* Household Size & Password */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Household Size"
            type="number"
            min="1"
            max="12"
            required
            leftIcon={Users}
            value={householdSize}
            error={errors.householdSize}
            onChange={(e) => {
              setHouseholdSize(e.target.value)
              if (errors.householdSize) setErrors((prev) => ({ ...prev, householdSize: '' }))
            }}
          />

          <div className="relative">
            <Input
              label="Password (min 8 chars)"
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
          Create Account
        </Button>
      </form>

      {/* Navigation */}
      <div className="text-center text-xs text-slate-500 pt-2 border-t border-slate-100">
        Already registered?{' '}
        <Link to="/login" className="text-emerald-800 font-bold hover:underline">
          Sign In to Household
        </Link>
      </div>
    </div>
  )
}

export default SignupPage
