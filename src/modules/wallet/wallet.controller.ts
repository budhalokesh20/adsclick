import type { Request, Response } from 'express';
import { getWallet, listTransactions } from './wallet.service.js';

const authOf = (req: Request) => req.auth!;

export const walletController = {
  async get(req: Request, res: Response): Promise<void> {
    res.json(await getWallet(authOf(req).userId));
  },

  async transactions(req: Request, res: Response): Promise<void> {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
    res.json({ data: await listTransactions(authOf(req).userId, cursor, limit) });
  },
};
