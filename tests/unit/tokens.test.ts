import { describe, expect, it } from 'vitest';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/utils/tokens.js';

describe('tokens', () => {
  it('signs and verifies an access token', async () => {
    const token = await signAccessToken({ userId: 'u1', sessionId: 's1', deviceId: 'd1' });
    const claims = await verifyAccessToken(token);
    expect(claims).toMatchObject({ userId: 'u1', sessionId: 's1', deviceId: 'd1' });
  });

  it('rejects tampered tokens', async () => {
    const token = await signAccessToken({ userId: 'u1', sessionId: 's1' });
    const tampered = token.slice(0, -4) + 'AAAA';
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });

  it('refresh tokens are random and hashed', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(hashRefreshToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
    expect(hashRefreshToken(a)).not.toBe(hashRefreshToken(b));
  });
});
