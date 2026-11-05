import { z } from 'zod';

const deviceFields = {
  deviceId: z.string().min(8).max(200).optional(),
  platform: z.enum(['ANDROID', 'IOS']).optional(),
  deviceModel: z.string().max(100).optional(),
  osVersion: z.string().max(40).optional(),
  appVersion: z.string().max(40).optional(),
  pushToken: z.string().max(512).optional(),
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/).optional(),
};

export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(72),
  fullName: z.string().trim().max(120).optional(),
  referralCode: z.string().regex(/^[A-Z0-9]{4,12}$/).optional(),
  ...deviceFields,
});

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(72),
  ...deviceFields,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(32),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
});

export const resetPasswordSchema = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(8).max(72),
});

export const verifyOtpSchema = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/),
});

export const resendOtpSchema = z.object({
  email: z.string().email().max(254),
});

export const googleAuthSchema = z.object({
  idToken: z.string().min(20),
  deviceId: z.string().min(8).max(200),
  platform: z.enum(['ANDROID', 'IOS']).default('ANDROID'),
  deviceModel: z.string().max(100).optional(),
  osVersion: z.string().max(40).optional(),
  appVersion: z.string().max(40).optional(),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const paramIdSchema = z.object({
  id: z.string().uuid(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
