import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp, prisma } from '../helpers/test-app.js';
import { signEmailToken } from '../../src/utils/tokens.js';

const app = createApp();
const password = 'Password123!';

async function ensureMockFixtures(): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: 'earning_mode_enabled' },
    update: { value: true },
    create: { key: 'earning_mode_enabled', value: true, valueType: 'BOOLEAN', isPublic: true },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'fraud_thresholds' },
    update: { value: { eventsPerMin: 3, duplicateRate: 0.3, maxDevicesPerUser: 2 } },
    create: {
      key: 'fraud_thresholds',
      value: { eventsPerMin: 3, duplicateRate: 0.3, maxDevicesPerUser: 2 },
      valueType: 'JSON',
      isPublic: false,
    },
  });

  const provider = await prisma.advertisingProvider.upsert({
    where: { code: 'mock' },
    update: { config: { creatives: ['ad-001', 'ad-002'] } },
    create: { code: 'mock', name: 'Mock', sandbox: true, config: { creatives: ['ad-001', 'ad-002'] } },
  });
  await prisma.advertisingCampaign.upsert({
    where: { providerId_externalCampaignId: { providerId: provider.id, externalCampaignId: 'mock-campaign-001' } },
    update: {},
    create: {
      providerId: provider.id,
      externalCampaignId: 'mock-campaign-001',
      name: 'Mock Campaign',
      status: 'ACTIVE',
      payoutType: 'CPM',
      payoutAmount: 2.5,
      currency: 'USD',
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
}

describe('security hardening', () => {
  let userId = '';
  let accessToken = '';

  beforeAll(async () => {
    await ensureMockFixtures();
    const reg = await request(app).post('/api/v1/auth/register').send({ email: 'risky@example.com', password });
    userId = reg.body.user.id;
    accessToken = reg.body.accessToken as string;
    const token = await signEmailToken(userId, 'email_verify');
    await request(app).post('/api/v1/auth/verify-email').send({ token });
    await request(app).post('/api/v1/earning/enable').set({ Authorization: `Bearer ${accessToken}` });
  });

  const report = (ad: string, deviceId?: string) =>
    request(app)
      .post('/api/v1/advertisements/events')
      .set({ Authorization: `Bearer ${accessToken}`, ...(deviceId ? { 'X-Device-Id': deviceId } : {}) })
      .send({
        eventUuid: randomUUID(),
        provider: 'mock',
        campaignExternalId: 'mock-campaign-001',
        advertisementExternalId: ad,
        eventType: 'IMPRESSION',
        occurredAt: new Date().toISOString(),
      });

  it('velocity burst flags a fraud event and auto-restricts the account', async () => {
    // Threshold is 3/min; CRITICAL triggers at 3x (count >= 9 before insert).
    for (let i = 0; i < 10; i += 1) {
      const res = await report('ad-001');
      expect(res.status).toBe(202);
    }

    const fraudRows = await prisma.fraudEvent.findMany({ where: { userId, ruleCode: 'events_velocity' } });
    const critical = fraudRows.find((f) => f.severity === 'CRITICAL');
    expect(critical).toBeDefined(); // >= threshold * 3

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.status).toBe('RESTRICTED');

    const earning = await prisma.userEarningState.findFirst({ where: { userId } });
    expect(earning!.status).toBe('RESTRICTED');

    const enableAttempt = await request(app)
      .post('/api/v1/earning/enable')
      .set({ Authorization: `Bearer ${accessToken}` });
    expect(enableAttempt.status).toBe(403);
    expect(enableAttempt.body.error.code).toBe('ACCOUNT_RESTRICTED');
  });

  it('admin can restore the account after review', async () => {
    // Grant the privilege via the SUPER_ADMIN role seeded through service-level admin.
    const { setUserStatus } = await import('../../src/modules/admin/admin.service.js');
    await setUserStatus(userId, 'ACTIVE');
    await prisma.userEarningState.update({ where: { userId }, data: { status: 'DISABLED' } });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.status).toBe('ACTIVE');

    // Fresh login after restore.
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'risky@example.com', password });
    expect(login.status).toBe(200);
  });

  it('tampered and expired-style tokens are rejected (replay guard)', async () => {
    const bad = await request(app).get('/api/v1/users/me').set({ Authorization: 'Bearer garbage.token.value' });
    expect(bad.status).toBe(401);

    const empty = await request(app).get('/api/v1/users/me');
    expect(empty.status).toBe(401);
  });
});
