import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { apiLimiter } from '../../middleware/rate-limit.js';
import { walletController } from './wallet.controller.js';

export const walletRouter = Router();

walletRouter.use(requireAuth, apiLimiter);

walletRouter.get('/', walletController.get);
walletRouter.get('/transactions', walletController.transactions);
