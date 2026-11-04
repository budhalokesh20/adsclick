import { prisma } from '../../database/prisma.js';
import { notFound } from '../../utils/errors.js';

export async function getWallet(userId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw notFound('Wallet not found');

  return {
    balanceAvailable: wallet.balanceAvailable.toString(),
    balancePending: wallet.balancePending.toString(),
    lifetimeEarned: wallet.lifetimeEarned.toString(),
    totalWithdrawn: wallet.totalWithdrawn.toString(),
    currency: wallet.currency,
  };
}

export async function listTransactions(userId: string, cursor?: string, limit = 20) {
  const rows = await prisma.walletTransaction.findMany({
    where: { userId, ...(cursor ? { id: { lt: cursor } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    select: {
      id: true,
      txnType: true,
      direction: true,
      amount: true,
      currency: true,
      status: true,
      description: true,
      referenceType: true,
      createdAt: true,
    },
  });

  return rows.map((t) => ({
    id: t.id,
    type: t.txnType,
    direction: t.direction,
    amount: t.amount.toString(),
    currency: t.currency,
    status: t.status,
    description: t.description,
    referenceType: t.referenceType,
    createdAt: t.createdAt.toISOString(),
  }));
}
