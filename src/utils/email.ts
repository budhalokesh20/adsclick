import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const t = getTransporter();

  if (!t) {
    // No SMTP configured → log (dev) or warn (prod) so OTP flows still work
    // in development. Production should always have SMTP set.
    if (env.NODE_ENV === 'production') {
      logger.error({ to: message.to, subject: message.subject }, 'SMTP not configured — email not sent');
    } else {
      logger.info({ to: message.to, subject: message.subject, text: message.text }, 'email stub (no SMTP)');
    }
    return;
  }

  await t.sendMail({
    from: env.SMTP_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

export function buildVerifyEmailLink(token: string): string {
  return `${process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000'}/api/v1/auth/verify-email?token=${token}`;
}

export function buildResetPasswordLink(token: string): string {
  return `${process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000'}/api/v1/auth/reset-password?token=${token}`;
}
