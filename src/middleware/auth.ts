import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../database/prisma.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/tokens.js';

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized();
    }
    const token = header.slice('Bearer '.length);
    let claims: { userId: string; sessionId: string; deviceId?: string };
    try {
      claims = await verifyAccessToken(token);
    } catch {
      throw unauthorized('TOKEN_EXPIRED', 'Access token is invalid or expired');
    }

    const [user, session] = await Promise.all([
      prisma.user.findUnique({
        where: { id: claims.userId },
        select: { id: true, status: true, emailVerifiedAt: true, deletedAt: true },
      }),
      prisma.userSession.findUnique({
        where: { id: claims.sessionId },
        select: { userId: true, revokedAt: true, expiresAt: true },
      }),
    ]);

    if (!user || user.deletedAt) {
      throw unauthorized('UNAUTHORIZED', 'Account not found');
    }
    if (!session || session.userId !== user.id || session.revokedAt || session.expiresAt < new Date()) {
      throw unauthorized('SESSION_REVOKED', 'Session is no longer active');
    }
    if (user.status === 'SUSPENDED' || user.status === 'CLOSED') {
      throw forbidden('ACCOUNT_SUSPENDED', 'Account is suspended');
    }

    req.auth = {
      userId: user.id,
      sessionId: claims.sessionId,
      deviceId: claims.deviceId,
      emailVerified: user.emailVerifiedAt !== null,
      status: user.status,
    };
    next();
  } catch (err) {
    next(err);
  }
}
