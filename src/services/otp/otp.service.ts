import { createHash, randomInt } from 'node:crypto';
import { prisma } from '../../database/prisma.js';
import { badRequest } from '../../utils/errors.js';
import { sendEmail } from '../../utils/email.js';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

export type OtpPurpose = 'SIGNUP' | 'PASSWORD_RESET';

export function generateOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

function hashCode(code: string, email: string): string {
  return createHash('sha256').update(`${email.toLowerCase()}:${code}`).digest('hex');
}

interface OtpRecord {
  id: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  usedAt: Date | null;
  email: string;
}

async function latestOtp(email: string, purpose: OtpPurpose): Promise<OtpRecord | null> {
  return prisma.emailOtp.findFirst({
    where: { email: email.toLowerCase(), purpose, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/** Creates a new OTP, invalidates previous ones, and emails it. */
export async function issueOtp(email: string, purpose: OtpPurpose, userId?: string): Promise<void> {
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.$transaction(async (tx) => {
    await tx.emailOtp.updateMany({
      where: { email: email.toLowerCase(), purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.emailOtp.create({
      data: {
        userId: userId ?? null,
        email: email.toLowerCase(),
        purpose,
        codeHash: hashCode(code, email),
        expiresAt,
      },
    });
  });

  await sendEmail({
    to: email,
    subject: purpose === 'SIGNUP' ? 'Your AdShare verification code' : 'Your AdShare reset code',
    text: `Your AdShare verification code is ${code}. It expires in 10 minutes.`,
  });
}

export function verifyOtpCode(email: string, code: string, purpose: OtpPurpose): Promise<OtpRecord> {
  return prisma.$transaction(async (tx) => {
    const otp = await latestOtp(email, purpose).then((row) =>
      row ? { ...row, codeHash: row.codeHash } : null,
    );
    if (!otp) throw badRequest('INVALID_OTP', 'Invalid or expired code');
    if (otp.usedAt) throw badRequest('INVALID_OTP', 'Code already used');
    if (otp.attempts >= MAX_ATTEMPTS) throw badRequest('OTP_ATTEMPTS_EXCEEDED', 'Too many attempts, request a new code');
    if (otp.expiresAt < new Date()) throw badRequest('INVALID_OTP', 'Code expired');

    if (hashCode(code, otp.email) !== otp.codeHash) {
      await tx.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw badRequest('INVALID_OTP', 'Incorrect code');
    }

    await tx.emailOtp.update({ where: { id: otp.id }, data: { usedAt: new Date(), attempts: { increment: 1 } } });
    return otp;
  });
}
