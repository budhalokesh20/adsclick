import { z } from 'zod';

export const createWithdrawalSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/).refine((v) => Number(v) > 0, 'amount must be positive'),
  currency: z.string().length(3).default('USD'),
  paymentMethodId: z.string().uuid().optional(),
});

export const createPaymentMethodSchema = z.object({
  label: z.string().trim().max(60).optional(),
  providerType: z.enum(['MOCK', 'BANK', 'PAYPAL', 'CRYPTO']).default('MOCK'),
  accountDetails: z.record(z.string(), z.unknown()),
});

export const paramIdSchema = z.object({ id: z.string().uuid() });

export type CreateWithdrawalInput = z.infer<typeof createWithdrawalSchema>;
export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;
