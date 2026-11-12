import http from 'http';
import { env } from './config/env.ts';
import { logger } from './config/logger.ts';
import { initializeDatabase, shutdownDatabase } from './db/prisma.ts';
import { createApiApp, createSsrApp } from './app.ts';
import { createSocketServer } from './socket/index.ts';
import { cleanupOrphanedUploads } from './services/cloudinary.service.ts';

async function startStandaloneServer() {
  await initializeDatabase();

  // The Next.js frontend is deployed separately; Vite SSR is a local-only option.
  const useSsr = env.nodeEnv !== 'production' && process.env.SSR_MODE === 'true';
  const app = useSsr ? await createSsrApp() : createApiApp();

  if (useSsr) {
    logger.info('SSR mode enabled — React will be rendered on the server');
  }
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);

  const orphanCleanupTimer = setInterval(() => {
    cleanupOrphanedUploads(60).catch((err) => {
      logger.warn('Scheduled orphan upload cleanup encountered an error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, 15 * 60 * 1000);
  orphanCleanupTimer.unref();

  httpServer.listen(env.port, '0.0.0.0', () => {
    logger.info('ChatSphere backend server listening', {
      port: env.port,
      environment: env.nodeEnv,
    });
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}; initiating graceful shutdown`);
    clearInterval(orphanCleanupTimer);
    io.close();
    httpServer.close(async () => {
      await shutdownDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
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

startStandaloneServer().catch((err) => {
  logger.error('Failed to start ChatSphere standalone server', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
