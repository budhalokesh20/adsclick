import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

const key = () => new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  deviceId?: string;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ sid: claims.sessionId, dev: claims.deviceId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(key());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, key());
  if (!payload.sub || typeof payload.sid !== 'string') {
    throw new Error('Malformed token claims');
  }
  return {
    userId: payload.sub,
    sessionId: payload.sid,
    deviceId: typeof payload.dev === 'string' ? payload.dev : undefined,
  };
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Random opaque token for email verification / password reset (JWT-signed below). */
export function signEmailToken(userId: string, purpose: 'email_verify' | 'password_reset'): Promise<string> {
  return new SignJWT({ purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(purpose === 'email_verify' ? '24h' : '1h')
    .sign(key());
}

export interface EmailTokenClaims {
  userId: string;
  purpose: 'email_verify' | 'password_reset';
}

export async function verifyEmailToken(token: string, purpose: EmailTokenClaims['purpose']): Promise<string> {
  const { payload } = await jwtVerify(token, key());
  if (payload.purpose !== purpose || !payload.sub) {
    throw new Error('Invalid token purpose');
  }
  return payload.sub;
}
