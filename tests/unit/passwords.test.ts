import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/utils/passwords.js';

describe('passwords', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('S3cure!Pass');
    expect(hash).not.toContain('S3cure!Pass');
    await expect(verifyPassword(hash, 'S3cure!Pass')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false);
  });

  it('produces distinct hashes for the same password', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
});
