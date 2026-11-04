import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '../../database/prisma.js';
import { env } from '../../config/env.js';
import { verifyPassword } from '../../utils/passwords.js';
import { unauthorized, forbidden } from '../../utils/errors.js';

const key = () => new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AdminClaims {
  adminId: string;
  roles: string[];
  permissions: string[];
}

async function loadAdmin(adminId: string): Promise<AdminClaims | null> {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: {
      id: true,
      status: true,
      roles: { select: { adminRole: { select: { code: true, permissions: true } } } },
    },
  });
  if (!admin || admin.status !== 'ACTIVE') return null;
  const roles = admin.roles.map((r) => r.adminRole.code);
  const permissions = new Set<string>();
  for (const role of admin.roles) {
    const perms = role.adminRole.permissions as string[];
    for (const p of perms) permissions.add(p);
  }
  return { adminId: admin.id, roles, permissions: [...permissions] };
}

export async function adminLogin(email: string, password: string) {
  const admin = await prisma.adminUser.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      roles: { select: { adminRole: { select: { code: true, permissions: true } } } },
    },
  });
  if (!admin || admin.status !== 'ACTIVE') throw unauthorized('INVALID_ADMIN_CREDENTIALS', 'Invalid credentials');
  const ok = await verifyPassword(admin.passwordHash, password);
  if (!ok) throw unauthorized('INVALID_ADMIN_CREDENTIALS', 'Invalid credentials');

  const roles = admin.roles.map((r) => r.adminRole.code);
  const permissions = new Set<string>();
  for (const role of admin.roles) {
    for (const p of (role.adminRole.permissions as string[]) ?? []) permissions.add(p);
  }

  const token = await new SignJWT({ roles, permissions: [...permissions] })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(admin.id)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(key());

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  return {
    accessToken: token,
    admin: { id: admin.id, email: admin.email, name: admin.name, roles },
    expiresIn: 7200,
  };
}

export async function verifyAdminToken(token: string): Promise<AdminClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    if (!payload.sub) return null;
    const claims = await loadAdmin(payload.sub);
    if (!claims) return null;
    const payloadRoles = payload.roles as string[] | undefined;
    const payloadPerms = payload.permissions as string[] | undefined;
    return {
      ...claims,
      roles: payloadRoles ?? claims.roles,
      permissions: payloadPerms ?? claims.permissions,
    };
  } catch {
    return null;
  }
}

export function hasPermission(claims: AdminClaims, required: string[]): boolean {
  if (claims.permissions.includes('*')) return true;
  return required.every((p) => claims.permissions.includes(p));
}

export { forbidden };
