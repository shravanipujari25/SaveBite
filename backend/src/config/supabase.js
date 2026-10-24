import { createClient } from '@supabase/supabase-js';
import env from './env.js';

let defaultClient = null;
let defaultAdmin = null;

/**
 * Server-side Supabase client initialized with secret service-role key.
 * Used strictly as the backend's PostgreSQL database client.
 *
 * NOTE: Application users authenticate via custom JWTs and bcrypt,
 * NOT Supabase Auth. Consequently, queries do not rely on auth.uid()
 * RLS policies. Application-level authorization, ownership verification,
 * and parameterized query constraints are enforced by backend services.
 */
export const getDatabaseClient = () => {
  if (!defaultAdmin) {
    defaultAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return defaultAdmin;
};

/**
 * Public client for general non-privileged operations if needed.
 */
export const getSupabaseClient = () => {
  if (!defaultClient) {
    defaultClient = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return defaultClient;
};

/**
 * Testing helpers to inject mock database clients during test executions
 */
export const __setMockClients = ({ client, admin }) => {
  if (client !== undefined) defaultClient = client;
  if (admin !== undefined) defaultAdmin = admin;
};

export const __resetMockClients = () => {
  defaultClient = null;
  defaultAdmin = null;
};

export const databaseClient = new Proxy({}, {
  get: (_target, prop) => {
    const client = getDatabaseClient();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});

export const supabaseClient = new Proxy({}, {
  get: (_target, prop) => {
    const client = getSupabaseClient();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});

export default {
  databaseClient,
  supabaseClient,
  getDatabaseClient,
  getSupabaseClient,
  __setMockClients,
  __resetMockClients
};
