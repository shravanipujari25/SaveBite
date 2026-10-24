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

  AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  TELEMETRY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(40),

  // MQTT Broker Configuration (Optional in development)
  MQTT_ENABLED: z.preprocess(
    (val) => val === 'true' || val === true || val === '1',
    z.boolean()
  ).default(false),

  MQTT_BROKER_URL: z.string().default('mqtt://localhost:1883'),

  MQTT_USERNAME: z.string().optional(),

  MQTT_PASSWORD: z.string().optional(),

  MQTT_CLIENT_ID: z.string().default('savebite-backend-subscriber'),

  MQTT_TELEMETRY_TOPIC: z.string().default('savebite/+/+/telemetry'),

  // Configurable Operational Sensor Thresholds (Non-AI preliminary notifications)
  TEMP_HIGH_ALERT_C: z.coerce.number().default(10.0),
  TEMP_LOW_ALERT_C: z.coerce.number().default(-2.0),
  AIR_QUALITY_ALERT_RAW: z.coerce.number().default(400.0),

  // Phase 3: AI Service, Receipts Storage & Barcode Configuration
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  SUPABASE_RECEIPTS_BUCKET: z.string().default('receipts'),
  RECEIPT_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(10),
  RECEIPT_AUTO_CREATE_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.85),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  OPEN_FOOD_FACTS_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

  // Phase 4: Scheduler & Intelligence Configuration
  SCHEDULER_ENABLED: z.preprocess(
    (val) => val === 'true' || val === true || val === '1',
    z.boolean()
  ).default(isTest ? false : true),
  SCHEDULER_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  USE_FIRST_ALERT_THRESHOLD: z.coerce.number().min(0).max(100).default(70),
  SHELF_LIFE_ALERT_THRESHOLD_DAYS: z.coerce.number().min(0).default(2.0)
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
