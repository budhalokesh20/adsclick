import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { toDecimal } from '../../services/finance/decimal.js';
import { logger } from '../../utils/logger.js';

async function settingNumber(key: string, fallback: number): Promise<number> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  const raw = row?.value;
  return typeof raw === 'number' ? raw : fallback;
}

async function settingString(key: string, fallback: string): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  const raw = row?.value;
  return typeof raw === 'string' ? raw : fallback;
}

export async function referralsSummary(userId: string) {
  const [code, relationships, rewards] = await Promise.all([
    prisma.referralCode.findFirst({ where: { userId, status: 'ACTIVE' }, select: { code: true } }),
    prisma.referralRelationship.findMany({
      where: { referrerUserId: userId },
      select: { status: true },
    }),
    prisma.referralReward.findMany({
      where: { relationship: { referrerUserId: userId } },
      select: { amount: true, currency: true, status: true },
    }),
  ]);

  const confirmed = relationships.filter((r) => r.status === 'CONFIRMED').length;
  const rewardsTotal = rewards
    .filter((r) => r.status === 'PAID')
    .reduce((sum, r) => sum.plus(toDecimal(r.amount.toString())), toDecimal(0));

  return {
    code: code?.code ?? null,
    link: code ? `https://adshare.app/r/${code.code}` : null,
    invitedCount: relationships.length,
    confirmedCount: confirmed,
    pendingCount: relationships.length - confirmed,
    rewardsTotal: rewardsTotal.toString(),
    currency: rewards[0]?.currency ?? (await settingString('referral_reward_currency', 'USD')),
  };
}

export async function referralsHistory(userId: string, cursor?: string, limit = 20) {
  const rows = await prisma.referralRelationship.findMany({
    where: { referrerUserId: userId, ...(cursor ? { id: { lt: cursor } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    select: {
      id: true,
      status: true,
      confirmedAt: true,
      createdAt: true,
      referred: { select: { email: true, createdAt: true } },
      rewards: { select: { rewardType: true, amount: true, currency: true, status: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    referredEmail: maskEmail(r.referred.email),
    referredSince: r.referred.createdAt.toISOString(),
    rewards: r.rewards.map((w) => ({
      type: w.rewardType,
      amount: w.amount.toString(),
      currency: w.currency,
      status: w.status,
    })),
  }));
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}•••@${domain}`;
}

export type ReferralRewardType = 'SIGNUP_BONUS' | 'FIRST_VERIFIED_IMPRESSION';

/**
 * Pays a configurable referral reward, idempotently (unique index on
 * (relationship_id, reward_type)). Only confirmed relationships earn.
 */
export async function grantReferralReward(
  relationshipId: string,
  rewardType: ReferralRewardType,
): Promise<{ granted: boolean }> {
  const key = rewardType === 'SIGNUP_BONUS' ? 'referral_signup_bonus' : 'referral_first_impression_reward';
  const amount = await settingNumber(key, 0);
  if (amount <= 0) return { granted: false };

  try {
    return await prisma.$transaction(async (tx) => {
      const relationship = await tx.referralRelationship.findUnique({
        where: { id: relationshipId },
        select: { referrerUserId: true, status: true },
      });
      if (!relationship || relationship.status !== 'CONFIRMED') {
        return { granted: false };
      }

      const rows = await tx.$queryRaw<Array<{
        id: string;
        balance_available: string;
        balance_pending: string;
        lifetime_earned: string;
        currency: string;
      }>>`SELECT id, balance_available, balance_pending, lifetime_earned, currency
             FROM wallets WHERE user_id = ${relationship.referrerUserId}::uuid FOR UPDATE`;
      const wallet = rows[0];
      if (!wallet) return { granted: false };

      const currency = await settingString('referral_reward_currency', wallet.currency);
      const rewardAmount = toDecimal(amount);
      const available = toDecimal(wallet.balance_available);

      const reward = await tx.referralReward.create({
        data: {
          relationshipId,
          rewardType,
          amount: rewardAmount,
          currency,
          status: 'PAID',
          paidAt: new Date(),
        },
        select: { id: true },
      });

      const newAvailable = available.plus(rewardAmount);
      const newLifetime = toDecimal(wallet.lifetime_earned).plus(rewardAmount);

      const txn = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: relationship.referrerUserId,
          txnType: 'REFERRAL_REWARD',
          direction: 'CREDIT',
          amount: rewardAmount,
          currency,
          status: 'COMPLETED',
          balanceAfterAvailable: newAvailable,
          balanceAfterPending: toDecimal(wallet.balance_pending),
          referenceType: 'REFERRAL_REWARD',
          referenceId: reward.id,
          idempotencyKey: `referral:${reward.id}`,
          description: rewardType === 'SIGNUP_BONUS' ? 'Referral signup bonus' : 'Referral first-impression reward',
          createdBy: 'system',
        },
        select: { id: true },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceAvailable: newAvailable, lifetimeEarned: newLifetime, version: { increment: 1 } },
      });

      await tx.referralReward.update({
        where: { id: reward.id },
        data: { walletTxnId: txn.id },
      });

      return { granted: true };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { granted: false }; // already rewarded
    }
    logger.error({ err, relationshipId, rewardType }, 'referral reward failed');
    throw err;
  }
}
