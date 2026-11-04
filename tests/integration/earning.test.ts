import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../helpers/test-app.js';
import { createApp } from '../helpers/test-app.js';
import { signEmailToken } from '../../src/utils/tokens.js';

const app = createApp();
const email = 'earner@example.com';
const password = 'Password123!';

async function ensureMockFixtures(): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: 'earning_mode_enabled' },
    update: { value: true },
    create: { key: 'earning_mode_enabled', value: true, valueType: 'BOOLEAN', isPublic: true },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'overlay_approved' },
    update: { value: false },
    create: { key: 'overlay_approved', value: false, valueType: 'BOOLEAN', isPublic: false },
  });

  const provider = await prisma.advertisingProvider.upsert({
    where: { code: 'mock' },
    update: { config: { creatives: ['ad-001', 'ad-002', 'ad-003'] } },
    create: {
      code: 'mock',
      name: 'Mock Ad Provider',
      sandbox: true,
      config: { creatives: ['ad-001', 'ad-002', 'ad-003'] },
    },
  });

  await prisma.advertisingCampaign.upsert({
    where: {
      providerId_externalCampaignId: { providerId: provider.id, externalCampaignId: 'mock-campaign-001' },
    },
    update: {},
    create: {
      providerId: provider.id,
      externalCampaignId: 'mock-campaign-001',
      name: 'Mock CPM Campaign',
      status: 'ACTIVE',
      payoutType: 'CPM',
      payoutAmount: 2.5,
      currency: 'USD',
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
}

describe('earning engine', () => {
  let userId = '';
  let accessToken = '';

  beforeAll(async () => {
    await ensureMockFixtures();
    const reg = await request(app).post('/api/v1/auth/register').send({ email, password });
    expect(reg.status).toBe(201);
    userId = reg.body.user.id;
    accessToken = reg.body.accessToken as string;

    const token = await signEmailToken(userId, 'email_verify');
    const verify = await request(app).post('/api/v1/auth/verify-email').send({ token });
    expect(verify.status).toBe(200);
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('status starts DISABLED but configured', async () => {
    const res = await request(app).get('/api/v1/earning/status').set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'DISABLED', configured: true });
    expect(res.body.capabilities).toMatchObject({ mode: 'IN_APP', overlayApproved: false, provider: 'mock' });
  });

  it('enable → ACTIVE, then available returns a mock ad', async () => {
    const enable = await request(app).post('/api/v1/earning/enable').set(auth(accessToken));
    expect(enable.status).toBe(200);
    expect(enable.body.status).toBe('ACTIVE');

    const ad = await request(app).get('/api/v1/advertisements/available').set(auth(accessToken));
    expect(ad.status).toBe(200);
    expect(ad.body).toMatchObject({
      provider: 'mock',
      campaignExternalId: 'mock-campaign-001',
    });
    expect(['ad-001', 'ad-002', 'ad-003']).toContain(ad.body.advertisementExternalId);
  });

  it('verified impression records revenue and commits it to the ledger', async () => {
    const eventUuid = randomUUID();
    const res = await request(app)
      .post('/api/v1/advertisements/events')
      .set(auth(accessToken))
      .send({
        eventUuid,
        provider: 'mock',
        campaignExternalId: 'mock-campaign-001',
        advertisementExternalId: 'ad-001',
        eventType: 'IMPRESSION',
        occurredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ accepted: true, validationStatus: 'VERIFIED', duplicate: false });

    const impression = await prisma.verifiedImpression.findFirst({
      where: { userId },
      include: { allocation: true },
    });
    expect(impression).not.toBeNull();
    expect(Number(impression!.revenueGross)).toBeCloseTo(0.0025, 6);
    expect(impression!.settlementStatus).toBe('ALLOCATED');
    expect(impression!.allocation).not.toBeNull();
    expect(Number(impression!.allocation!.userAmount)).toBeCloseTo(0.0015, 6);

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(Number(wallet!.balanceAvailable)).toBeCloseTo(0.0015, 6);
  });

  it('duplicate event UUID is idempotent', async () => {
    const first = await prisma.verifiedImpression.count({ where: { userId } });

    const eventUuid = randomUUID();
    await request(app)
      .post('/api/v1/advertisements/events')
      .set(auth(accessToken))
      .send({
        eventUuid,
        provider: 'mock',
        campaignExternalId: 'mock-campaign-001',
        advertisementExternalId: 'ad-002',
        eventType: 'IMPRESSION',
        occurredAt: new Date().toISOString(),
      });
    // Replay the exact same event.
    const replay = await request(app)
      .post('/api/v1/advertisements/events')
      .set(auth(accessToken))
      .send({
        eventUuid,
        provider: 'mock',
        campaignExternalId: 'mock-campaign-001',
        advertisementExternalId: 'ad-002',
        eventType: 'IMPRESSION',
        occurredAt: new Date().toISOString(),
      });
    expect(replay.status).toBe(202);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.validationStatus).toBe('VERIFIED');

    const after = await prisma.verifiedImpression.count({ where: { userId } });
    expect(after).toBe(first + 1);
  });

  it('rejects unknown campaigns without creating revenue', async () => {
    const res = await request(app)
      .post('/api/v1/advertisements/events')
      .set(auth(accessToken))
      .send({
        eventUuid: randomUUID(),
        provider: 'mock',
        campaignExternalId: 'no-such-campaign',
        advertisementExternalId: 'ad-001',
        eventType: 'IMPRESSION',
        occurredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(202);
    expect(res.body.validationStatus).toBe('REJECTED');
    expect(res.body.accepted).toBe(true);
  });

  it('pause blocks ad delivery until resume', async () => {
    const pause = await request(app).post('/api/v1/earning/pause').set(auth(accessToken));
    expect(pause.status).toBe(200);
    expect(pause.body.status).toBe('PAUSED');

    const blocked = await request(app).get('/api/v1/advertisements/available').set(auth(accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('EARNING_NOT_ACTIVE');

    const resume = await request(app).post('/api/v1/earning/resume').set(auth(accessToken));
    expect(resume.status).toBe(200);
    expect(resume.body.status).toBe('ACTIVE');
  });

  it('disable prevents enabling from a restricted account', async () => {
    const disable = await request(app).post('/api/v1/earning/disable').set(auth(accessToken));
    expect(disable.status).toBe(200);
    expect(disable.body.status).toBe('DISABLED');

    await prisma.user.update({ where: { id: userId }, data: { status: 'RESTRICTED' } });
    const denied = await request(app).post('/api/v1/earning/enable').set(auth(accessToken));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ACCOUNT_RESTRICTED');

    await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    const reenable = await request(app).post('/api/v1/earning/enable').set(auth(accessToken));
    expect(reenable.status).toBe(200);
    expect(reenable.body.status).toBe('ACTIVE');
  });

  it('earning history lists events', async () => {
    const res = await request(app).get('/api/v1/earning/history').set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toHaveProperty('eventType');
  });
});
