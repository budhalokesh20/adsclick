import { Prisma, type UserStatus } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { hashPassword, verifyPassword } from '../../utils/passwords.js';
import { toDecimal } from '../../services/finance/decimal.js';
import { generateReferralCode } from '../../utils/referral.js';
import type { Decimal } from 'decimal.js';

// ---------------------------------------------------------------- Overview

export async function overviewKpis() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [users, activeUsers, dau, earningActive, impressionsToday, verifiedRevenue, liabilities, platformRevenue, pendingWithdrawals, fraudOpen] =
    await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      prisma.user.count({ where: { deletedAt: null, lastLoginAt: { gte: dayStart } } }),
      prisma.userEarningState.count({ where: { status: 'ACTIVE' } }),
      prisma.verifiedImpression.count({ where: { impressionAt: { gte: dayStart } } }),
      prisma.revenueEvent.aggregate({
        where: { status: { in: ['RECEIVED', 'COMMITTED'] }, recognizedAt: { gte: dayStart } },
        _sum: { grossAmount: true },
      }),
      prisma.wallet.aggregate({ _sum: { balanceAvailable: true, balancePending: true } }),
      prisma.revenueAllocation.aggregate({
        where: { status: 'ALLOCATED' },
        _sum: { platformAmount: true },
      }),
      prisma.withdrawalRequest.count({ where: { status: { in: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING'] } } }),
      prisma.fraudEvent.count({ where: { status: 'OPEN' } }),
    ]);

  return {
    totalUsers: users,
    activeUsers,
    dailyActiveUsers: dau,
    earningModeActiveUsers: earningActive,
    impressionsToday,
    verifiedRevenueToday: (verifiedRevenue._sum.grossAmount ?? 0).toString(),
    userRewardLiabilities: toDecimal((liabilities._sum.balanceAvailable ?? 0).toString())
      .plus(toDecimal((liabilities._sum.balancePending ?? 0).toString()))
      .toString(),
    platformRevenue: (platformRevenue._sum.platformAmount ?? 0).toString(),
    pendingWithdrawals,
    openFraudEvents: fraudOpen,
  };
}

// ------------------------------------------------------------------ Users

export async function listUsers(filter: { search?: string; status?: string; cursor?: string; limit?: number }) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(filter.search
      ? { OR: [{ email: { contains: filter.search, mode: 'insensitive' as const } }, { id: filter.search }] }
      : {}),
    ...(filter.status ? { status: filter.status as UserStatus } : {}),
    ...(filter.cursor ? { id: { lt: filter.cursor } } : {}),
  };

  const rows = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(filter.limit ?? 20, 100),
    select: {
      id: true,
      email: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      emailVerifiedAt: true,
      earningState: { select: { status: true } },
      wallet: { select: { balanceAvailable: true } },
    },
  });

  const total = await prisma.user.count({ where });
  return {
    data: rows.map((u) => ({
      id: u.id,
      email: u.email,
      status: u.status,
      emailVerified: u.emailVerifiedAt !== null,
      earningStatus: u.earningState?.status ?? 'DISABLED',
      balance: u.wallet ? u.wallet.balanceAvailable.toString() : '0',
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    })),
    total,
  };
}

export async function getUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      wallet: true,
      earningState: true,
      devices: { select: { platform: true, model: true, osVersion: true, lastSeenAt: true, status: true } },
      referralCodes: true,
    },
  });
  if (!user) throw notFound('User not found');
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    fullName: user.profile?.fullName,
    countryCode: user.profile?.countryCode,
    locale: user.profile?.locale,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    wallet: user.wallet
      ? {
          balanceAvailable: user.wallet.balanceAvailable.toString(),
          balancePending: user.wallet.balancePending.toString(),
          lifetimeEarned: user.wallet.lifetimeEarned.toString(),
          totalWithdrawn: user.wallet.totalWithdrawn.toString(),
        }
      : null,
    earningStatus: user.earningState?.status ?? 'DISABLED',
    devices: user.devices.map((d) => ({
      platform: d.platform,
      model: d.model,
      osVersion: d.osVersion,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      status: d.status,
    })),
    referralCode: user.referralCodes.find((c) => c.status === 'ACTIVE')?.code ?? null,
  };
}

