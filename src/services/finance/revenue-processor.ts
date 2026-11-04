import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { grantReferralReward } from '../../modules/referrals/referrals.service.js';
import { logger } from '../../utils/logger.js';
import { round6, share, toDecimal } from './decimal.js';

interface SettingsBundle {
  userPct: number;
  platformPct: number;
  settlementMode: 'instant' | 'threshold';
}

async function readSettings(): Promise<SettingsBundle> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['revenue_share_pct', 'platform_share_pct', 'settlement_mode'] } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    userPct: Number(map.get('revenue_share_pct') ?? 60),
    platformPct: Number(map.get('platform_share_pct') ?? 40),
    settlementMode: (map.get('settlement_mode') as 'instant' | 'threshold') ?? 'instant',
  };
}

export interface AllocationResult {
  allocated: boolean;
  userAmount?: string;
}

/**
 * Commits a verified impression to the ledger:
 *   revenue → split (user/platform) → allocation row → wallet transaction →
 *   wallet balance update → notification.
 *
 * Runs inside one PostgreSQL transaction with a row lock on the wallet, plus a
 * unique constraint on `revenue_allocations.verified_impression_id` as the
 * idempotency backstop (concurrent attempts for the same impression fail with
 * P2002 and are ignored).
 */
export async function allocateVerifiedImpression(impressionId: string): Promise<AllocationResult> {
  let impressionUserId: string | undefined;
  try {
    return await prisma.$transaction(async (tx) => {
      const impression = await tx.verifiedImpression.findUnique({
        where: { id: impressionId },
        select: { userId: true, revenueGross: true, currency: true, settlementStatus: true },
      });
      if (!impression || impression.settlementStatus !== 'PENDING') {
        return { allocated: false };
      }
      impressionUserId = impression.userId;

      const settings = await readSettings();

      // Lock the wallet row for the duration of this transaction.
      const rows = await tx.$queryRaw<Array<{
        id: string;
        balance_available: string;
        balance_pending: string;
        lifetime_earned: string;
        currency: string;
      }>>`SELECT id, balance_available, balance_pending, lifetime_earned, currency
             FROM wallets WHERE user_id = ${impression.userId}::uuid FOR UPDATE`;
      const walletRow = rows[0];
      if (!walletRow) return { allocated: false };

      const gross = toDecimal(impression.revenueGross.toString());
      const userAmount = share(gross, settings.userPct);
      const platformAmount = round6(gross.minus(userAmount));

      const available = toDecimal(walletRow.balance_available);
      const pending = toDecimal(walletRow.balance_pending);
      const lifetime = toDecimal(walletRow.lifetime_earned);

      const creditPending = settings.settlementMode !== 'instant';
      const newAvailable = creditPending ? available : available.plus(userAmount);
      const newPending = creditPending ? pending.plus(userAmount) : pending;
      const newLifetime = lifetime.plus(userAmount);

      const allocation = await tx.revenueAllocation.create({
        data: {
          verifiedImpressionId: impressionId,
          userId: impression.userId,
          grossRevenue: gross,
          userSharePct: settings.userPct,
          platformSharePct: settings.platformPct,
          userAmount,
          platformAmount,
          currency: walletRow.currency,
          status: 'ALLOCATED',
          committedAt: new Date(),
        },
        select: { id: true },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: walletRow.id,
          userId: impression.userId,
          txnType: 'AD_REWARD',
          direction: 'CREDIT',
          amount: userAmount,
          currency: walletRow.currency,
          status: 'COMPLETED',
          balanceAfterAvailable: newAvailable,
          balanceAfterPending: newPending,
          referenceType: 'REVENUE_ALLOCATION',
          referenceId: allocation.id,
          idempotencyKey: `alloc:${allocation.id}`,
          description: 'Verified advertising reward',
          createdBy: 'system',
        },
      });

      await tx.wallet.update({
        where: { id: walletRow.id },
        data: {
          balanceAvailable: newAvailable,
          balancePending: newPending,
          lifetimeEarned: newLifetime,
          version: { increment: 1 },
        },
      });

      await tx.verifiedImpression.update({
        where: { id: impressionId },
        data: { settlementStatus: 'ALLOCATED' },
      });

      await tx.revenueEvent.updateMany({
        where: { verifiedImpressionId: impressionId, status: 'RECEIVED' },
        data: { status: 'COMMITTED' },
      });

      await tx.notification.create({
        data: {
          userId: impression.userId,
          type: 'EARNING',
          title: 'Reward credited',
          body: `You earned ${userAmount.toString()} ${walletRow.currency} from verified advertising.`,
          data: { allocationId: allocation.id } as never,
        },
      });

      return { allocated: true, userAmount: userAmount.toString() };
    }).then(async (result) => {
      if (result.allocated) {
        // Referral hook: first verified impression rewards the referrer.
        const relationship = await prisma.referralRelationship.findFirst({
          where: { referredUserId: impressionUserId!, status: 'CONFIRMED' },
          select: { id: true },
        });
        if (relationship) {
          await grantReferralReward(relationship.id, 'FIRST_VERIFIED_IMPRESSION');
        }
      }
      return result;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Concurrent processor already allocated this impression.
      return { allocated: false };
    }
    logger.error({ err, impressionId }, 'allocation failed');
    throw err;
  }
}

/** Retry/backfill: allocates any impressions left in PENDING. */
export async function processPendingAllocations(batch = 100): Promise<number> {
  const pending = await prisma.verifiedImpression.findMany({
    where: { settlementStatus: 'PENDING' },
    select: { id: true },
    take: batch,
  });
  let allocated = 0;
  for (const impression of pending) {
    const result = await allocateVerifiedImpression(impression.id);
    if (result.allocated) allocated += 1;
  }
  return allocated;
}
