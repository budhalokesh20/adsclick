import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { badRequest, conflict, forbidden, unauthorized } from '../../utils/errors.js';
import { hashPassword, verifyPassword } from '../../utils/passwords.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  signEmailToken,
  verifyEmailToken,
} from '../../utils/tokens.js';
import { buildResetPasswordLink, buildVerifyEmailLink, sendEmail } from '../../utils/email.js';
import { generateReferralCode } from '../../utils/referral.js';
import { resolveCurrency } from '../currencies/currencies.service.js';
import { verifyGoogleIdToken } from '../../services/google/google-auth.service.js';
import { issueOtp, verifyOtpCode } from '../../services/otp/otp.service.js';
import { grantReferralReward } from '../referrals/referrals.service.js';
import { env } from '../../config/env.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';

export interface PublicUser {
  id: string;
  email: string;
  fullName: string | null;
  countryCode: string | null;
  locale: string | null;
  emailVerified: boolean;
  status: string;
  referralCode: string | null;
  createdAt: string;
  displayCurrency?: { code: string; symbol: string; name: string; decimals: number };
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresAt: string;
}

const sessionTtlMs = () => env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;

type DbClient = Prisma.TransactionClient | PrismaClient;

interface DeviceInfo {
  deviceId?: string;
  platform?: 'ANDROID' | 'IOS';
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
  pushToken?: string;
}

async function deviceInfoRequired(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'device_info_required' } });
  return row?.value === true;
}

async function ensureDevice(client: DbClient, userId: string, info: DeviceInfo): Promise<string | null> {
  if (!info.deviceId) {
    if (await deviceInfoRequired()) {
      throw badRequest('DEVICE_INFO_REQUIRED', 'Device information is required for this action');
    }
    return null;
  }
  const record = await client.device.upsert({
    where: { userId_externalDeviceId: { userId, externalDeviceId: info.deviceId } },
    update: {
      platform: info.platform ?? 'ANDROID',
      model: info.deviceModel ?? null,
      osVersion: info.osVersion ?? null,
      appVersion: info.appVersion ?? null,
      pushToken: info.pushToken ?? null,
      lastSeenAt: new Date(),
    },
    create: {
      userId,
      externalDeviceId: info.deviceId,
      platform: info.platform ?? 'ANDROID',
      model: info.deviceModel ?? null,
      osVersion: info.osVersion ?? null,
      appVersion: info.appVersion ?? null,
      pushToken: info.pushToken ?? null,
      lastSeenAt: new Date(),
    },
    select: { id: true },
  });
  return record.id;
}

async function createSession(
  client: DbClient,
  userId: string,
  deviceId: string | null,
  ipAddress?: string,
  userAgent?: string,
): Promise<{ id: string; refreshToken: string; expiresAt: Date }> {
  const refreshToken = generateRefreshToken();
  const session = await client.userSession.create({
    data: {
      userId,
      deviceId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      expiresAt: new Date(Date.now() + sessionTtlMs()),
    },
    select: { id: true, expiresAt: true },
  });
  return { id: session.id, refreshToken, expiresAt: session.expiresAt };
}

function toPublicUser(user: Prisma.UserGetPayload<{ include: { profile: true; referralCodes: true } }>): PublicUser {
  const currency = resolveCurrency(user.profile?.countryCode);
  return {
    id: user.id,
    email: user.email,
    fullName: user.profile?.fullName ?? null,
    countryCode: user.profile?.countryCode ?? null,
    locale: user.profile?.locale ?? null,
    emailVerified: user.emailVerifiedAt !== null,
    status: user.status,
    referralCode: user.referralCodes.find((c) => c.status === 'ACTIVE')?.code ?? null,
    createdAt: user.createdAt.toISOString(),
    displayCurrency: { code: currency.code, symbol: currency.symbol, name: currency.name, decimals: currency.decimals },
  };
}

