import type { Request, Response } from 'express';
import {
  disableEarning,
  earningHistory,
  enableEarning,
  getEarningStatus,
  pauseEarning,
  resumeEarning,
} from './earning.service.js';

const authOf = (req: Request) => req.auth!;

export const earningController = {
  async status(req: Request, res: Response): Promise<void> {
    res.json(await getEarningStatus(authOf(req).userId));
  },

  async enable(req: Request, res: Response): Promise<void> {
    res.json(await enableEarning(authOf(req).userId));
  },

  async pause(req: Request, res: Response): Promise<void> {
    res.json(await pauseEarning(authOf(req).userId));
  },

  async resume(req: Request, res: Response): Promise<void> {
    res.json(await resumeEarning(authOf(req).userId));
  },

  async disable(req: Request, res: Response): Promise<void> {
    res.json(await disableEarning(authOf(req).userId));
  },

  async history(req: Request, res: Response): Promise<void> {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
    res.json({ data: await earningHistory(authOf(req).userId, cursor, limit) });
  },
};
