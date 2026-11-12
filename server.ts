import http from 'http';
import path from 'path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { env } from './chatsphere/server/src/config/env.ts';
import { logger } from './chatsphere/server/src/config/logger.ts';
import { initializeDatabase, shutdownDatabase } from './chatsphere/server/src/db/prisma.ts';
import { createApiApp } from './chatsphere/server/src/app.ts';
import { createSocketServer } from './chatsphere/server/src/socket/index.ts';
import { cleanupOrphanedUploads } from './chatsphere/server/src/services/cloudinary.service.ts';

async function startFullStackServer() {
  await initializeDatabase();

  const isProd = process.env.NODE_ENV === 'production';
  const port = 3000;

  let vite: Awaited<ReturnType<typeof createViteServer>> | null = null;
  if (!isProd) {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
  }

  const app = createApiApp((expressApp) => {
    const publicDir = path.resolve(process.cwd(), 'public');
    expressApp.use(express.static(publicDir));

    if (!isProd && vite) {
      expressApp.use(vite.middlewares);
    } else {
      const distPath = path.resolve(process.cwd(), 'dist');
      expressApp.use(express.static(distPath));
      expressApp.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  });

  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);

  const orphanCleanupTimer = setInterval(() => {
    cleanupOrphanedUploads(60).catch((err) => {
      logger.warn('Orphaned upload cleanup warning', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, 15 * 60 * 1000);
  orphanCleanupTimer.unref();

  httpServer.listen(port, '0.0.0.0', () => {
    logger.info('ChatSphere full-stack server running', {
      port,
      mode: isProd ? 'production' : 'development',
      appUrl: env.appUrl,
    });
  });

  const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    clearInterval(orphanCleanupTimer);
    io.close();
    if (vite) {
      await vite.close();
    }
    httpServer.close(async () => {
      await shutdownDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — server will continue running', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection — server will continue running', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

startFullStackServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
