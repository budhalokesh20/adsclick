import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../helpers/test-app.js';

const app = createApp();
const email = 'bob@example.com';
const password = 'Password123!';

describe('users module', () => {
  let accessToken = '';

  beforeAll(async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email, password, fullName: 'Bob' });
    expect(res.status).toBe(201);
    accessToken = res.body.accessToken;
  });

  it('updates profile', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ fullName: 'Robert', countryCode: 'US', notificationPrefs: { earnings: false } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fullName: 'Robert', countryCode: 'US' });
    expect(res.body.notificationPrefs.earnings).toBe(false);
  });

  it('changes password and rejects wrong current password', async () => {
    const bad = await request(app)
      .patch('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'wrong', newPassword: 'AnotherPass123!' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CURRENT_PASSWORD');

    const ok = await request(app)
      .patch('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: password, newPassword: 'AnotherPass123!' });
    expect(ok.status).toBe(204);

    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'AnotherPass123!' });
    expect(login.status).toBe(200);
  });

  it('soft-deletes the account on DELETE /users/me', async () => {
    const res = await request(app).delete('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(204);

    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'AnotherPass123!' });
    expect(login.status).toBe(401);
  });
});
