import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '../../src/modules/auth/auth.schemas.js';

describe('auth schemas', () => {
  it('accepts a valid registration', () => {
    const parsed = registerSchema.parse({
      email: 'user@example.com',
      password: 'password123',
      referralCode: 'ABC12345',
    });
    expect(parsed.email).toBe('user@example.com');
  });

  it('rejects weak passwords', () => {
    expect(() => registerSchema.parse({ email: 'a@b.co', password: 'short' })).toThrow();
  });

  it('rejects malformed referral codes', () => {
    expect(() =>
      registerSchema.parse({ email: 'a@b.co', password: 'password123', referralCode: 'bad code!' }),
    ).toThrow();
  });

  it('rejects invalid emails', () => {
    expect(() => loginSchema.parse({ email: 'nope', password: 'whatever123' })).toThrow();
  });
});
