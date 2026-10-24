import 'dotenv/config';
import { z } from 'zod';

const isTest =
  process.env.NODE_ENV === 'test' ||
  process.argv.some((arg) => arg.includes('test'));

if (isTest && !process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default(isTest ? 'test' : 'development'),

  PORT: z.coerce.number().int().positive().default(5000),

  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  SUPABASE_URL: z
    .string()
    .url()
    .default(
      process.env.SUPABASE_URL || (isTest ? 'https://test-project.supabase.co' : 'https://placeholder.supabase.co')
    ),

  SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'SUPABASE_PUBLISHABLE_KEY is required')
    .default(
      process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-publishable-key'
    ),

  SUPABASE_SECRET_KEY: z
    .string()
    .min(1, 'SUPABASE_SECRET_KEY is required')
    .default(
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-secret-key'
    ),

  // Custom JWT Authentication Secret: Must be at least 32 characters long
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters long')
    .refine(
      (secret) => {
        if (isTest) return true;
        return (
          !secret.includes('REPLACE_WITH') &&
          !secret.includes('placeholder') &&
          secret !== 'test-jwt-secret'
        );
      },
      { message: 'JWT_SECRET must not use placeholder or default values in non-test environments' }
    )
    .default(
      isTest ? 'test-jwt-secret-minimum-32-characters-required-for-security' : ''
    ),

  JWT_EXPIRES_IN: z.string().default('15m'),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default(isTest ? 'silent' : 'info'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errorFields = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );

    // CRITICAL SECURITY: Never print environment secret values, only field names
    console.error(
      `[FATAL] Environment validation failed. Invalid variables:\n - ${errorFields.join('\n - ')}`
    );

    throw new Error(
      'Environment configuration validation failed. Check backend/.env against backend/.env.example.'
    );
  }

  return Object.freeze(result.data);
};

export const env = parseEnv();
export default env;
