import type { Request, Response } from 'express';
import { listCurrencies } from './currencies.service.js';

export const currenciesController = {
  async list(_req: Request, res: Response): Promise<void> {
    res.json({ data: listCurrencies() });
  },
};
