import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { apiLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { changePasswordSchema, updateProfileSchema } from './users.schemas.js';
import { usersController } from './users.controller.js';

export const usersRouter = Router();

usersRouter.use(requireAuth, apiLimiter);

usersRouter.get('/me', usersController.getMe);
usersRouter.patch('/me', validate({ body: updateProfileSchema }), usersController.updateMe);
usersRouter.patch('/me/password', validate({ body: changePasswordSchema }), usersController.changePassword);
usersRouter.delete('/me', usersController.deleteMe);
