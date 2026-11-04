/**
 * Per-test-file setup. Runs before app modules are imported.
 * The database itself is bootstrapped once in tests/global-setup.ts
 * (single worker process), and its URL is inherited here.
 */
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-only-access-secret-0123456789abcdefghijklmnopqrstuv';
process.env.APP_ENC_KEY = process.env.APP_ENC_KEY ?? 'test-only-encryption-key-0123456789abcdef';

export {};
