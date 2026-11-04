import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.header('X-Request-Id') as string | undefined) ?? randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