const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' }, { code: 'IN', name: 'India' },
  { code: 'NP', name: 'Nepal' }, { code: 'BD', name: 'Bangladesh' }, { code: 'PK', name: 'Pakistan' },
  { code: 'LK', name: 'Sri Lanka' }, { code: 'AE', name: 'United Arab Emirates' }, { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' }, { code: 'SG', name: 'Singapore' }, { code: 'MY', name: 'Malaysia' },
  { code: 'ID', name: 'Indonesia' }, { code: 'TH', name: 'Thailand' }, { code: 'VN', name: 'Vietnam' },
  { code: 'PH', name: 'Philippines' }, { code: 'CN', name: 'China' }, { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' }, { code: 'AU', name: 'Australia' }, { code: 'NZ', name: 'New Zealand' },
  { code: 'CA', name: 'Canada' }, { code: 'MX', name: 'Mexico' }, { code: 'BR', name: 'Brazil' },
  { code: 'AR', name: 'Argentina' }, { code: 'CL', name: 'Chile' }, { code: 'CO', name: 'Colombia' },
  { code: 'PE', name: 'Peru' }, { code: 'DE', name: 'Germany' }, { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' }, { code: 'ES', name: 'Spain' }, { code: 'PT', name: 'Portugal' },
  { code: 'NL', name: 'Netherlands' }, { code: 'BE', name: 'Belgium' }, { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' }, { code: 'SE', name: 'Sweden' }, { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' }, { code: 'FI', name: 'Finland' }, { code: 'PL', name: 'Poland' },
  { code: 'TR', name: 'Turkey' }, { code: 'EG', name: 'Egypt' }, { code: 'NG', name: 'Nigeria' },
  { code: 'ZA', name: 'South Africa' }, { code: 'KE', name: 'Kenya' }, { code: 'RU', name: 'Russia' },
  { code: 'UA', name: 'Ukraine' }, { code: 'IL', name: 'Israel' }, { code: 'KZ', name: 'Kazakhstan' },
];

export function listCountries(): Array<{ code: string; name: string }> {
  return COUNTRIES;
}

export async function updateAdminProfile(adminId: string, input: { name?: string; email?: string }) {
  const existing = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!existing) throw notFound('Admin not found');
  try {
    return await prisma.adminUser.update({
      where: { id: adminId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
      },
      select: { id: true, email: true, name: true, status: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('EMAIL_TAKEN', 'An admin with this email already exists');
    }
    throw err;
  }
}

export async function changeAdminPassword(adminId: string, currentPassword: string, newPassword: string) {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { passwordHash: true } });
  if (!admin) throw notFound('Admin not found');
  const ok = await verifyPassword(admin.passwordHash, currentPassword);
  if (!ok) throw badRequest('INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
  await prisma.adminUser.update({ where: { id: adminId }, data: { passwordHash: await hashPassword(newPassword) } });
  return { ok: true };
}

export async function listPayoutMethods() {
  const rows = await prisma.payoutMethod.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, code: true, name: true, logoUrl: true, minPayout: true, taxPct: true, allowedCountries: true, status: true, sortOrder: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    logoUrl: r.logoUrl,
    minPayout: r.minPayout.toString(),
    taxPct: r.taxPct.toString(),
    allowedCountries: r.allowedCountries as string[],
    status: r.status,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createPayoutMethod(input: { code: string; name: string; logoUrl?: string; minPayout?: string; taxPct?: string; allowedCountries?: string[]; status?: string; sortOrder?: number }) {
  try {
    const row = await prisma.payoutMethod.create({
      data: {
        code: input.code.toLowerCase(),
        name: input.name,
        logoUrl: input.logoUrl ?? null,
        minPayout: input.minPayout ?? '0',
        taxPct: input.taxPct ?? '0',
        allowedCountries: (input.allowedCountries ?? []) as never,
        status: input.status ?? 'ACTIVE',
        sortOrder: input.sortOrder ?? 0,
      },
      select: { id: true, code: true, name: true, logoUrl: true, minPayout: true, taxPct: true, allowedCountries: true, status: true },
    });
    return { id: row.id, code: row.code, name: row.name, logoUrl: row.logoUrl, minPayout: row.minPayout.toString(), taxPct: row.taxPct.toString(), allowedCountries: row.allowedCountries as string[], status: row.status };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('CODE_TAKEN', 'A method with this code already exists');
    }
    throw err;
  }
}

export async function updatePayoutMethod(id: string, input: { name?: string; logoUrl?: string | null; minPayout?: string; taxPct?: string; allowedCountries?: string[]; status?: string; sortOrder?: number }) {
  const existing = await prisma.payoutMethod.findUnique({ where: { id } });
  if (!existing) throw notFound('Payout method not found');
  return prisma.payoutMethod.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      ...(input.minPayout !== undefined ? { minPayout: input.minPayout } : {}),
      ...(input.taxPct !== undefined ? { taxPct: input.taxPct } : {}),
      ...(input.allowedCountries !== undefined ? { allowedCountries: input.allowedCountries as never } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
    select: { id: true, code: true, name: true, status: true },
  });
}

export async function removePayoutMethod(id: string) {
  const existing = await prisma.payoutMethod.findUnique({ where: { id } });
  if (!existing) throw notFound('Payout method not found');
  await prisma.payoutMethod.update({ where: { id }, data: { status: 'INACTIVE' } });
  return { id };
}

export async function createUser(input: { email: string; password: string; fullName?: string; status?: UserStatus }) {
  try {
    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash: await hashPassword(input.password),
        status: input.status ?? 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { fullName: input.fullName ?? null } },
        wallet: { create: {} },
        referralCodes: { create: { code: generateReferralCode() } },
      },
      select: { id: true, email: true, status: true, createdAt: true, wallet: { select: { balanceAvailable: true } } },
    });
    return { id: user.id, email: user.email, status: user.status, createdAt: user.createdAt.toISOString() };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

