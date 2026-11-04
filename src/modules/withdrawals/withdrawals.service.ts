import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { encryptSecret } from '../../utils/crypto.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { toDecimal } from '../../services/finance/decimal.js';
import type { CreatePaymentMethodInput, CreateWithdrawalInput } from './withdrawals.schemas.js';

async function settingsNumber(key: string, fallback: number): Promise<number> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  const raw = row?.value;
  return typeof raw === 'number' ? raw : fallback;
}

interface WalletLockRow {
  id: string;
  balance_available: string;
  balance_pending: string;
  total_withdrawn: string;
  currency: string;
}

async function lockWallet(tx: Prisma.TransactionClient, userId: string): Promise<WalletLockRow> {
  const rows = await tx.$queryRaw<WalletLockRow[]>`
    SELECT id, balance_available, balance_pending, total_withdrawn, currency
    FROM wallets WHERE user_id = ${userId}::uuid FOR UPDATE`;
  const wallet = rows[0];
  if (!wallet) throw notFound('Wallet not found');
  return wallet;
}

export async function createWithdrawal(userId: string, input: CreateWithdrawalInput) {
  const amount = toDecimal(input.amount);
  const fee = toDecimal(await settingsNumber('withdrawal_fee_flat', 0));
  const taxPct = await settingsNumber('withdrawal_tax_pct', 0);
  const min = toDecimal(await settingsNumber('min_withdrawal_amount', 10));
  const tax = amount.mul(taxPct).div(100);
  const net = amount.minus(fee).minus(tax);

  if (net.isNegative()) throw badRequest('INVALID_AMOUNT', 'Amount must exceed the fee');
  if (amount.lessThan(min)) {
    throw badRequest('MIN_WITHDRAWAL_NOT_MET', `Minimum withdrawal is ${min.toString()}`);
  }

  if (input.paymentMethodId) {
    const method = await prisma.paymentMethod.findFirst({
      where: { id: input.paymentMethodId, userId, status: 'ACTIVE' },
    });
    if (!method) throw badRequest('PAYMENT_METHOD_NOT_FOUND', 'Payment method not found');
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await lockWallet(tx, userId);
    const available = toDecimal(wallet.balance_available);

    if (available.lessThan(amount)) {
      throw badRequest('INSUFFICIENT_BALANCE', 'Insufficient available balance');
    }

    const newAvailable = available.minus(amount);
    const newPending = toDecimal(wallet.balance_pending).plus(amount);

    const request = await tx.withdrawalRequest.create({
      data: {
        userId,
        amount,
        currency: wallet.currency,
        paymentMethodId: input.paymentMethodId ?? null,
        status: 'PENDING',
        feeAmount: fee,
        netAmount: net,
        requestedAt: new Date(),
      },
      select: { id: true },
    });

    const holdTxn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        txnType: 'WITHDRAWAL_HOLD',
        direction: 'DEBIT',
        amount,
        currency: wallet.currency,
        status: 'COMPLETED',
        balanceAfterAvailable: newAvailable,
        balanceAfterPending: newPending,
        referenceType: 'WITHDRAWAL_REQUEST',
        referenceId: request.id,
        idempotencyKey: `hold:${request.id}`,
        description: 'Withdrawal hold',
        createdBy: 'system',
      },
      select: { id: true },
    });

    await tx.withdrawalRequest.update({
      where: { id: request.id },
      data: { holdTxnId: holdTxn.id },
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceAvailable: newAvailable, balancePending: newPending, version: { increment: 1 } },
    });

    return {
      id: request.id,
      status: 'PENDING',
      holdAmount: amount.toString(),
      currency: wallet.currency,
    };
  });
}

const ADMIN_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING'],
  PROCESSING: ['PAID', 'REJECTED'],
  PAID: [],
  REJECTED: [],
};

function assertTransition(current: string, next: string): void {
  if (!ADMIN_TRANSITIONS[current]?.includes(next)) {
    throw badRequest('INVALID_TRANSITION', `Cannot move withdrawal from ${current} to ${next}`);
  }
}

async function getOwnedRequest(requestId: string, adminId: string) {
  const request = await prisma.withdrawalRequest.findUnique({
    where: { id: requestId },
    include: { paymentMethod: true },
  });
  if (!request) throw notFound('Withdrawal request not found');
  return { request, adminId };
}

export async function adminReview(requestId: string, adminId: string): Promise<void> {
  const { request } = await getOwnedRequest(requestId, adminId);
  assertTransition(request.status, 'UNDER_REVIEW');
  await prisma.withdrawalRequest.update({
    where: { id: requestId },
    data: { status: 'UNDER_REVIEW', reviewedByAdminId: adminId, reviewedAt: new Date() },
  });
}

export async function adminApprove(requestId: string, adminId: string): Promise<void> {
  const { request } = await getOwnedRequest(requestId, adminId);
  assertTransition(request.status, 'APPROVED');
  await prisma.withdrawalRequest.update({
    where: { id: requestId },
    data: { status: 'APPROVED', reviewedByAdminId: adminId },
  });
}

export async function adminProcess(requestId: string, adminId: string): Promise<void> {
  const { request } = await getOwnedRequest(requestId, adminId);
  assertTransition(request.status, 'PROCESSING');
  await prisma.withdrawalRequest.update({
    where: { id: requestId },
    data: { status: 'PROCESSING', processedAt: new Date() },
  });
}