export async function googleLogin(
  input: { idToken: string; deviceId: string; platform?: 'ANDROID' | 'IOS'; deviceModel?: string; osVersion?: string; appVersion?: string },
  meta: { ip?: string; userAgent?: string },
) {
  const profile = await verifyGoogleIdToken(input.idToken).catch(() => {
    throw unauthorized('INVALID_GOOGLE_TOKEN', 'Google token is invalid or expired');
  });
  if (!profile.emailVerified) {
    throw unauthorized('GOOGLE_EMAIL_UNVERIFIED', 'Google account email is not verified');
  }

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: profile.email }, include: { profile: true, referralCodes: true } });
    if (existing) {
      if (existing.status === 'CLOSED') throw unauthorized('INVALID_CREDENTIALS', 'Account is closed');
      if (existing.status === 'SUSPENDED') throw forbidden('ACCOUNT_SUSPENDED', 'Account is suspended');
      return tx.user.update({
        where: { id: existing.id },
        data: { googleSub: existing.googleSub ?? profile.sub },
        include: { profile: true, referralCodes: true },
      });
    }

    return tx.user.create({
      data: {
        email: profile.email,
        googleSub: profile.sub,
        passwordHash: await hashPassword(`${profile.sub}:google-oauth:${Date.now()}`),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: {
          create: {
            fullName: profile.name,
            avatarUrl: profile.picture,
          },
        },
        wallet: { create: {} },
        referralCodes: { create: { code: generateReferralCode() } },
      },
      include: { profile: true, referralCodes: true },
    });
  });

  const deviceId = await ensureDevice(prisma, user.id, input);
  const session = await createSession(prisma, user.id, deviceId, meta.ip, meta.userAgent);
  const accessToken = await signAccessToken({ userId: user.id, sessionId: session.id, deviceId: deviceId ?? undefined });

  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken: session.refreshToken,
    sessionId: session.id,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function register(input: RegisterInput, meta: { ip?: string; userAgent?: string }) {
  const { user, deviceId } = await prisma.$transaction(async (tx) => {
    let user: Prisma.UserGetPayload<{ include: { profile: true; referralCodes: true } }>;
    try {
      user = await tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          passwordHash: await hashPassword(input.password),
          status: 'PENDING_VERIFICATION',
          profile: {
            create: {
              fullName: input.fullName ?? null,
              countryCode: input.countryCode ?? null,
            },
          },
          wallet: { create: {} },
          referralCodes: { create: { code: generateReferralCode() } },
        },
        include: { profile: true, referralCodes: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw err;
    }

    if (input.referralCode) {
      const referrer = await tx.referralCode.findFirst({
        where: { code: input.referralCode, status: 'ACTIVE' },
      });
      if (referrer && referrer.userId !== user.id) {
        await tx.referralRelationship.create({
          data: {
            referrerUserId: referrer.userId,
            referredUserId: user.id,
            codeUsed: input.referralCode,
            status: 'PENDING',
          },
        });
      }
    }

    const deviceId = await ensureDevice(tx, user.id, input);
    return { user, deviceId };
  });

  // OTP flows (no activation email links) — outside the transaction.
  await issueOtp(user.email, 'SIGNUP', user.id);

  const session = await createSession(prisma, user.id, deviceId, meta.ip, meta.userAgent);
  const accessToken = await signAccessToken({ userId: user.id, sessionId: session.id, deviceId: deviceId ?? undefined });
  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken: session.refreshToken,
    sessionId: session.id,
    expiresAt: session.expiresAt.toISOString(),
    otpRequired: true,
  };
}

export async function login(input: LoginInput, meta: { ip?: string; userAgent?: string }) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: { profile: true, referralCodes: true },
  });

  const invalid = () => unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
  if (!user || user.deletedAt) throw invalid();
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw invalid();
  if (user.status === 'CLOSED') throw invalid();
  if (user.status === 'SUSPENDED') throw forbidden('ACCOUNT_SUSPENDED', 'Account is suspended');

  const deviceId = await ensureDevice(prisma, user.id, input);
  const session = await createSession(prisma, user.id, deviceId, meta.ip, meta.userAgent);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastIp: meta.ip ?? null },
  });

  // Auto-set country once (from device locale) — display-only, never billing-critical.
  if (input.countryCode && !user.profile?.countryCode) {
    await prisma.userProfile.update({
      where: { userId: user.id },
      data: { countryCode: input.countryCode },
    });
  }

  const accessToken = await signAccessToken({ userId: user.id, sessionId: session.id, deviceId: deviceId ?? undefined });
  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken: session.refreshToken,
    sessionId: session.id,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function refresh(
  refreshToken: string,
  meta: { ip?: string; userAgent?: string },
): Promise<TokenBundle> {
  const hash = hashRefreshToken(refreshToken);
  const session = await prisma.userSession.findUnique({
    where: { refreshTokenHash: hash },
    select: { id: true, userId: true, deviceId: true, revokedAt: true, replacedBySessionId: true, expiresAt: true },
  });

  if (!session) throw unauthorized('INVALID_REFRESH_TOKEN', 'Invalid refresh token');

  if (session.revokedAt) {
    // Reuse of a rotated token — revoke the whole session family.
    if (session.replacedBySessionId) {
      await prisma.userSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    throw unauthorized('TOKEN_REUSE_DETECTED', 'Refresh token reuse detected, session revoked');
  }

  if (session.expiresAt < new Date()) {
    throw unauthorized('REFRESH_TOKEN_EXPIRED', 'Refresh token expired');
  }

  const newRefresh = generateRefreshToken();
  const newHash = hashRefreshToken(newRefresh);

  const created = await prisma.$transaction(async (tx) => {
    const next = await tx.userSession.create({
      data: {
        userId: session.userId,
        deviceId: session.deviceId,
        refreshTokenHash: newHash,
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        expiresAt: new Date(Date.now() + sessionTtlMs()),
      },
      select: { id: true, expiresAt: true },
    });
    await tx.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedBySessionId: next.id },
    });
    return next;
  });

  const accessToken = await signAccessToken({
    userId: session.userId,
    sessionId: created.id,
    deviceId: session.deviceId ?? undefined,
  });

  return {
    accessToken,
    refreshToken: newRefresh,
    sessionId: created.id,
    expiresAt: created.expiresAt.toISOString(),
  };
}

