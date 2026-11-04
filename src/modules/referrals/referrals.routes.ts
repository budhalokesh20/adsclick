import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { apiLimiter } from '../../middleware/rate-limit.js';
import { referralsController } from './referrals.controller.js';

export const referralsRouter = Router();

referralsRouter.use(requireAuth, apiLimiter);

referralsRouter.get('/summary', referralsController.summary);
referralsRouter.get('/history', referralsController.history);
