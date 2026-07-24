import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { sanitizeLogMessage } from '../utils/log.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const eventId = randomUUID();
  console.error(
    `[ServerError] ${JSON.stringify({
      timestamp: new Date().toISOString(),
      eventId,
      method: req.method,
      path: req.path,
      errorName: err.name,
      message: sanitizeLogMessage(err.message),
    })}`,
  );
  res.status(500).json({ error: 'Internal server error', eventId });
}
