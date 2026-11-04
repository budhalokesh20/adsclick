import type { Request, Response } from 'express';
import {
  createPaymentMethod,
  createWithdrawal,
  deletePaymentMethod,
  getWithdrawal,
  listPaymentMethods,
  listWithdrawals,
} from './withdrawals.service.js';
import type { CreatePaymentMethodInput, CreateWithdrawalInput } from './withdrawals.schemas.js';

const authOf = (req: {
  auth?: { userId: string; sessionId: string; deviceId?: string; emailVerified: boolean; status: string };
}) => req.auth!;
const cursorOf = (req: Request) => (typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
const limitOf = (req: Request) => (typeof req.query.limit === 'string' ? Number(req.query.limit) : 20);

export const withdrawalsController = {
  async create(req: Request<unknown, unknown, CreateWithdrawalInput>, res: Response): Promise<void> {
    const result = await createWithdrawal(authOf(req).userId, req.body);
    res.status(201).json(result);
  },

  async list(req: Request, res: Response): Promise<void> {
    res.json({ data: await listWithdrawals(authOf(req).userId, cursorOf(req), limitOf(req)) });
  },

  async get(req: Request<{ id: string }>, res: Response): Promise<void> {
    res.json(await getWithdrawal(authOf(req).userId, req.params.id));
  },

  async createMethod(req: Request<unknown, unknown, CreatePaymentMethodInput>, res: Response): Promise<void> {
    const method = await createPaymentMethod(authOf(req).userId, req.body);
    res.status(201).json(method);
  },

  async listMethods(req: Request, res: Response): Promise<void> {
    res.json({ data: await listPaymentMethods(authOf(req).userId) });
  },

  async deleteMethod(req: Request<{ id: string }>, res: Response): Promise<void> {
    await deletePaymentMethod(authOf(req).userId, req.params.id);
    res.status(204).send();
  },
};
