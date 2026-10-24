/**
 * Freshness calculations and visual badge helper mappings
 */

export const FreshnessStatus = {
  EXPIRED: 'expired',
  CRITICAL: 'critical',
  USE_SOON: 'use_soon',
  FRESH: 'fresh',
}

/**
 * Calculates remaining days from now until target expiry date
 * @param {string|Date} expiryDate
 * @returns {number} integer days remaining (can be negative if past)
 */
export function calculateDaysRemaining(expiryDate) {
  if (!expiryDate) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const expiry = new Date(expiryDate)
  expiry.setHours(0, 0, 0, 0)
  
  const diffTime = expiry.getTime() - today.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

/**
 * Categorizes freshness based on remaining days
 * @param {number} days
 * @returns {string} status key
 */
export function getFreshnessStatus(days) {
  if (days < 0) return FreshnessStatus.EXPIRED
  if (days <= 1) return FreshnessStatus.CRITICAL
  if (days <= 4) return FreshnessStatus.USE_SOON
  return FreshnessStatus.FRESH
}

/**
 * Returns human-readable label
 */
export function getStatusLabel(status) {
  switch (status) {
    case FreshnessStatus.EXPIRED:
      return 'Expired'
    case FreshnessStatus.CRITICAL:
      return 'Expiring Today'
    case FreshnessStatus.USE_SOON:
      return 'Use Soon'
    case FreshnessStatus.FRESH:
    default:
      return 'Fresh & Good'
  }
}

/**
 * Returns CSS color token configurations for badges and indicators
 */
export function getFreshnessStyle(status) {
  switch (status) {
    case FreshnessStatus.EXPIRED:
      return {
        bg: 'bg-slate-100 text-slate-700 border-slate-300',
        dot: 'bg-slate-500',
        iconColor: 'text-slate-500',
        label: 'Expired',
      }
    case FreshnessStatus.CRITICAL:
      return {
        bg: 'bg-rose-50 text-rose-700 border-rose-200',
        dot: 'bg-rose-500',
        iconColor: 'text-rose-600',
        label: 'Expiring Today',
      }
    case FreshnessStatus.USE_SOON:
      return {
        bg: 'bg-amber-50 text-amber-700 border-amber-200',
        dot: 'bg-amber-500',
        iconColor: 'text-amber-600',
        label: 'Use Soon',
      }
    case FreshnessStatus.FRESH:
    default:
      return {
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dot: 'bg-emerald-500',
        iconColor: 'text-emerald-600',
        label: 'Fresh',
      }
  }
}
