import { prisma } from '../../database/prisma.js';
import { badRequest, forbidden } from '../../utils/errors.js';
import type { EarningStatus } from '@prisma/client';

export interface EarningStatusView {
  status: EarningStatus;
  configured: boolean;
  enabledAt: string | null;
  pausedAt: string | null;
  reason?: string;
  capabilities: {
    mode: 'IN_APP' | 'OVERLAY';
    overlayApproved: boolean;
    provider: string;
  };
}

export async function getSetting(key: string): Promise<unknown> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function getEarningStatus(userId: string): Promise<EarningStatusView> {
  const [state, configured, overlayApproved, provider] = await Promise.all([
    prisma.userEarningState.findUnique({ where: { userId } }),
    getSetting('earning_mode_enabled'),
    getSetting('overlay_approved'),
    getSetting('ad_provider_default'),
  ]);

  return {
    status: state?.status ?? 'DISABLED',
    configured: configured === true,
    enabledAt: state?.enabledAt?.toISOString() ?? null,
    pausedAt: state?.pausedAt?.toISOString() ?? null,
    capabilities: {
      mode: overlayApproved === true ? 'OVERLAY' : 'IN_APP',
      overlayApproved: overlayApproved === true,
      provider: typeof provider === 'string' ? provider : 'mock',
    },
  };
}

async function requireEligible(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, emailVerifiedAt: true },
  });
  if (!user || user.status === 'CLOSED') throw forbidden('ACCOUNT_CLOSED', 'Account not available');
  if (user.status === 'SUSPENDED' || user.status === 'RESTRICTED') {
    throw forbidden('ACCOUNT_RESTRICTED', 'Account is restricted');
  }
  if (!user.emailVerifiedAt) throw badRequest('EMAIL_NOT_VERIFIED', 'Verify your email before enabling Earning Mode');
}

async function updateState(userId: string, status: EarningStatus, extra?: { enabledAt?: Date; pausedAt?: Date | null }) {
  return prisma.userEarningState.upsert({
    where: { userId },
    update: { status, ...extra },
    create: { userId, status, ...extra },
  });
}

export async function enableEarning(userId: string): Promise<EarningStatusView> {
  const configured = await getSetting('earning_mode_enabled');
  if (configured !== true) {
    throw badRequest('EARNING_MODE_DISABLED', 'Earning Mode is not available yet');
  }
  await requireEligible(userId);
  const state = await updateState(userId, 'ACTIVE', { enabledAt: new Date(), pausedAt: null });
  return getEarningStatus(userId).then((v) => ({ ...v, status: state.status }));
}

export async function pauseEarning(userId: string): Promise<EarningStatusView> {
  const state = await prisma.userEarningState.findUnique({ where: { userId } });
  if (state?.status !== 'ACTIVE') {
    throw badRequest('EARNING_NOT_ACTIVE', 'Earning Mode is not active');
  }
  await updateState(userId, 'PAUSED', { pausedAt: new Date() });
  return getEarningStatus(userId);
}

export async function resumeEarning(userId: string): Promise<EarningStatusView> {
  const state = await prisma.userEarningState.findUnique({ where: { userId } });
  if (state?.status !== 'PAUSED') {
    throw badRequest('EARNING_NOT_PAUSED', 'Earning Mode is not paused');
  }
  await updateState(userId, 'ACTIVE', { pausedAt: null });
  return getEarningStatus(userId);
}

export async function disableEarning(userId: string): Promise<EarningStatusView> {
  await updateState(userId, 'DISABLED', { pausedAt: null });
  return getEarningStatus(userId);
}

export async function earningHistory(userId: string, cursor?: string, limit = 20) {
  const events = await prisma.advertisementEvent.findMany({
    where: { userId, ...(cursor ? { id: { lt: cursor } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    select: {
      id: true,
      eventType: true,
      validationStatus: true,
      rejectionReason: true,
      createdAt: true,
      campaign: { select: { name: true } },
    },
  });
  return events.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    validationStatus: e.validationStatus,
    rejectionReason: e.rejectionReason,
    campaign: e.campaign?.name ?? null,
    createdAt: e.createdAt.toISOString(),
  }));
}


