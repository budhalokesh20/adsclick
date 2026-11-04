import { prisma } from '../../database/prisma.js';
import { resolveCurrency } from '../currencies/currencies.service.js';
import { badRequest, notFound, unauthorized } from '../../utils/errors.js';
import { hashPassword, verifyPassword } from '../../utils/passwords.js';
import type { ChangePasswordInput, UpdateProfileInput } from './users.schemas.js';

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      wallet: true,
      referralCodes: true,
    },
  });
  if (!user) throw notFound('User not found');

  const referralCode = user.referralCodes.find((c) => c.status === 'ACTIVE')?.code ?? null;
  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.profile?.fullName ?? null,
      countryCode: user.profile?.countryCode ?? null,
      locale: user.profile?.locale ?? null,
      emailVerified: user.emailVerifiedAt !== null,
      status: user.status,
      referralCode,
      createdAt: user.createdAt.toISOString(),
    },
    wallet: {
      balanceAvailable: user.wallet?.balanceAvailable.toString() ?? '0',
      balancePending: user.wallet?.balancePending.toString() ?? '0',
      lifetimeEarned: user.wallet?.lifetimeEarned.toString() ?? '0',
      totalWithdrawn: user.wallet?.totalWithdrawn.toString() ?? '0',
      currency: user.wallet?.currency ?? 'USD',
    },
    settings: {
      notificationPrefs: (user.profile?.notificationPrefs ?? {}) as Record<string, boolean>,
    },
    displayCurrency: (() => {
      const c = resolveCurrency(user.profile?.countryCode);
      return { code: c.code, symbol: c.symbol, name: c.name, decimals: c.decimals };
    })(),
  };
}

export async function updateMe(userId: string, input: UpdateProfileInput) {
  const profile = await prisma.userProfile.update({
    where: { userId },
    data: {
      fullName: input.fullName === undefined ? undefined : input.fullName,
      countryCode: input.countryCode === undefined ? undefined : input.countryCode,
      locale: input.locale === undefined ? undefined : input.locale,
      notificationPrefs:
        input.notificationPrefs === undefined
          ? undefined
          : ({ ...(await getCurrentPrefs(userId)), ...input.notificationPrefs } as Record<string, boolean>),
    },
  });
  return {
    fullName: profile.fullName,
    countryCode: profile.countryCode,
    locale: profile.locale,
    notificationPrefs: profile.notificationPrefs,
  };
}

async function getCurrentPrefs(userId: string): Promise<Record<string, boolean>> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { notificationPrefs: true },
  });
  return (profile?.notificationPrefs ?? {}) as Record<string, boolean>;
}

export async function changePassword(userId: string, sessionId: string, input: ChangePasswordInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw unauthorized();

  const ok = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!ok) throw badRequest('INVALID_CURRENT_PASSWORD', 'Current password is incorrect');

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(input.newPassword) },
    });
    // Revoke all other sessions; keep the current one.
    await tx.userSession.updateMany({
      where: { userId, revokedAt: null, NOT: { id: sessionId } },
      data: { revokedAt: new Date() },
    });
  });
}

export async function deleteMe(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), status: 'CLOSED' },
    });
    await tx.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}
