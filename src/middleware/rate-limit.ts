import { rateLimit } from 'express-rate-limit';
import { Redis } from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

type Limiter = ReturnType<typeof rateLimit>;
type Passthrough = (_req: unknown, _res: unknown, next: () => void) => void;

function buildLimiter(options: { windowMs: number; limit: number }): Limiter | Passthrough {
  if (!env.RATE_LIMIT_ENABLED) {
    return (_req: unknown, _res: unknown, next: () => void) => next();
  }

  try {
    const redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    return rateLimit({
      windowMs: options.windowMs,
      limit: options.limit,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendCommand: (...args: string[]) => (redis as any).call(...args) as Promise<any>,
        prefix: `rl:${env.NODE_ENV}:`,
      }),
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    });
  } catch (err) {
    logger.warn({ err }, 'Redis rate-limit unavailable, falling back to in-memory');
    return rateLimit({
      windowMs: options.windowMs,
      limit: options.limit,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    });
  }
}

/** Strict limiter for authentication endpoints (10 requests/minute/IP). */
export const authLimiter = buildLimiter({ windowMs: 60_000, limit: 10 });

/** General API limiter (300 requests/minute/IP). */
export const apiLimiter = buildLimiter({ windowMs: 60_000, limit: 300 });

/** Admin limiter (120 requests/minute/admin). */
export const adminLimiter = buildLimiter({ windowMs: 60_000, limit: 120 });
