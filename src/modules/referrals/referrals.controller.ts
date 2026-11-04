import type { Request, Response } from 'express';
import { referralsHistory, referralsSummary } from './referrals.service.js';

const authOf = (req: Request) => req.auth!;

export const referralsController = {
  async summary(req: Request, res: Response): Promise<void> {
    res.json(await referralsSummary(authOf(req).userId));
  },

  async history(req: Request, res: Response): Promise<void> {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
    res.json({ data: await referralsHistory(authOf(req).userId, cursor, limit) });
  },
};
