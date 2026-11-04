import type { NextFunction, Request, Response } from 'express';
import { hasPermission, verifyAdminToken, type AdminClaims } from '../modules/admin/admin.auth.service.js';
import { forbidden, unauthorized } from '../utils/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminClaims;
    }
  }
}

export function requireAdmin(requiredPermissions: string[] = []) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      next(unauthorized('ADMIN_UNAUTHORIZED', 'Admin authentication required'));
      return;
    }
    const claims = await verifyAdminToken(header.slice('Bearer '.length));
    if (!claims) {
      next(unauthorized('ADMIN_UNAUTHORIZED', 'Admin session invalid or expired'));
      return;
    }
    if (requiredPermissions.length > 0 && !hasPermission(claims, requiredPermissions)) {
      next(forbidden('ADMIN_FORBIDDEN', 'Insufficient admin permissions'));
      return;
    }
    req.admin = claims;
    next();
  };
}

export const adminAuth = requireAdmin();
