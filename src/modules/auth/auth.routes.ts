import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import {
  forgotPasswordSchema,
  loginSchema,
  paramIdSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.schemas.js';
import { authController } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), authController.register);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), authController.login);
authRouter.post('/refresh', authLimiter, validate({ body: refreshSchema }), authController.refresh);
authRouter.post('/logout', requireAuth, authController.logout);
authRouter.post('/verify-email', authLimiter, validate({ body: verifyEmailSchema }), authController.verifyEmail);
authRouter.post('/resend-verification', requireAuth, authLimiter, authController.resendVerification);
authRouter.post('/forgot-password', authLimiter, validate({ body: forgotPasswordSchema }), authController.forgotPassword);
authRouter.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), authController.resetPassword);

authRouter.get('/sessions', requireAuth, authController.sessions);
authRouter.delete('/sessions', requireAuth, authController.revokeAllSessions);
authRouter.delete('/sessions/:id', requireAuth, validate({ params: paramIdSchema }), authController.revokeSession);
