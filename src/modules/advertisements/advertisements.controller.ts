import type { Request, Response } from 'express';
import { prisma } from '../../database/prisma.js';
import { getAvailableAd, ingestAdEvent } from './advertisements.service.js';
import type { AdEventInput } from './advertisements.schemas.js';

const authOf = (req: {
  auth?: { userId: string; sessionId: string; deviceId?: string; emailVerified: boolean; status: string };
}) => req.auth!;

export const advertisementsController = {
  async available(req: Request, res: Response): Promise<void> {
    res.json(await getAvailableAd(authOf(req).userId, authOf(req).deviceId));
  },

  async ingest(req: Request<unknown, unknown, AdEventInput>, res: Response): Promise<void> {
    const result = await ingestAdEvent(authOf(req).userId, req.body, authOf(req).deviceId);
    res.status(202).json(result);
  },

  async history(req: Request, res: Response): Promise<void> {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
    const events = await prisma.advertisementEvent.findMany({
      where: { userId: authOf(req).userId, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        eventType: true,
        validationStatus: true,
        rejectionReason: true,
        createdAt: true,
        campaign: { select: { name: true } },
      },
    });
    res.json({
      data: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        validationStatus: e.validationStatus,
        rejectionReason: e.rejectionReason,
        campaign: e.campaign?.name ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  },
};