/** Mock payout: settles the hold into `paid`, updates totals. */
export async function adminPay(requestId: string, adminId: string): Promise<void> {
  const { request } = await getOwnedRequest(requestId, adminId);
  assertTransition(request.status, 'PAID');

  return prisma.$transaction(async (tx) => {
    const wallet = await lockWallet(tx, request.userId);
    const pending = toDecimal(wallet.balance_pending);
    const heldAmount = toDecimal(request.amount.toString());
    if (pending.lessThan(heldAmount)) {
      throw badRequest('INSUFFICIENT_HOLD', 'Hold amount does not cover payout');
    }

    const newPending = pending.minus(heldAmount);
    const newWithdrawn = toDecimal(wallet.total_withdrawn).plus(toDecimal(request.netAmount.toString()));

    const payoutTxn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId: request.userId,
        txnType: 'WITHDRAWAL_PAYOUT',
        direction: 'DEBIT',
        amount: heldAmount,
        currency: wallet.currency,
        status: 'COMPLETED',
        balanceAfterAvailable: toDecimal(wallet.balance_available),
        balanceAfterPending: newPending,
        referenceType: 'WITHDRAWAL_REQUEST',
        referenceId: requestId,
        idempotencyKey: `payout:${requestId}`,
        description: 'Withdrawal payout',
        createdBy: 'system',
      },
      select: { id: true },
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balancePending: newPending, totalWithdrawn: newWithdrawn, version: { increment: 1 } },
    });

    await tx.withdrawalRequest.update({
      where: { id: requestId },
      data: { status: 'PAID', payoutTxnId: payoutTxn.id, paidAt: new Date() },
    });
  });
}

/** Rejection releases the hold back to the available balance. */
export async function adminReject(requestId: string, adminId: string, note?: string): Promise<void> {
  const { request } = await getOwnedRequest(requestId, adminId);
  assertTransition(request.status, 'REJECTED');

  return prisma.$transaction(async (tx) => {
    const wallet = await lockWallet(tx, request.userId);
    const pending = toDecimal(wallet.balance_pending);
    const heldAmount = toDecimal(request.amount.toString());
    if (pending.lessThan(heldAmount)) {
      throw badRequest('INSUFFICIENT_HOLD', 'Cannot release hold: pending balance too low');
    }

    const newPending = pending.minus(heldAmount);
    const newAvailable = toDecimal(wallet.balance_available).plus(heldAmount);

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId: request.userId,
        txnType: 'WITHDRAWAL_REJECTION',
        direction: 'CREDIT',
        amount: heldAmount,
        currency: wallet.currency,
        status: 'COMPLETED',
        balanceAfterAvailable: newAvailable,
        balanceAfterPending: newPending,
        referenceType: 'WITHDRAWAL_REQUEST',
        referenceId: requestId,
        idempotencyKey: `reject:${requestId}`,
        description: 'Withdrawal hold released',
        createdBy: 'system',
      },
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceAvailable: newAvailable, balancePending: newPending, version: { increment: 1 } },
    });

    await tx.withdrawalRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', reviewNote: note ?? null, rejectedAt: new Date() },
    });
  });
}

export async function listWithdrawals(userId: string, cursor?: string, limit = 20) {
  const rows = await prisma.withdrawalRequest.findMany({
    where: { userId, ...(cursor ? { id: { lt: cursor } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      feeAmount: true,
      netAmount: true,
      requestedAt: true,
      paidAt: true,
      rejectedAt: true,
      paymentMethod: { select: { label: true, providerType: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount.toString(),
    currency: r.currency,
    status: r.status,
    fee: r.feeAmount.toString(),
    net: r.netAmount.toString(),
    requestedAt: r.requestedAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
    rejectedAt: r.rejectedAt?.toISOString() ?? null,
    paymentMethod: r.paymentMethod ? { label: r.paymentMethod.label, type: r.paymentMethod.providerType } : null,
  }));
}

export async function getWithdrawal(userId: string, requestId: string) {
  const request = await prisma.withdrawalRequest.findFirst({
    where: { id: requestId, userId },
    include: { paymentMethod: true },
  });
  if (!request) throw notFound('Withdrawal request not found');
  return {
    id: request.id,
    amount: request.amount.toString(),
    currency: request.currency,
    status: request.status,
    fee: request.feeAmount.toString(),
    net: request.netAmount.toString(),
    requestedAt: request.requestedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    processedAt: request.processedAt?.toISOString() ?? null,
    paidAt: request.paidAt?.toISOString() ?? null,
    rejectedAt: request.rejectedAt?.toISOString() ?? null,
    note: request.reviewNote,
    paymentMethod: request.paymentMethod
      ? { label: request.paymentMethod.label, type: request.paymentMethod.providerType }
      : null,
  };
}

export async function createPaymentMethod(userId: string, input: CreatePaymentMethodInput) {
  const method = await prisma.paymentMethod.create({
    data: {
      userId,
      label: input.label ?? input.providerType,
      providerType: input.providerType,
      accountDetailsEnc: encryptSecret(JSON.stringify(input.accountDetails)),
      isDefault: false,
    },
    select: { id: true, label: true, providerType: true, createdAt: true },
  });
  return { id: method.id, label: method.label, type: method.providerType, createdAt: method.createdAt.toISOString() };
}

export async function listPaymentMethods(userId: string) {
  const methods = await prisma.paymentMethod.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, providerType: true, status: true, isDefault: true, createdAt: true },
  });
  return methods.map((m) => ({
    id: m.id,
    label: m.label,
    type: m.providerType,
    status: m.status,
    isDefault: m.isDefault,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function deletePaymentMethod(userId: string, methodId: string): Promise<void> {
  const method = await prisma.paymentMethod.findFirst({ where: { id: methodId, userId } });
  if (!method) throw notFound('Payment method not found');
  await prisma.paymentMethod.update({
    where: { id: methodId },
    data: { status: 'INACTIVE' },
  });
}


