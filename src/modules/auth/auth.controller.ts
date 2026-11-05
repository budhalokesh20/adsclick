import type { Request, Response } from 'express';
import {
  forgotPassword,
  googleLogin,
  listSessions,
  login,
  logout,
  refresh,
  register,
  resendSignupOtp,
  resendVerification,
  resetPassword,
  revokeAllSessions,
  revokeSession,
  verifyEmail,
  verifySignupOtp,
} from './auth.service.js';
import type {
  GoogleAuthInput,
  LoginInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyOtpInput,
} from './auth.schemas.js';

const metaOf = (req: { ip?: string; header(name: string): string | undefined }) => ({
  ip: req.ip,
  userAgent: req.header('User-Agent'),
});

export const authController = {
  async register(req: Request<unknown, unknown, RegisterInput>, res: Response): Promise<void> {
    const result = await register(req.body, metaOf(req));
    res.status(201).json(result);
  },

  async login(req: Request<unknown, unknown, LoginInput>, res: Response): Promise<void> {
    const result = await login(req.body, metaOf(req));
    res.json(result);
  },

  async refresh(req: Request<unknown, unknown, RefreshInput>, res: Response): Promise<void> {
    const result = await refresh(req.body.refreshToken, metaOf(req));
    res.json(result);
  },

  async logout(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    await logout(req.auth.sessionId, req.auth.userId);
    res.status(204).send();
  },

  async verifyEmail(req: Request<unknown, unknown, { token: string }>, res: Response): Promise<void> {
    const user = await verifyEmail(req.body.token);
    res.json({ user });
  },

  async verifyOtp(req: Request<unknown, unknown, VerifyOtpInput>, res: Response): Promise<void> {
    const user = await verifySignupOtp(req.body.email, req.body.code);
    res.json({ user });
  },

  async resendOtp(req: Request<unknown, unknown, { email: string }>, res: Response): Promise<void> {
    await resendSignupOtp(req.body.email);
    res.status(204).send();
  },

  async google(req: Request<unknown, unknown, GoogleAuthInput>, res: Response): Promise<void> {
    const result = await googleLogin(req.body, metaOf(req));
    res.json(result);
  },

  async resendVerification(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    await resendVerification(req.auth.userId);
    res.status(204).send();
  },

  async forgotPassword(req: Request<unknown, unknown, { email: string }>, res: Response): Promise<void> {
    await forgotPassword(req.body.email);
    res.status(204).send();
  },

  async resetPassword(req: Request<unknown, unknown, ResetPasswordInput>, res: Response): Promise<void> {
    await resetPassword(req.body.email, req.body.code, req.body.newPassword);
    res.status(204).send();
  },

  async sessions(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    res.json({ data: await listSessions(req.auth.userId) });
  },

  async revokeSession(req: Request<{ id: string }>, res: Response): Promise<void> {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    await revokeSession(req.auth.userId, req.params.id);
    res.status(204).send();
  },

  async revokeAllSessions(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    await revokeAllSessions(req.auth.userId);
    res.status(204).send();
  },
};
