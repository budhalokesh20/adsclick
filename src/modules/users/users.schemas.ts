import { z } from 'zod';

export const updateProfileSchema = z.object({
  fullName: z.string().trim().max(120).nullable().optional(),
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/).nullable().optional(),
  locale: z.string().max(12).nullable().optional(),
  notificationPrefs: z
    .object({
      earnings: z.boolean().optional(),
      withdrawals: z.boolean().optional(),
      marketing: z.boolean().optional(),
    })
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: z.string().min(8).max(72),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
