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
    where: { key: 'referral_signup_bonus' },
    update: { value: 1 },
    create: { key: 'referral_signup_bonus', value: 1, valueType: 'NUMBER', isPublic: true },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'referral_first_impression_reward' },
    update: { value: 0.5 },
    create: { key: 'referral_first_impression_reward', value: 0.5, valueType: 'NUMBER', isPublic: true },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'referral_reward_currency' },
    update: { value: 'USD' },
    create: { key: 'referral_reward_currency', value: 'USD', valueType: 'STRING', isPublic: true },
  });

  const provider = await prisma.advertisingProvider.upsert({
    where: { code: 'mock' },
    update: { config: { creatives: ['ad-001', 'ad-002'] } },
    create: { code: 'mock', name: 'Mock Ad Provider', sandbox: true, config: { creatives: ['ad-001', 'ad-002'] } },
  });
  await prisma.advertisingCampaign.upsert({
    where: { providerId_externalCampaignId: { providerId: provider.id, externalCampaignId: 'mock-campaign-001' } },
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

async function registerAndVerify(email: string) {
  const reg = await request(app).post('/api/v1/auth/register').send({ email, password });
  expect(reg.status).toBe(201);
  const token = await signEmailToken(reg.body.user.id, 'email_verify');
  const verify = await request(app).post('/api/v1/auth/verify-email').send({ token });
  expect(verify.status).toBe(200);
  return reg.body as {
    user: { id: string; referralCode: string | null };
    accessToken: string;
  };
}

describe('referrals', () => {
  let referrer: Awaited<ReturnType<typeof registerAndVerify>>;
  let referred: Awaited<ReturnType<typeof registerAndVerify>>;

  beforeAll(async () => {
    await ensureMockFixtures();
    referrer = await registerAndVerify('referrer@example.com');
    referred = await registerAndVerify('referred@example.com');
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('summary shows the code and zero referrals initially', async () => {
    const res = await request(app).get('/api/v1/referrals/summary').set(auth(referrer.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(res.body.invitedCount).toBe(0);
    expect(res.body.confirmedCount).toBe(0);
    expect(res.body.rewardsTotal).toBe('0');
  });

  it('registering with an unknown/invalid referral code is safely ignored', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'unknowncode@example.com',
      password,
      referralCode: 'ZZZZ9999',
    });
    expect(res.status).toBe(201);

    const rel = await prisma.referralRelationship.findFirst({
      where: { referredUserId: res.body.user.id },
    });
    expect(rel).toBeNull();

    // Cleanup: the user is irrelevant for the rest.
    await prisma.user.update({ where: { id: res.body.user.id }, data: { deletedAt: new Date(), status: 'CLOSED' } });
  });

  it('referring a user pays the bonus only after confirmation', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      email: 'friend@example.com',
      password,
      referralCode: referrer.user.referralCode,
    });
    expect(reg.status).toBe(201);
    const friendId = reg.body.user.id as string;

    // Pending until verified — no bonus yet.
    let rel = await prisma.referralRelationship.findFirst({ where: { referredUserId: friendId } });
    expect(rel).not.toBeNull();
    expect(rel!.status).toBe('PENDING');

    const before = await request(app).get('/api/v1/wallet').set(auth(referrer.accessToken));
    expect(before.body.balanceAvailable).toBe('0');

    const token = await signEmailToken(friendId, 'email_verify');
    await request(app).post('/api/v1/auth/verify-email').send({ token });

    rel = await prisma.referralRelationship.findFirst({ where: { referredUserId: friendId } });
    expect(rel!.status).toBe('CONFIRMED');

    const after = await request(app).get('/api/v1/wallet').set(auth(referrer.accessToken));
    expect(Number(after.body.balanceAvailable)).toBeCloseTo(1, 6);

    // Summary reflects it.
    const summary = await request(app).get('/api/v1/referrals/summary').set(auth(referrer.accessToken));
    expect(summary.body.confirmedCount).toBe(1);
    expect(Number(summary.body.rewardsTotal)).toBeCloseTo(1, 6);
  });

  it('first verified impression of a referred user pays the impression reward once', async () => {
    const enable = await request(app).post('/api/v1/earning/enable').set(auth(referred.accessToken));
    expect(enable.body.status).toBe('ACTIVE');

    const report = (ad: string) =>
      request(app)
        .post('/api/v1/advertisements/events')
        .set(auth(referred.accessToken))
        .send({
          eventUuid: randomUUID(),
          provider: 'mock',
          campaignExternalId: 'mock-campaign-001',
          advertisementExternalId: ad,
          eventType: 'IMPRESSION',
          occurredAt: new Date().toISOString(),
        });

    // Referred user was not referred via a code (registered without one), so
    // we create the relationship explicitly to exercise the hook.
    await prisma.referralRelationship.create({
      data: {
        referrerUserId: referrer.user.id,
        referredUserId: referred.user.id,
        codeUsed: referrer.user.referralCode!,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });

    await report('ad-001');
    await report('ad-002');

    const rewards = await prisma.referralReward.findMany({
      where: { relationship: { referrerUserId: referrer.user.id }, rewardType: 'FIRST_VERIFIED_IMPRESSION' },
    });
    expect(rewards.length).toBe(1);
    expect(Number(rewards[0]!.amount)).toBeCloseTo(0.5, 6);

    const wallet = await request(app).get('/api/v1/wallet').set(auth(referrer.accessToken));
    expect(Number(wallet.body.balanceAvailable)).toBeCloseTo(1.5, 6);
  });

  it('history lists referred users with masked emails and rewards', async () => {
    const res = await request(app).get('/api/v1/referrals/history').set(auth(referrer.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    const entry = res.body.data.find((r: { referredEmail: string }) => r.referredEmail.includes('•••'));
    expect(entry).toBeDefined();
    expect(entry.rewards.length).toBeGreaterThanOrEqual(1);
  });
});
