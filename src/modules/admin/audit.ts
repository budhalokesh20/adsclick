import type { Request } from 'express';
import { prisma } from '../../database/prisma.js';

export async function audit(
  req: Request,
  action: string,
  entityType?: string,
  entityId?: string,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorType: 'ADMIN',
      actorId: req.admin?.adminId ?? null,
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      before: before === undefined ? undefined : (before as never),
      after: after === undefined ? undefined : (after as never),
      ipAddress: req.ip ?? null,
      metadata: { path: req.path } as never,
    },
  });
}