export async function updateUserProfile(userId: string, input: { fullName?: string | null; countryCode?: string | null; locale?: string | null }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw notFound('User not found');

  const profile = await prisma.userProfile.update({
    where: { userId },
    data: {
      fullName: input.fullName === undefined ? undefined : input.fullName,
      countryCode: input.countryCode === undefined ? undefined : input.countryCode,
      locale: input.locale === undefined ? undefined : input.locale,
    },
    select: { fullName: true, countryCode: true, locale: true },
  });
  return { id: userId, ...profile };
}

export async function setUserStatus(userId: string, status: UserStatus) {
  const allowed: UserStatus[] = ['ACTIVE', 'SUSPENDED', 'RESTRICTED', 'CLOSED'];
  if (!allowed.includes(status)) throw badRequest('INVALID_STATUS', 'Unsupported status');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user) throw notFound('User not found');

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status } });
    if (status === 'SUSPENDED' || status === 'RESTRICTED' || status === 'CLOSED') {
      await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.userEarningState.updateMany({ where: { userId }, data: { status: 'RESTRICTED' } });
    } else {
      await tx.userEarningState.updateMany({ where: { userId, status: 'RESTRICTED' }, data: { status: 'DISABLED' } });
    }
  });

  return { id: userId, from: user.status, to: status };
}

// ------------------------------------------------------------- Providers

export async function listProviders() {
  const rows = await prisma.advertisingProvider.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      sandbox: true,
      config: true,
      createdAt: true,
      _count: { select: { campaigns: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    status: p.status,
    sandbox: p.sandbox,
    config: p.config,
    campaignCount: p._count.campaigns,
    createdAt: p.createdAt.toISOString(),
  }));
}

export async function createProvider(input: { code: string; name: string; sandbox?: boolean; config?: unknown }) {
  return prisma.advertisingProvider.create({
    data: { code: input.code, name: input.name, sandbox: input.sandbox ?? true, config: (input.config ?? {}) as never },
    select: { id: true, code: true, name: true, status: true, sandbox: true },
  });
}

export async function updateProvider(providerId: string, input: { name?: string; status?: string; config?: unknown }) {
  const existing = await prisma.advertisingProvider.findUnique({ where: { id: providerId } });
  if (!existing) throw notFound('Provider not found');
  const updated = await prisma.advertisingProvider.update({
    where: { id: providerId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status as never } : {}),
      ...(input.config !== undefined ? { config: input.config as never } : {}),
    },
    select: { id: true, code: true, name: true, status: true, sandbox: true },
  });
  return { ...updated, before: { status: existing.status } };
}

export async function listCampaigns(providerId?: string) {
  const campaigns = await prisma.advertisingCampaign.findMany({
    where: providerId ? { providerId } : {},
    orderBy: { createdAt: 'desc' },
    include: { provider: { select: { code: true, name: true } } },
  });
  return campaigns.map((c) => ({
    id: c.id,
    provider: c.provider.code,
    externalCampaignId: c.externalCampaignId,
    name: c.name,
    status: c.status,
    payoutType: c.payoutType,
    payoutAmount: c.payoutAmount.toString(),
    currency: c.currency,
    startsAt: c.startsAt?.toISOString() ?? null,
    endsAt: c.endsAt?.toISOString() ?? null,
  }));
}

export async function createCampaign(providerId: string, input: {
  externalCampaignId: string;
  name: string;
  payoutType: 'CPM' | 'CPA' | 'CPC';
  payoutAmount: string;
  currency?: string;
  startsAt?: string;
  endsAt?: string;
}) {
  const provider = await prisma.advertisingProvider.findUnique({ where: { id: providerId } });
  if (!provider) throw notFound('Provider not found');
  return prisma.advertisingCampaign.create({
    data: {
      providerId,
      externalCampaignId: input.externalCampaignId,
      name: input.name,
      status: 'DRAFT',
      payoutType: input.payoutType,
      payoutAmount: input.payoutAmount,
      currency: input.currency ?? 'USD',
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
    },
    select: { id: true, name: true, status: true, payoutType: true, payoutAmount: true },
  });
}

