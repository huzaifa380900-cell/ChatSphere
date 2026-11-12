import type { Request, Response } from 'express';
import { createApiApp } from './app.ts';
import { env } from './config/env.ts';
import { logger } from './config/logger.ts';
import { initializeDatabase } from './db/prisma.ts';

const app = createApiApp();

export async function vercelHandler(req: Request, res: Response): Promise<void> {
  try {
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

    await initializeDatabase();
    app(req, res);
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
}
