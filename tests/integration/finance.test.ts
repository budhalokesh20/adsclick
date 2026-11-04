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
    where: { key: 'min_withdrawal_amount' },
    update: { value: 0.001 },
    create: { key: 'min_withdrawal_amount', value: 0.001, valueType: 'NUMBER', isPublic: true },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'withdrawal_fee_flat' },
    update: { value: 0 },
    create: { key: 'withdrawal_fee_flat', value: 0, valueType: 'NUMBER', isPublic: true },
  });

  const provider = await prisma.advertisingProvider.upsert({
    where: { code: 'mock' },
    update: { config: { creatives: ['ad-001', 'ad-002'] } },
    create: { code: 'mock', name: 'Mock Ad Provider', sandbox: true, config: { creatives: ['ad-001', 'ad-002'] } },
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

const USER_SHARE = 0.0025 * 0.6; // 60% of 2.50/1000

describe('finance: allocation, ledger, withdrawals', () => {
  let userId = '';
  let accessToken = '';
  let adminId = '';

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  const reportImpression = async (ad: string, uuid?: string) => {
    const res = await request(app)
      .post('/api/v1/advertisements/events')
      .set(auth())
      .send({
        eventUuid: uuid ?? randomUUID(),
        provider: 'mock',
        campaignExternalId: 'mock-campaign-001',
        advertisementExternalId: ad,
        eventType: 'IMPRESSION',
        occurredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(202);
    expect(res.body.validationStatus).toBe('VERIFIED');
  };

  const walletOf = async () => {
    const res = await request(app).get('/api/v1/wallet').set(auth());
    expect(res.status).toBe(200);
    return res.body as {
      balanceAvailable: string;
      balancePending: string;
      lifetimeEarned: string;
      totalWithdrawn: string;
      currency: string;
    };
  };

  beforeAll(async () => {
    await ensureMockFixtures();
    const reg = await request(app).post('/api/v1/auth/register').send({
      email: 'finance@example.com',
      password,
    });
    userId = reg.body.user.id;
    accessToken = reg.body.accessToken as string;
    const token = await signEmailToken(userId, 'email_verify');
    await request(app).post('/api/v1/auth/verify-email').send({ token });
    await request(app).post('/api/v1/earning/enable').set(auth());

    const admin = await prisma.adminUser.create({
      data: { email: 'admin@test.dev', passwordHash: 'x', name: 'Test Admin' },
    });
    adminId = admin.id;
  });

  it('a verified impression credits 60% of the CPM share instantly', async () => {
    await reportImpression('ad-001');
    const wallet = await walletOf();
    expect(Number(wallet.balanceAvailable)).toBeCloseTo(USER_SHARE, 6);
    expect(Number(wallet.lifetimeEarned)).toBeCloseTo(USER_SHARE, 6);
    expect(Number(wallet.balancePending)).toBe(0);
  });

  it('ledger matches wallet (transaction rows sum to balance)', async () => {
    const ledger = await request(app).get('/api/v1/wallet/transactions').set(auth());
    expect(ledger.status).toBe(200);
    const rows = ledger.body.data as Array<{ direction: string; amount: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);

    let sum = 0;
    for (const row of rows) {
      sum += row.direction === 'CREDIT' ? Number(row.amount) : -Number(row.amount);
    }
    const wallet = await walletOf();
    expect(Number(wallet.balanceAvailable)).toBeCloseTo(sum, 6);
  });

  it('duplicate event does not double-credit', async () => {
    const before = Number((await walletOf()).balanceAvailable);
    const uuid = randomUUID();
    await reportImpression('ad-001', uuid);

    const afterFirst = Number((await walletOf()).balanceAvailable);
    expect(afterFirst).toBeCloseTo(before + USER_SHARE, 6);

    // replay same uuid
    const replay = await request(app)
      .post('/api/v1/advertisements/events')
      .set(auth())
      .send({
        eventUuid: uuid,
        provider: 'mock',
        campaignExternalId: 'mock-campaign-001',
        advertisementExternalId: 'ad-001',
        eventType: 'IMPRESSION',
        occurredAt: new Date().toISOString(),
      });
    expect(replay.body.duplicate).toBe(true);

    const afterReplay = Number((await walletOf()).balanceAvailable);
    expect(afterReplay).toBeCloseTo(afterFirst, 6);
  });

  it('concurrent impressions keep the wallet consistent', async () => {
    const before = Number((await walletOf()).balanceAvailable);
    const N = 5;
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        request(app)
          .post('/api/v1/advertisements/events')
          .set(auth())
          .send({
            eventUuid: randomUUID(),
            provider: 'mock',
            campaignExternalId: 'mock-campaign-001',
            advertisementExternalId: 'ad-002',
            eventType: 'IMPRESSION',
            occurredAt: new Date().toISOString(),
          }),
      ),
    );
    for (const r of responses) {
      if (r.status !== 202) console.log('DEBUG CONCURRENT BODY:', r.status, JSON.stringify(r.body));
    }

    const after = Number((await walletOf()).balanceAvailable);
    expect(after).toBeCloseTo(before + N * USER_SHARE, 6);

    // Ledger reconciliation still exact.
    const ledger = await request(app).get('/api/v1/wallet/transactions?limit=100').set(auth());
    let sum = 0;
    for (const row of ledger.body.data as Array<{ direction: string; amount: string }>) {
      sum += row.direction === 'CREDIT' ? Number(row.amount) : -Number(row.amount);
    }
    expect(after).toBeCloseTo(sum, 6);
  });

  it('withdrawal holds funds, then pay settles them', async () => {
    const method = await request(app)
      .post('/api/v1/withdrawals/methods')
      .set(auth())
      .send({ label: 'Test account', providerType: 'MOCK', accountDetails: { iban: 'MOCK-1' } });
    expect(method.status).toBe(201);
    const methodId = method.body.id as string;

    const walletBefore = await walletOf();
    const withdrawAmount = (Number(walletBefore.balanceAvailable) / 2).toFixed(6);

    const created = await request(app)
      .post('/api/v1/withdrawals')
      .set(auth())
      .send({ amount: withdrawAmount, currency: 'USD', paymentMethodId: methodId });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('PENDING');
    const requestId = created.body.id as string;

    const held = await walletOf();
    expect(Number(held.balanceAvailable)).toBeCloseTo(Number(walletBefore.balanceAvailable) - Number(withdrawAmount), 6);
    expect(Number(held.balancePending)).toBeCloseTo(Number(withdrawAmount), 6);

    // Admin transitions (service-level in this phase; HTTP admin routes arrive in Phase 7).
    const { adminReview, adminApprove, adminProcess, adminPay } = await import('../../src/modules/withdrawals/withdrawals.service.js');
    await adminReview(requestId, adminId);
    await adminApprove(requestId, adminId);
    await adminProcess(requestId, adminId);
    await adminPay(requestId, adminId);

    const paid = await request(app).get(`/api/v1/withdrawals/${requestId}`).set(auth());
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.paidAt).not.toBeNull();

    const afterPay = await walletOf();
    expect(Number(afterPay.balancePending)).toBeCloseTo(0, 6);
    expect(Number(afterPay.totalWithdrawn)).toBeCloseTo(Number(withdrawAmount), 6);
  });

  it('rejected withdrawals release the hold', async () => {
    const walletBefore = await walletOf();

    const created = await request(app)
      .post('/api/v1/withdrawals')
      .set(auth())
      .send({ amount: (Number(walletBefore.balanceAvailable) / 2).toFixed(6), currency: 'USD' });
    expect(created.status).toBe(201);
    const requestId = created.body.id as string;

    const { adminReject } = await import('../../src/modules/withdrawals/withdrawals.service.js');
    await adminReject(requestId, adminId, 'test rejection');

    const walletAfter = await walletOf();
    expect(Number(walletAfter.balanceAvailable)).toBeCloseTo(Number(walletBefore.balanceAvailable), 6);
    expect(Number(walletAfter.balancePending)).toBeCloseTo(0, 6);

    const detail = await request(app).get(`/api/v1/withdrawals/${requestId}`).set(auth());
    expect(detail.body.status).toBe('REJECTED');
    expect(detail.body.note).toBe('test rejection');
  });

  it('tax percentage reduces the payout net', async () => {
    await prisma.systemSetting.upsert({
      where: { key: 'withdrawal_tax_pct' },
      update: { value: 10 },
      create: { key: 'withdrawal_tax_pct', value: 10, valueType: 'NUMBER', isPublic: true },
    });

    const walletBefore = await walletOf();
    const created = await request(app)
      .post('/api/v1/withdrawals')
      .set(auth())
      .send({ amount: '0.001000', currency: 'USD' });
    expect(created.status).toBe(201);
    const requestId = created.body.id as string;

    const { adminApprove, adminPay, adminProcess, adminReview } = await import('../../src/modules/withdrawals/withdrawals.service.js');
    await adminReview(requestId, adminId);
    await adminApprove(requestId, adminId);
    await adminProcess(requestId, adminId);
    await adminPay(requestId, adminId);

    const detail = await request(app).get(`/api/v1/withdrawals/${requestId}`).set(auth());
    expect(Number(detail.body.net)).toBeCloseTo(0.0009, 6);

    const after = await walletOf();
    expect(Number(after.totalWithdrawn)).toBeCloseTo(Number(walletBefore.totalWithdrawn) + 0.0009, 6);

    await prisma.systemSetting.update({ where: { key: 'withdrawal_tax_pct' }, data: { value: 0 } });
  });

  it('withdrawal above balance is rejected without side effects', async () => {
    const wallet = await walletOf();
    const res = await request(app)
      .post('/api/v1/withdrawals')
      .set(auth())
      .send({ amount: (Number(wallet.balanceAvailable) * 10).toFixed(6), currency: 'USD' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');

    const after = await walletOf();
    expect(Number(after.balanceAvailable)).toBeCloseTo(Number(wallet.balanceAvailable), 6);
    expect(Number(after.balancePending)).toBeCloseTo(0, 6);
  });
});