export async function updateCampaign(campaignId: string, input: { status?: string; payoutAmount?: string }) {
  const campaign = await prisma.advertisingCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw notFound('Campaign not found');
  return prisma.advertisingCampaign.update({
    where: { id: campaignId },
    data: {
      ...(input.status !== undefined ? { status: input.status as never } : {}),
      ...(input.payoutAmount !== undefined ? { payoutAmount: input.payoutAmount } : {}),
    },
    select: { id: true, name: true, status: true, payoutAmount: true },
  });
}

// -------------------------------------------------------------- Finance

export async function financeSummary() {
  const [verifiedRevenue, allocations, ledgerSum, withdrawalsPaid] = await Promise.all([
    prisma.revenueEvent.aggregate({ where: { status: { in: ['RECEIVED', 'COMMITTED'] } }, _sum: { grossAmount: true } }),
    prisma.revenueAllocation.aggregate({
      where: { status: 'ALLOCATED' },
      _sum: { userAmount: true, platformAmount: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.withdrawalRequest.aggregate({ where: { status: 'PAID' }, _sum: { netAmount: true } }),
  ]);

  return {
    verifiedRevenueTotal: (verifiedRevenue._sum.grossAmount ?? 0).toString(),
    allocatedUserTotal: (allocations._sum.userAmount ?? 0).toString(),
    allocatedPlatformTotal: (allocations._sum.platformAmount ?? 0).toString(),
    ledgerEntries: ledgerSum._count,
    totalPaidOut: (withdrawalsPaid._sum.netAmount ?? 0).toString(),
  };
}

export async function reconciliation() {
  const wallets = await prisma.wallet.findMany({ select: { id: true, userId: true, balanceAvailable: true, balancePending: true } });

  // Invariant: wallet balances must equal the latest completed ledger snapshot.
  const mismatches: Array<{ walletId: string; userId: string; expected: string; actual: string; drift: string }> = [];
  for (const w of wallets) {
    const last = await prisma.walletTransaction.findFirst({
      where: { walletId: w.id, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { balanceAfterAvailable: true, balanceAfterPending: true },
    });

    const expectedAvailable = last ? toDecimal(last.balanceAfterAvailable.toString()) : toDecimal(0);
    const expectedPending = last ? toDecimal(last.balanceAfterPending.toString()) : toDecimal(0);
    const actualAvailable = toDecimal(w.balanceAvailable.toString());
    const actualPending = toDecimal(w.balancePending.toString());

    if (!expectedAvailable.equals(actualAvailable)) {
      mismatches.push({
        walletId: w.id,
        userId: w.userId,
        expected: `available=${expectedAvailable.toString()}`,
        actual: `available=${actualAvailable.toString()}`,
        drift: expectedAvailable.minus(actualAvailable).toString(),
      });
    }
    if (!expectedPending.equals(actualPending)) {
      mismatches.push({
        walletId: w.id,
        userId: w.userId,
        expected: `pending=${expectedPending.toString()}`,
        actual: `pending=${actualPending.toString()}`,
        drift: expectedPending.minus(actualPending).toString(),
      });
    }
  }
  return { checkedWallets: wallets.length, mismatches };
}

export async function adminAdjustment(userId: string, amount: string, reason: string) {
  const delta = toDecimal(amount);
  if (delta.isZero()) throw badRequest('ZERO_ADJUSTMENT', 'Adjustment cannot be zero');
  if (!reason.trim()) throw badRequest('REASON_REQUIRED', 'A reason is required for adjustments');

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; balance_available: string; balance_pending: string; lifetime_earned: string; currency: string }>>`
      SELECT id, balance_available, balance_pending, lifetime_earned, currency
      FROM wallets WHERE user_id = ${userId}::uuid FOR UPDATE`;
    const wallet = rows[0];
    if (!wallet) throw notFound('Wallet not found');

    const available = toDecimal(wallet.balance_available);
    const newAvailable = available.plus(delta);
    if (newAvailable.isNegative()) throw badRequest('RESULT_NEGATIVE', 'Adjustment would drive balance negative');

    const txn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        txnType: 'ADJUSTMENT',
        direction: delta.isPositive() ? 'CREDIT' : 'DEBIT',
        amount: delta.abs(),
        currency: wallet.currency,
        status: 'COMPLETED',
        balanceAfterAvailable: newAvailable,
        balanceAfterPending: toDecimal(wallet.balance_pending),
        description: reason,
        createdBy: 'admin',
        idempotencyKey: `adj:${toDecimal(0).toString()}:${userId}:${Date.now()}`,
      },
      select: { id: true },
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceAvailable: newAvailable, version: { increment: 1 } },
    });

    return { txnId: txn.id, newBalance: newAvailable.toString(), currency: wallet.currency };
  });
}
