import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { requestId } from './middleware/request-id.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { advertisementsRouter } from './modules/advertisements/advertisements.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { currenciesRouter } from './modules/currencies/currencies.routes.js';
import { earningRouter } from './modules/earning/earning.routes.js';
import { referralsRouter } from './modules/referrals/referrals.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { walletRouter } from './modules/wallet/wallet.routes.js';
import { withdrawalsRouter } from './modules/withdrawals/withdrawals.routes.js';
import { logger } from './utils/logger.js';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(requestId);

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(
        { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start },
        'http',
      );
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'adshare-api', time: new Date().toISOString() });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/earning', earningRouter);
  app.use('/api/v1/advertisements', advertisementsRouter);
  app.use('/api/v1/wallet', walletRouter);
  app.use('/api/v1/withdrawals', withdrawalsRouter);
  app.use('/api/v1/referrals', referralsRouter);
  app.use('/api/v1/currencies', currenciesRouter);
  app.use('/api/v1/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
