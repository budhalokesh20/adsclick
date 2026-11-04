import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { apiLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { advertisementsController } from './advertisements.controller.js';
import { adEventSchema } from './advertisements.schemas.js';

export const advertisementsRouter = Router();

advertisementsRouter.use(requireAuth, apiLimiter);

advertisementsRouter.get('/available', advertisementsController.available);
advertisementsRouter.post('/events', validate({ body: adEventSchema }), advertisementsController.ingest);
advertisementsRouter.get('/history', advertisementsController.history);
