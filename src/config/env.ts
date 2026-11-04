import 'dotenv/config';
import { z } from 'zod';

const boolFromEnv = z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  APP_ENC_KEY: z.string().min(32),
  CORS_ORIGINS: z.string().default('*'),
  TRUST_PROXY: boolFromEnv.default(false),
  RATE_LIMIT_ENABLED: boolFromEnv.default(true),
  ADMIN_SEED_EMAIL: z.string().email().default('admin@adshare.local'),
  ADMIN_SEED_PASSWORD: z.string().min(8).default('ChangeMe123!'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_ID_ANDROID: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', JSON.stringify(parsed.error.flatten(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
