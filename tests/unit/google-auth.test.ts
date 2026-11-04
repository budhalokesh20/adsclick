import { generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { verifyGoogleIdToken } from '../../src/services/google/google-auth.service.js';
import { env } from '../../src/config/env.js';

// We override env at runtime for this test (module reads env lazily).
describe('google auth', () => {
  it('errors when GOOGLE_CLIENT_ID is not configured', async () => {
    const prev = env.GOOGLE_CLIENT_ID;
    // @ts-expect-error force-unset for test
    delete env.GOOGLE_CLIENT_ID;
    await expect(verifyGoogleIdToken('abc')).rejects.toThrow(/GOOGLE_CLIENT_ID/);
    // @ts-expect-error restore
    env.GOOGLE_CLIENT_ID = prev;
  });

  it('rejects malformed tokens', async () => {
    // @ts-expect-error force-set for test
    env.GOOGLE_CLIENT_ID = 'test-client-id';
    await expect(verifyGoogleIdToken('not-a-jwt')).rejects.toThrow();
  });
});
