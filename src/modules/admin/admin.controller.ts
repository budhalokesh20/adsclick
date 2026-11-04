import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/prisma.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { hashPassword } from '../../utils/passwords.js';
import { audit } from './audit.js';
import {
  adminAdjustment,
  changeAdminPassword,
  createCampaign,
  createPayoutMethod,
  createProvider,
  createUser,
  financeSummary,
  getUserDetail,
  listCampaigns,
  listCountries,
  listPayoutMethods,
  listProviders,
  listUsers,
  overviewKpis,
  reconciliation,
  removePayoutMethod,
  setUserStatus,
  updateAdminProfile,
  updateCampaign,
  updatePayoutMethod,
  updateProvider,
  updateUserProfile,
} from './admin.service.js';
import { adminLogin } from './admin.auth.service.js';

const cursorOf = (req: Request) => (typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
const limitOf = (req: Request) => Math.min(typeof req.query.limit === 'string' ? Number(req.query.limit) : 20, 100);
const str = (req: Request, key: string) => (typeof req.query[key] === 'string' ? (req.query[key] as string) : undefined);

export const adminController = {
  async login(req: Request, res: Response): Promise<void> {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    res.json(await adminLogin(body.email, body.password));
  },

  async me(req: Request, res: Response): Promise<void> {
    res.json(req.admin);
  },

  async updateOwnProfile(req: Request, res: Response): Promise<void> {
    const body = z.object({
      name: z.string().trim().min(1).max(120).optional(),
      email: z.string().email().max(254).optional(),
    }).parse(req.body);
    const result = await updateAdminProfile(req.admin!.adminId, body);
    await audit(req, 'admins.profile', 'admin_users', req.admin!.adminId, null, body);
    res.json(result);
  },

  async changeOwnPassword(req: Request, res: Response): Promise<void> {
    const body = z.object({
      currentPassword: z.string().min(1).max(72),
      newPassword: z.string().min(8).max(72),
    }).parse(req.body);
    await changeAdminPassword(req.admin!.adminId, body.currentPassword, body.newPassword);
    await audit(req, 'admins.password', 'admin_users', req.admin!.adminId, null, {});
    res.status(204).send();
  },

  async overview(_req: Request, res: Response): Promise<void> {
    res.json(await overviewKpis());
  },

  async trends(_req: Request, res: Response): Promise<void> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);

    const revenueRows = await prisma.$queryRaw<Array<{ day: Date; total: string }>>`
      SELECT date_trunc('day', "recognized_at") AS day, SUM("gross_amount")::text AS total
      FROM revenue_events
      WHERE status IN ('RECEIVED', 'COMMITTED') AND "recognized_at" >= ${start}
      GROUP BY day ORDER BY day ASC`;

    const revenue7d = revenueRows.map((r) => ({
      label: r.day.toISOString().slice(0, 10),
      value: Number(r.total),
    }));

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);

    const [revenueMonthlyRows, platformMonthlyRows] = await Promise.all([
      prisma.$queryRaw<Array<{ month: Date; total: string }>>`
        SELECT date_trunc('month', "recognized_at") AS month, SUM("gross_amount")::text AS total
        FROM revenue_events
        WHERE status IN ('RECEIVED', 'COMMITTED') AND "recognized_at" >= ${twelveMonthsAgo}
        GROUP BY month ORDER BY month ASC`,
      prisma.$queryRaw<Array<{ month: Date; total: string }>>`
        SELECT date_trunc('month', "committed_at") AS month, SUM("platform_amount")::text AS total
        FROM revenue_allocations
        WHERE status = 'ALLOCATED' AND "committed_at" >= ${twelveMonthsAgo}
        GROUP BY month ORDER BY month ASC`,
    ]);

    const monthKey = (d: Date) => d.toISOString().slice(0, 7);
    const revenueByMonth = new Map(revenueMonthlyRows.map((r) => [monthKey(r.month), Number(r.total)]));
    const platformByMonth = new Map(platformMonthlyRows.map((r) => [monthKey(r.month), Number(r.total)]));

    const monthlyRevenue: Array<{ label: string; revenue: number; platform: number }> = [];
    const probe = new Date(twelveMonthsAgo);
    for (let i = 0; i < 12; i += 1) {
      const key = monthKey(probe);
      monthlyRevenue.push({ label: key, revenue: revenueByMonth.get(key) ?? 0, platform: platformByMonth.get(key) ?? 0 });
      probe.setMonth(probe.getMonth() + 1);
    }

    const [adRewards, referralRewards, platformSum] = await Promise.all([
      prisma.walletTransaction.aggregate({
        where: { txnType: 'AD_REWARD', status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      prisma.walletTransaction.aggregate({
        where: { txnType: 'REFERRAL_REWARD', status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      prisma.revenueAllocation.aggregate({
        where: { status: 'ALLOCATED' },
        _sum: { platformAmount: true },
      }),
    ]);

    const num = (v: unknown) => Number((v as { toString(): string } | null)?.toString() ?? 0);

    res.json({
      revenue7d,
      monthlyRevenue,
      earningSplit: [
        { name: 'Advertising rewards', value: num(adRewards._sum.amount) },
        { name: 'Referral rewards', value: num(referralRewards._sum.amount) },
        { name: 'Platform share', value: num(platformSum._sum.platformAmount) },
      ],
    });
  },

  async users(req: Request, res: Response): Promise<void> {
    const result = await listUsers({ search: str(req, 'search'), status: str(req, 'status'), cursor: cursorOf(req), limit: limitOf(req) });
    res.json(result);
  },

  async userDetail(req: Request<{ id: string }>, res: Response): Promise<void> {
    res.json(await getUserDetail(req.params.id));
  },

  async createUser(req: Request, res: Response): Promise<void> {
    const body = z.object({
      email: z.string().email().max(254),
      password: z.string().min(8).max(72),
      fullName: z.string().trim().max(120).optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED', 'RESTRICTED', 'CLOSED']).default('ACTIVE'),
    }).parse(req.body);
    const result = await createUser(body);
    await audit(req, 'users.create', 'users', result.id, null, result);
    res.status(201).json(result);
  },

  async updateUser(req: Request<{ id: string }>, res: Response): Promise<void> {
    const body = z.object({
      fullName: z.string().trim().max(120).nullable().optional(),
      countryCode: z.string().length(2).regex(/^[A-Z]{2}$/).nullable().optional(),
      locale: z.string().max(12).nullable().optional(),
    }).parse(req.body);
    const result = await updateUserProfile(req.params.id, body);
    await audit(req, 'users.update', 'users', req.params.id, null, body);
    res.json(result);
  },

  async userStatus(req: Request<{ id: string }>, res: Response): Promise<void> {
    const status = z.enum(['ACTIVE', 'SUSPENDED', 'RESTRICTED', 'CLOSED']).parse(req.body.status);
    const result = await setUserStatus(req.params.id, status);
    await audit(req, 'users.status', 'users', req.params.id, { from: result.from }, { to: status });
    res.json(result);
  },

  async providers(_req: Request, res: Response): Promise<void> {
    res.json({ data: await listProviders() });
  },

  async createProvider(req: Request, res: Response): Promise<void> {
    const body = z.object({ code: z.string().min(1).max(50), name: z.string().min(1), sandbox: z.boolean().optional(), config: z.unknown().optional() }).parse(req.body);
    const provider = await createProvider(body);
    await audit(req, 'providers.create', 'advertising_providers', provider.id, null, provider);
    res.status(201).json(provider);
  },

  async updateProvider(req: Request<{ id: string }>, res: Response): Promise<void> {
    const body = z.object({ name: z.string().optional(), status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']).optional(), config: z.unknown().optional() }).parse(req.body);
    const provider = await updateProvider(req.params.id, body);
    await audit(req, 'providers.update', 'advertising_providers', req.params.id, provider.before, body);
    res.json(provider);
  },

  async campaigns(req: Request<{ id: string }>, res: Response): Promise<void> {
    res.json({ data: await listCampaigns(req.params.id) });
  },

  async createCampaign(req: Request<{ id: string }>, res: Response): Promise<void> {
    const body = z.object({
      externalCampaignId: z.string().min(1),
      name: z.string().min(1),
      payoutType: z.enum(['CPM', 'CPA', 'CPC']),
      payoutAmount: z.string(),
      currency: z.string().length(3).optional(),
      startsAt: z.string().optional(),
      endsAt: z.string().optional(),
    }).parse(req.body);
    const campaign = await createCampaign(req.params.id, body);
    await audit(req, 'campaigns.create', 'advertising_campaigns', campaign.id, null, campaign);
    res.status(201).json(campaign);
  },

  async updateCampaign(req: Request<{ id: string }>, res: Response): Promise<void> {
    const body = z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED']).optional(), payoutAmount: z.string().optional() }).parse(req.body);
    const campaign = await updateCampaign(req.params.id, body);
    await audit(req, 'campaigns.update', 'advertising_campaigns', req.params.id, null, body);
    res.json(campaign);
  },

  async events(req: Request, res: Response): Promise<void> {
    const where = {
      ...(str(req, 'status') ? { validationStatus: str(req, 'status') as never } : {}),
      ...(str(req, 'type') ? { eventType: str(req, 'type') as never } : {}),
      ...(str(req, 'userId') ? { userId: str(req, 'userId') as never } : {}),
      ...(cursorOf(req) ? { id: { lt: cursorOf(req) } } : {}),
    };
    const rows = await prisma.advertisementEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limitOf(req),
      select: { id: true, eventType: true, validationStatus: true, rejectionReason: true, userId: true, createdAt: true },
    });
    res.json({ data: rows.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })) });
  },

  async impressions(req: Request, res: Response): Promise<void> {
    const status = str(req, 'status') === 'rejected' ? 'REJECTED' : 'VERIFIED';
    const rows = await prisma.verifiedImpression.findMany({
      where: { settlementStatus: 'ALLOCATED' },
      orderBy: { createdAt: 'desc' },
      take: limitOf(req),
      select: { id: true, revenueGross: true, currency: true, settlementStatus: true, createdAt: true, userId: true },
    });
    res.json({
      data: rows.map((i) => ({ ...i, revenueGross: i.revenueGross.toString(), createdAt: i.createdAt.toISOString() })),
      filter: status,
    });
  },

  async financeSummary(_req: Request, res: Response): Promise<void> {
    res.json(await financeSummary());
  },

  async payoutMethods(_req: Request, res: Response): Promise<void> {
    res.json({ data: await listPayoutMethods() });
  },

  async countries(_req: Request, res: Response): Promise<void> {
    res.json({ data: listCountries() });
  },

  async createPayoutMethod(req: Request, res: Response): Promise<void> {
    const body = z.object({
      code: z.string().min(1).max(40),
      name: z.string().min(1).max(80),
      logoUrl: z.string().url().optional(),
      minPayout: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
      taxPct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      allowedCountries: z.array(z.string().length(2)).default([]),
      status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      sortOrder: z.number().int().optional(),
    }).parse(req.body);
    const result = await createPayoutMethod(body);
    await audit(req, 'payout_methods.create', 'payout_methods', result.id, null, body);
    res.status(201).json(result);
  },

  async updatePayoutMethod(req: Request<{ id: string }>, res: Response): Promise<void> {
    const body = z.object({
      name: z.string().min(1).max(80).optional(),
      logoUrl: z.string().url().nullable().optional(),
      minPayout: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
      taxPct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      allowedCountries: z.array(z.string().length(2)).optional(),
      status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      sortOrder: z.number().int().optional(),
    }).parse(req.body);
    const result = await updatePayoutMethod(req.params.id, body);
    await audit(req, 'payout_methods.update', 'payout_methods', req.params.id, null, body);
    res.json(result);
  },

  async removePayoutMethod(req: Request<{ id: string }>, res: Response): Promise<void> {
    const result = await removePayoutMethod(req.params.id);
    await audit(req, 'payout_methods.remove', 'payout_methods', req.params.id, null, {});
    res.json(result);
  },

  async allocations(req: Request, res: Response): Promise<void> {
    const rows = await prisma.revenueAllocation.findMany({
      orderBy: { createdAt: 'desc' },
      take: limitOf(req),
      select: { id: true, userId: true, grossRevenue: true, userAmount: true, platformAmount: true, currency: true, status: true, createdAt: true },
    });
    res.json({
      data: rows.map((a) => ({
        ...a,
        grossRevenue: a.grossRevenue.toString(),
        userAmount: a.userAmount.toString(),
        platformAmount: a.platformAmount.toString(),
        createdAt: a.createdAt.toISOString(),
      })),
    });
  },

  async ledger(req: Request, res: Response): Promise<void> {
    const rows = await prisma.walletTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: limitOf(req),
      select: { id: true, userId: true, txnType: true, direction: true, amount: true, currency: true, status: true, description: true, createdAt: true },
    });
    res.json({ data: rows.map((t) => ({ ...t, amount: t.amount.toString(), createdAt: t.createdAt.toISOString() })) });
  },

  async reconcile(_req: Request, res: Response): Promise<void> {
    res.json(await reconciliation());
  },

  async adjust(req: Request, res: Response): Promise<void> {
    const body = z.object({ userId: z.string().uuid(), amount: z.string(), reason: z.string().min(1) }).parse(req.body);
    const result = await adminAdjustment(body.userId, body.amount, body.reason);
    await audit(req, 'finance.adjustment', 'wallets', body.userId, null, { ...result, reason: body.reason });
    res.json(result);
  },

  async withdrawals(req: Request, res: Response): Promise<void> {
    const status = str(req, 'status');
    const rows = await prisma.withdrawalRequest.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: limitOf(req),
      select: { id: true, userId: true, amount: true, currency: true, status: true, requestedAt: true, netAmount: true },
    });
    res.json({ data: rows.map((w) => ({ ...w, amount: w.amount.toString(), netAmount: w.netAmount.toString(), requestedAt: w.requestedAt.toISOString() })) });
  },

  async withdrawalDetail(req: Request<{ id: string }>, res: Response): Promise<void> {
    const w = await prisma.withdrawalRequest.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { email: true } }, paymentMethod: true },
    });
    if (!w) throw notFound('Withdrawal not found');
    res.json({
      id: w.id,
      userId: w.userId,
      email: w.user.email,
      amount: w.amount.toString(),
      currency: w.currency,
      status: w.status,
      fee: w.feeAmount.toString(),
      net: w.netAmount.toString(),
      note: w.reviewNote,
      requestedAt: w.requestedAt.toISOString(),
      reviewedAt: w.reviewedAt?.toISOString() ?? null,
      processedAt: w.processedAt?.toISOString() ?? null,
      paidAt: w.paidAt?.toISOString() ?? null,
      rejectedAt: w.rejectedAt?.toISOString() ?? null,
      paymentMethod: w.paymentMethod ? { label: w.paymentMethod.label, type: w.paymentMethod.providerType } : null,
    });
  },

  async fraudEvents(req: Request, res: Response): Promise<void> {
    const rows = await prisma.fraudEvent.findMany({
      where: { ...(str(req, 'status') ? { status: str(req, 'status') as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limitOf(req),
      select: { id: true, userId: true, ruleCode: true, severity: true, status: true, details: true, createdAt: true, resolvedAt: true },
    });
    res.json({ data: rows.map((f) => ({ ...f, createdAt: f.createdAt.toISOString(), resolvedAt: f.resolvedAt?.toISOString() ?? null })) });
  },

  async resolveFraud(req: Request<{ id: string }>, res: Response): Promise<void> {
    const body = z.object({ status: z.enum(['OPEN', 'REVIEWED', 'RESOLVED']) }).parse(req.body);
    const event = await prisma.fraudEvent.findUnique({ where: { id: req.params.id } });
    if (!event) throw notFound('Fraud event not found');
    const updated = await prisma.fraudEvent.update({
      where: { id: req.params.id },
      data: { status: body.status, resolvedByAdminId: req.admin?.adminId ?? null, resolvedAt: body.status === 'RESOLVED' ? new Date() : null },
      select: { id: true, status: true },
    });
    await audit(req, 'fraud.resolve', 'fraud_events', req.params.id, { status: event.status }, { status: body.status });
    res.json(updated);
  },

  async settings(_req: Request, res: Response): Promise<void> {
    const rows = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    res.json({ data: rows.map((s) => ({ key: s.key, value: s.value, valueType: s.valueType, isPublic: s.isPublic, updatedAt: s.updatedAt.toISOString() })) });
  },

  async updateSetting(req: Request<{ key: string }>, res: Response): Promise<void> {
    const body = z.object({ value: z.unknown(), valueType: z.enum(['NUMBER', 'STRING', 'BOOLEAN', 'JSON']).optional() }).parse(req.body);
    const existing = await prisma.systemSetting.findUnique({ where: { key: req.params.key } });
    if (!existing) throw notFound('Setting not found');

    const valueType = body.valueType ?? existing.valueType;
    const value = body.value;
    if (valueType === 'NUMBER' && typeof value !== 'number') throw badRequest('INVALID_SETTING_TYPE', 'Expected a number');
    if (valueType === 'STRING' && typeof value !== 'string') throw badRequest('INVALID_SETTING_TYPE', 'Expected a string');
    if (valueType === 'BOOLEAN' && typeof value !== 'boolean') throw badRequest('INVALID_SETTING_TYPE', 'Expected a boolean');

    const updated = await prisma.systemSetting.update({
      where: { key: req.params.key },
      data: { value: value as never, updatedByAdminId: req.admin?.adminId ?? null },
      select: { key: true, value: true, valueType: true, isPublic: true },
    });
    await audit(req, 'settings.update', 'system_settings', undefined, { key: req.params.key, value: existing.value }, { key: req.params.key, value });
    res.json(updated);
  },

  async admins(_req: Request, res: Response): Promise<void> {
    const rows = await prisma.adminUser.findMany({
      select: { id: true, email: true, name: true, status: true, lastLoginAt: true, createdAt: true, roles: { select: { adminRole: { select: { code: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ data: rows.map((a) => ({ id: a.id, email: a.email, name: a.name, status: a.status, roles: a.roles.map((r) => r.adminRole.code), lastLoginAt: a.lastLoginAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString() })) });
  },

  async createAdmin(req: Request, res: Response): Promise<void> {
    const body = z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(8), roleCode: z.string() }).parse(req.body);
    const role = await prisma.adminRole.findUnique({ where: { code: body.roleCode } });
    if (!role) throw badRequest('ROLE_NOT_FOUND', 'Unknown role');
    const admin = await prisma.adminUser.create({
      data: { email: body.email.toLowerCase(), name: body.name, passwordHash: await hashPassword(body.password), roles: { create: { adminRoleId: role.id } } },
      select: { id: true, email: true, name: true },
    });
    await audit(req, 'admins.create', 'admin_users', admin.id, null, body);
    res.status(201).json(admin);
  },

  async setAdminRole(req: Request<{ id: string }>, res: Response): Promise<void> {
    const body = z.object({ roleCode: z.string() }).parse(req.body);
    const role = await prisma.adminRole.findUnique({ where: { code: body.roleCode } });
    if (!role) throw badRequest('ROLE_NOT_FOUND', 'Unknown role');
    await prisma.adminUserRole.deleteMany({ where: { adminUserId: req.params.id } });
    await prisma.adminUserRole.create({ data: { adminUserId: req.params.id, adminRoleId: role.id } });
    await audit(req, 'admins.role', 'admin_users', req.params.id, null, { roleCode: body.roleCode });
    res.status(204).send();
  },

  async roles(_req: Request, res: Response): Promise<void> {
    const rows = await prisma.adminRole.findMany({ select: { code: true, name: true, permissions: true } });
    res.json({ data: rows });
  },

  async auditLogs(req: Request, res: Response): Promise<void> {
    const rows = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limitOf(req),
      select: { id: true, actorType: true, actorId: true, action: true, entityType: true, entityId: true, ipAddress: true, createdAt: true },
    });
    res.json({ data: rows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })) });
  },
};