export async function logout(sessionId: string, userId: string): Promise<void> {
  await prisma.userSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function verifySignupOtp(email: string, code: string) {
  await verifyOtpCode(email, code, 'SIGNUP');

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { email: email.toLowerCase() },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
      include: { profile: true, referralCodes: true },
    });
    await tx.referralRelationship.updateMany({
      where: { referredUserId: updated.id, status: 'PENDING' },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
    return updated;
  });

  // Pay signup referral bonuses (no-op when set to 0).
  const rels = await prisma.referralRelationship.findMany({
    where: { referredUserId: user.id, status: 'CONFIRMED' },
    select: { id: true },
  });
  await Promise.all(rels.map((r) => grantReferralReward(r.id, 'SIGNUP_BONUS')));

  return toPublicUser(user);
}

export async function resendSignupOtp(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!user) throw badRequest('USER_NOT_FOUND', 'No account found with this email');
  if (user.emailVerifiedAt) throw badRequest('ALREADY_VERIFIED', 'Email is already verified');
  await issueOtp(user.email, 'SIGNUP', user.id);
}

export async function verifyEmail(token: string): Promise<PublicUser> {
  const userId = await verifyEmailToken(token, 'email_verify').catch(() => {
    throw badRequest('INVALID_TOKEN', 'Verification token is invalid or expired');
  });

  const confirmedIds: string[] = [];
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
      include: { profile: true, referralCodes: true },
    });
    const pending = await tx.referralRelationship.findMany({
      where: { referredUserId: userId, status: 'PENDING' },
      select: { id: true },
    });
    await tx.referralRelationship.updateMany({
      where: { referredUserId: userId, status: 'PENDING' },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
    confirmedIds.push(...pending.map((p) => p.id));
    return updated;
  });

  // Pay configurable signup bonuses (no-op when set to 0).
  await Promise.all(
    confirmedIds.map((id) => grantReferralReward(id, 'SIGNUP_BONUS')),
  );

  return toPublicUser(user);
}

export async function resendVerification(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true },
  });
  if (!user) throw unauthorized();
  if (user.emailVerifiedAt) throw badRequest('ALREADY_VERIFIED', 'Email is already verified');

  const token = await signEmailToken(userId, 'email_verify');
  await sendEmail({
    to: user.email,
    subject: 'Verify your AdShare email',
    text: `Verify your email: ${buildVerifyEmailLink(token)}`,
  });
}

export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, deletedAt: true, status: true },
  });
  // Always respond 200 to avoid account enumeration.
  if (!user || user.deletedAt || user.status === 'CLOSED') return;

  const token = await signEmailToken(user.id, 'password_reset');
  await sendEmail({
    to: email.toLowerCase(),
    subject: 'Reset your AdShare password',
    text: `Reset your password: ${buildResetPasswordLink(token)}`,
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const userId = await verifyEmailToken(token, 'password_reset').catch(() => {
    throw badRequest('INVALID_TOKEN', 'Reset token is invalid or expired');
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    await tx.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}

export async function listSessions(userId: string) {
  const sessions = await prisma.userSession.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      ipAddress: true,
      userAgent: true,
      device: { select: { platform: true, model: true } },
    },
  });
  return sessions.map((s) => ({
    id: s.id,
    active: s.revokedAt === null && s.expiresAt > new Date(),
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    device: s.device,
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const { count } = await prisma.userSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw badRequest('SESSION_NOT_FOUND', 'Active session not found');
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
