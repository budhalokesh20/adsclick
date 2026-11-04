import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { apiLimiter } from '../../middleware/rate-limit.js';
import { earningController } from './earning.controller.js';

export const earningRouter = Router();

earningRouter.use(requireAuth, apiLimiter);

earningRouter.get('/status', earningController.status);
earningRouter.post('/enable', earningController.enable);
earningRouter.post('/pause', earningController.pause);
earningRouter.post('/resume', earningController.resume);
earningRouter.post('/disable', earningController.disable);
earningRouter.get('/history', earningController.history);
