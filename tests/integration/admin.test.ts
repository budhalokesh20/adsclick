import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp, prisma } from '../helpers/test-app.js';
import { signEmailToken } from '../../src/utils/tokens.js';
import { hashPassword } from '../../src/utils/passwords.js';

const app = createApp();
const password = 'Password123!';

async function ensureRole(code: string, permissions: string[]) {
  await prisma.adminRole.upsert({
    where: { code },
    update: { permissions: permissions as never },
    create: { code, name: code, permissions: permissions as never },
  });
}

async function createAdmin(email: string, roleCode: string) {
  const role = await prisma.adminRole.findUniqueOrThrow({ where: { code: roleCode } });
  const admin = await prisma.adminUser.create({
    data: { email, passwordHash: await hashPassword(password), name: email, roles: { create: { adminRoleId: role.id } } },
  });
  const res = await request(app).post('/api/v1/admin/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

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

describe('admin API', () => {
  let superToken = '';
  let analystToken = '';
  let userId = '';
  let userToken = '';

  beforeAll(async () => {
    await ensureRole('SUPER_ADMIN', ['*']);
    await ensureRole('ANALYST', ['analytics.read', 'users.read', 'finance.read']);
    await ensureMockFixtures();

    superToken = await createAdmin('boss@admin.test', 'SUPER_ADMIN');
    analystToken = await createAdmin('analyst@admin.test', 'ANALYST');

    const reg = await request(app).post('/api/v1/auth/register').send({ email: 'customer@example.com', password });
    userId = reg.body.user.id;
    userToken = reg.body.accessToken as string;
    const token = await signEmailToken(userId, 'email_verify');
    await request(app).post('/api/v1/auth/verify-email').send({ token });
    await request(app).post('/api/v1/earning/enable').set({ Authorization: `Bearer ${userToken}` });

    await request(app)
      .post('/api/v1/advertisements/events')
      .set({ Authorization: `Bearer ${userToken}` })
      .send({
        eventUuid: randomUUID(),
        provider: 'mock',
        campaignExternalId: 'mock-campaign-001',
        advertisementExternalId: 'ad-001',
        eventType: 'IMPRESSION',
        occurredAt: new Date().toISOString(),
      });
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('rejects invalid admin credentials', async () => {
    const res = await request(app).post('/api/v1/admin/auth/login').send({ email: 'boss@admin.test', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('admin login returns token + roles; me reflects them', async () => {
    const me = await request(app).get('/api/v1/admin/auth/me').set(auth(superToken));
    expect(me.status).toBe(200);
    expect(me.body.roles).toContain('SUPER_ADMIN');
  });

  it('admin can update own profile and change password', async () => {
    const profile = await request(app)
      .patch('/api/v1/admin/auth/me')
      .set(auth(superToken))
      .send({ name: 'Boss Admin', email: 'boss@admin.test' });
    expect(profile.status).toBe(200);
    expect(profile.body.name).toBe('Boss Admin');

    // old password still valid? change it
    const pw = await request(app)
      .patch('/api/v1/admin/auth/password')
      .set(auth(superToken))
      .send({ currentPassword: password, newPassword: 'NewPass123!' });
    expect(pw.status).toBe(204);

    const loginNew = await request(app).post('/api/v1/admin/auth/login').send({ email: 'boss@admin.test', password: 'NewPass123!' });
    expect(loginNew.status).toBe(200);

    // revert password for other tests
    await request(app)
      .patch('/api/v1/admin/auth/password')
      .set(auth(loginNew.body.accessToken))
      .send({ currentPassword: 'NewPass123!', newPassword: password });
  });

  it('RBAC: analyst can read overview/users but not write settings', async () => {
    const overview = await request(app).get('/api/v1/admin/overview').set(auth(analystToken));
    expect(overview.status).toBe(200);
    expect(overview.body.totalUsers).toBeGreaterThanOrEqual(1);

    const users = await request(app).get('/api/v1/admin/users?limit=5').set(auth(analystToken));
    expect(users.status).toBe(200);
    expect(users.body.data.length).toBeGreaterThanOrEqual(1);

    const denied = await request(app)
      .put('/api/v1/admin/settings/min_withdrawal_amount')
      .set(auth(analystToken))
      .send({ value: 5 });
    expect(denied.status).toBe(403);
  });

  it('overview reports the verified impression and liabilities', async () => {
    const res = await request(app).get('/api/v1/admin/overview').set(auth(superToken));
    expect(res.body.impressionsToday).toBeGreaterThanOrEqual(1);
    expect(Number(res.body.verifiedRevenueToday)).toBeGreaterThan(0);
    expect(Number(res.body.userRewardLiabilities)).toBeGreaterThan(0);
  });

  it('user list includes balance; admin can edit user profile', async () => {
    const list = await request(app).get('/api/v1/admin/users?limit=5').set(auth(analystToken));
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toHaveProperty('balance');

    const patch = await request(app)
      .patch(`/api/v1/admin/users/${userId}`)
      .set(auth(superToken))
      .send({ fullName: 'Edited Name', countryCode: 'US' });
    expect(patch.status).toBe(200);
    expect(patch.body.fullName).toBe('Edited Name');
    expect(patch.body.countryCode).toBe('US');
  });

  it('admin can create a user who can log in', async () => {
    const res = await request(app)
      .post('/api/v1/admin/users')
      .set(auth(superToken))
      .send({ email: 'created@example.com', password, fullName: 'Created User', status: 'ACTIVE' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'created@example.com', password });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('created@example.com');

    const dup = await request(app)
      .post('/api/v1/admin/users')
      .set(auth(superToken))
      .send({ email: 'created@example.com', password });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('trends returns real aggregated revenue and earning split', async () => {
    const res = await request(app).get('/api/v1/admin/trends').set(auth(superToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.revenue7d)).toBe(true);
    expect(Array.isArray(res.body.earningSplit)).toBe(true);
    expect(res.body.earningSplit.length).toBe(3);
    expect(res.body.monthlyRevenue).toHaveLength(12);

    const total = res.body.earningSplit.reduce((s: number, d: { value: number }) => s + d.value, 0);
    expect(total).toBeGreaterThan(0);
    expect(res.body.earningSplit.find((d: { name: string }) => d.name === 'Advertising rewards').value).toBeGreaterThan(0);
  });

  it('admin can view a user detail and change status (revokes sessions)', async () => {
    const detail = await request(app).get(`/api/v1/admin/users/${userId}`).set(auth(superToken));
    expect(detail.status).toBe(200);
    expect(detail.body.wallet.balanceAvailable).not.toBe('0');

    const patch = await request(app)
      .patch(`/api/v1/admin/users/${userId}/status`)
      .set(auth(superToken))
      .send({ status: 'RESTRICTED' });
    expect(patch.status).toBe(200);

    const blocked = await request(app).get('/api/v1/users/me').set(auth(userToken));
    expect([401, 403]).toContain(blocked.status);

    await request(app)
      .patch(`/api/v1/admin/users/${userId}/status`)
      .set(auth(superToken))
      .send({ status: 'ACTIVE' });
  });

  it('withdrawal review flow works over HTTP', async () => {
    // Sessions were revoked by the status change above — sign in fresh.
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'customer@example.com', password });
    expect(login.status).toBe(200);
    userToken = login.body.accessToken as string;

    const wallet = await request(app).get('/api/v1/wallet').set(auth(userToken));
    const available = Number(wallet.body.balanceAvailable);
    const amount = available >= 0.002 ? (available / 2).toFixed(6) : '0.001000';

    const created = await request(app)
      .post('/api/v1/withdrawals')
      .set(auth(userToken))
      .send({ amount, currency: 'USD' });
    if (created.status !== 201) console.log('DEBUG WITHDRAW BODY:', JSON.stringify(created.body), 'amount=', amount);
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const review = await request(app).post(`/api/v1/admin/withdrawals/${id}/review`).set(auth(superToken));
    expect(review.status).toBe(200);

    const approve = await request(app).post(`/api/v1/admin/withdrawals/${id}/approve`).set(auth(superToken));
    expect(approve.status).toBe(200);

    const process = await request(app).post(`/api/v1/admin/withdrawals/${id}/process`).set(auth(superToken));
    expect(process.status).toBe(200);

    const pay = await request(app).post(`/api/v1/admin/withdrawals/${id}/pay`).set(auth(superToken));
    expect(pay.status).toBe(200);

    const detail = await request(app).get(`/api/v1/admin/withdrawals/${id}`).set(auth(superToken));
    expect(detail.body.status).toBe('PAID');
    expect(detail.body.paidAt).not.toBeNull();
  });

  it('settings update is audited', async () => {
    const res = await request(app)
      .put('/api/v1/admin/settings/min_withdrawal_amount')
      .set(auth(superToken))
      .send({ value: 0.01 });
    expect(res.status).toBe(200);
    expect(Number((res.body.value as number))).toBeCloseTo(0.01, 6);

    const logs = await request(app).get('/api/v1/admin/audit-logs?limit=20').set(auth(superToken));
    const entry = logs.body.data.find((l: { action: string }) => l.action === 'settings.update');
    expect(entry).toBeDefined();
  });

  it('finance adjustment credits the wallet and drives reconciliation clean', async () => {
    const res = await request(app)
      .post('/api/v1/admin/finance/adj')
      .set(auth(superToken))
      .send({ userId, amount: '0.25', reason: 'test credit' });
    expect(res.status).toBe(200);
    expect(res.body.newBalance).not.toBe('0');

    const reconcile = await request(app).get('/api/v1/admin/finance/reconciliation').set(auth(superToken));
    expect(reconcile.status).toBe(200);
    expect(reconcile.body.mismatches).toEqual([]);
  });

  it('admin manages payout methods with logos and allowed countries', async () => {
    const created = await request(app)
      .post('/api/v1/admin/payout-methods')
      .set(auth(superToken))
      .send({ code: 'bank', name: 'Bank Transfer', logoUrl: 'https://example.com/bank.png', minPayout: '5', taxPct: '10', allowedCountries: ['US', 'NP', 'IN'] });
    expect(created.status).toBe(201);
    expect(created.body.allowedCountries).toEqual(['US', 'NP', 'IN']);
    expect(created.body.minPayout).toBe('5');
    expect(created.body.taxPct).toBe('10');

    const countries = await request(app).get('/api/v1/admin/countries').set(auth(superToken));
    expect(countries.status).toBe(200);
    expect(countries.body.data.length).toBeGreaterThan(20);

    const list = await request(app).get('/api/v1/admin/payout-methods').set(auth(superToken));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);

    const id = created.body.id as string;
    const updated = await request(app)
      .patch(`/api/v1/admin/payout-methods/${id}`)
      .set(auth(superToken))
      .send({ allowedCountries: ['US'], status: 'INACTIVE' });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('INACTIVE');

    const removed = await request(app).delete(`/api/v1/admin/payout-methods/${id}`).set(auth(superToken));
    expect(removed.status).toBe(200);
  });

  it('providers/campaigns listing works', async () => {
    const providers = await request(app).get('/api/v1/admin/providers').set(auth(superToken));
    expect(providers.status).toBe(200);
    expect(providers.body.data.length).toBeGreaterThanOrEqual(1);

    const campaigns = await request(app).get(`/api/v1/admin/providers/${providers.body.data[0].id}/campaigns`).set(auth(superToken));
    expect(campaigns.status).toBe(200);
    expect(campaigns.body.data.length).toBeGreaterThanOrEqual(1);
  });
});
