import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Email delivery stub. In development we log the message (including tokenized
 * URLs) so flows can be exercised end-to-end. Swap `send` with a real SMTP /
 * transactional provider in production — the interface stays the same.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (env.NODE_ENV === 'production') {
    // TODO(phase 9): wire real mail transport (SMTP / provider).
    logger.warn({ to: message.to, subject: message.subject }, 'email not delivered (stub)');
    return;
  }
  logger.info({ to: message.to, subject: message.subject, text: message.text }, 'email stub');
}

export function buildVerifyEmailLink(token: string): string {
  return `${process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000'}/api/v1/auth/verify-email?token=${token}`;
}

export function buildResetPasswordLink(token: string): string {
  return `${process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000'}/api/v1/auth/reset-password?token=${token}`;
}
