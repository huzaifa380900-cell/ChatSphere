import express from 'express';
import type { Request, Response } from 'express';
import { createApiApp } from './app.ts';
import { env } from './config/env.ts';
import { logger } from './config/logger.ts';
import { initializeDatabase } from './db/prisma.ts';

const app = express();
app.use(async (_req, res, next) => {
  if (!env.hasExternalDatabaseUrl) {
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_NOT_CONFIGURED',
        message: 'A PostgreSQL DATABASE_URL is required for serverless deployments.',
      },
    });
    return;
  }

  try {
    await initializeDatabase();
    next();
  } catch (error) {
    logger.error('Vercel API initialization failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) {
      res.status(503).json({
        success: false,
        error: {
          code: 'API_UNAVAILABLE',
          message: 'The API is temporarily unavailable.',
        },
      });
    }
  }
});
app.use(createApiApp());

export default app;

export async function vercelHandler(req: Request, res: Response): Promise<void> {
  app(req, res);
}
