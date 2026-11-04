import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { apiLimiter } from '../../middleware/rate-limit.js';
import { currenciesController } from './currencies.controller.js';

export const currenciesRouter = Router();

currenciesRouter.use(requireAuth, apiLimiter);
currenciesRouter.get('/', currenciesController.list);
