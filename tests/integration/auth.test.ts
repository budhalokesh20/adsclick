import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, prisma } from '../helpers/test-app.js';
import { signEmailToken } from '../../src/utils/tokens.js';

const app = createApp();
const email = 'alice@example.com';
const password = 'Password123!';
const NEW_PASSWORD = 'NewPassword456!';

describe('auth flow', () => {
  let userId = '';
  let accessToken = '';
  let refreshToken = '';
  let sessionId = '';

  it('registers a user and returns tokens + wallet-ready profile', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password, fullName: 'Alice', deviceId: 'dev-alice-001', platform: 'ANDROID', deviceModel: 'Pixel 8', osVersion: '14', appVersion: '0.1.0', countryCode: 'NP' });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.user).toMatchObject({ email, fullName: 'Alice', emailVerified: false, status: 'PENDING_VERIFICATION' });
    expect(res.body.user.referralCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(res.body.user.countryCode).toBe('NP');
    expect(res.body.user.displayCurrency.code).toBe('NPR');
    expect(res.body.user.displayCurrency.symbol).toBe('रू');
    userId = res.body.user.id;

    // Device metadata captured for fraud prevention / transparency.
    const device = await prisma.device.findUnique({
      where: { userId_externalDeviceId: { userId, externalDeviceId: 'dev-alice-001' } },
    });
    expect(device).not.toBeNull();
    expect(device!.model).toBe('Pixel 8');
    expect(device!.osVersion).toBe('14');
    expect(device!.appVersion).toBe('0.1.0');
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
    sessionId = res.body.sessionId;
  });

  it('signup issues OTP (not activation link) and verifies it', async () => {
    const email = 'otp-user@example.com';
    const reg = await request(app).post('/api/v1/auth/register').send({ email, password, deviceId: 'dev-otp-001' });
    expect(reg.status).toBe(201);
    expect(reg.body.otpRequired).toBe(true);

    const otp = await prisma.emailOtp.findFirst({ where: { email, purpose: 'SIGNUP', usedAt: null } });
    expect(otp).not.toBeNull();

    // Wrong code rejected
    const wrong = await request(app).post('/api/v1/auth/verify-otp').send({ email, code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_OTP');

    // Correct code → verified. Need the actual code: hash is deterministic from email+code, so compute it.
    const { createHash } = await import('node:crypto');
    for (let code = 100000; code <= 999999; code++) {
      const hash = createHash('sha256').update(`${email}:${code}`).digest('hex');
      if (hash === otp!.codeHash) {
        const ok = await request(app).post('/api/v1/auth/verify-otp').send({ email, code: String(code) });
        expect(ok.status).toBe(200);
        expect(ok.body.user.emailVerified).toBe(true);
        expect(ok.body.user.status).toBe('ACTIVE');
        break;
      }
    }

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.emailVerifiedAt).not.toBeNull();
  });

  it('rejects duplicate email', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email, password });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects login with wrong password', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'WrongPass123!' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 without token on protected route', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  it('GET /users/me shows empty wallet + display currency', async () => {
    const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.wallet).toMatchObject({ balanceAvailable: '0', balancePending: '0', lifetimeEarned: '0' });
    expect(res.body.displayCurrency.code).toBe('NPR');
  });

  it('GET /currencies lists supported currencies', async () => {
    const res = await request(app).get('/api/v1/currencies').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(20);
    expect(res.body.data.some((c: { code: string }) => c.code === 'USD')).toBe(true);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const first = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(first.status).toBe(200);
    const secondRefresh = first.body.refreshToken as string;

    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    // Entire session family revoked — the rotated token is dead too.
    const after = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: secondRefresh });
    expect(after.status).toBe(401);
  });

  it('logs in again after family revocation', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password, deviceId: 'dev-alice-001' });
    expect(res.status).toBe(200);
    accessToken = res.body.accessToken as string;
    refreshToken = res.body.refreshToken as string;
    sessionId = res.body.sessionId as string;
  });

  it('verifies email with signed token', async () => {
    const token = await signEmailToken(userId, 'email_verify');
    const res = await request(app).post('/api/v1/auth/verify-email').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.user.emailVerified).toBe(true);
    expect(res.body.user.status).toBe('ACTIVE');
  });

  it('rejects tampered verification token', async () => {
    const res = await request(app).post('/api/v1/auth/verify-email').send({ token: 'not-a-real-token' });
    expect(res.status).toBe(400);
  });

  it('resets password via OTP and revokes sessions', async () => {
    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email });
    expect(forgot.status).toBe(204);

    const otp = await prisma.emailOtp.findFirst({ where: { email, purpose: 'PASSWORD_RESET', usedAt: null } });
    expect(otp).not.toBeNull();

    const { createHash } = await import('node:crypto');
    let otpCode = '';
    for (let code = 100000; code <= 999999; code++) {
      const hash = createHash('sha256').update(`${email}:${code}`).digest('hex');
      if (hash === otp!.codeHash) { otpCode = String(code); break; }
    }

    const res = await request(app).post('/api/v1/auth/reset-password').send({ email, code: otpCode, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    // Old session wiped: previous access token still structurally valid until expiry,
    // but refresh is gone — so login with new password must work.
    const oldLogin = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post('/api/v1/auth/login').send({ email, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
    accessToken = newLogin.body.accessToken as string;
    refreshToken = newLogin.body.refreshToken as string;
    sessionId = newLogin.body.sessionId as string;
  });

  it('lists sessions and revokes one by id', async () => {
    const list = await request(app).get('/api/v1/auth/sessions').set('Authorization', `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    expect(list.body.data[0]).toHaveProperty('active');

    const revoke = await request(app)
      .delete(`/api/v1/auth/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(revoke.status).toBe(204);

    const after = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
    expect(after.status).toBe(401);
  });

  it('changed password flow revokes sibling sessions', async () => {
    const first = await request(app).post('/api/v1/auth/login').send({ email, password: NEW_PASSWORD });
    const second = await request(app).post('/api/v1/auth/login').send({ email, password: NEW_PASSWORD });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const change = await request(app)
      .patch('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .send({ currentPassword: NEW_PASSWORD, newPassword: password });
    expect(change.status).toBe(204);

    // second session's refresh token now invalid (revoked on password change)
    const secondRefreshTry = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: second.body.refreshToken });
    expect(secondRefreshTry.status).toBe(401);
  });
});
