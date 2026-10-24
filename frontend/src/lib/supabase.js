import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://your-project.supabase.co' &&
  supabaseAnonKey !== 'your-supabase-anon-key-placeholder'
)

let supabaseInstance = null

if (isSupabaseConfigured) {
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
    console.info('[SaveBite] Supabase initialized successfully.')
  } catch (error) {
    console.warn('[SaveBite] Failed to initialize Supabase client:', error)
    supabaseInstance = null
  }
} else {
  // Graceful fallback dummy client so callers never crash on unconfigured local dev
  console.info('[SaveBite] Running in Mock/Offline mode. Supabase credentials not provided.')
}

export const supabase = supabaseInstance
export { isSupabaseConfigured }
export default supabaseInstance
