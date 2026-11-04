import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { apiLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { withdrawalsController } from './withdrawals.controller.js';
import { createPaymentMethodSchema, createWithdrawalSchema, paramIdSchema } from './withdrawals.schemas.js';

export const withdrawalsRouter = Router();

withdrawalsRouter.use(requireAuth, apiLimiter);

withdrawalsRouter.post('/', validate({ body: createWithdrawalSchema }), withdrawalsController.create);
withdrawalsRouter.get('/', withdrawalsController.list);
withdrawalsRouter.get('/methods', withdrawalsController.listMethods);
withdrawalsRouter.post('/methods', validate({ body: createPaymentMethodSchema }), withdrawalsController.createMethod);
withdrawalsRouter.delete('/methods/:id', validate({ params: paramIdSchema }), withdrawalsController.deleteMethod);
withdrawalsRouter.get('/:id', validate({ params: paramIdSchema }), withdrawalsController.get);
