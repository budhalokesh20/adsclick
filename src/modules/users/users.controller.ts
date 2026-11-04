import type { Request, Response } from 'express';
import { changePassword, deleteMe, getMe, updateMe } from './users.service.js';
import type { ChangePasswordInput, UpdateProfileInput } from './users.schemas.js';

export const usersController = {
  async getMe(req: Request, res: Response): Promise<void> {
    const auth = req.auth!;
    res.json(await getMe(auth.userId));
  },

  async updateMe(req: Request<unknown, unknown, UpdateProfileInput>, res: Response): Promise<void> {
    const auth = req.auth!;
    res.json(await updateMe(auth.userId, req.body));
  },

  async changePassword(req: Request<unknown, unknown, ChangePasswordInput>, res: Response): Promise<void> {
    const auth = req.auth!;
    await changePassword(auth.userId, auth.sessionId, req.body);
    res.status(204).send();
  },

  async deleteMe(req: Request, res: Response): Promise<void> {
    const auth = req.auth!;
    await deleteMe(auth.userId);
    res.status(204).send();
  },
};
