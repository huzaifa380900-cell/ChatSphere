import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import next from 'next';
import { env } from '../server/dist/src/config/env.js';
import { logger } from '../server/dist/src/config/logger.js';
import { initializeDatabase, shutdownDatabase } from '../server/dist/src/db/prisma.js';
import { cleanupOrphanedUploads } from '../server/dist/src/services/cloudinary.service.js';
import { createApiApp } from '../server/dist/src/app.js';

const clientRoot = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = env.nodeEnv !== 'production';

async function startServer() {
  await initializeDatabase();

  const nextApp = next({ dev: isDevelopment, dir: clientRoot });
  await nextApp.prepare();
  const nextHandler = nextApp.getRequestHandler();

  const app = createApiApp((expressApp) => {
    expressApp.use((req, res) => {
      void nextHandler(req, res).catch((error) => {
        logger.error('Next.js request handler failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!res.headersSent) {
          res.status(500).end('Internal Server Error');
        } else {
          res.destroy(error instanceof Error ? error : undefined);
        }
      });
    });
  });

  const httpServer = createServer(app);

  const orphanCleanupTimer = setInterval(() => {
    cleanupOrphanedUploads(60).catch((error) => {
      logger.warn('Scheduled orphan upload cleanup encountered an error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 15 * 60 * 1000);
  orphanCleanupTimer.unref();

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(env.port, '0.0.0.0', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  logger.info('ChatSphere unified server listening', {
    port: env.port,
    environment: env.nodeEnv,
    appUrl: env.appUrl,
  });

  let isShuttingDown = false;
  const gracefulShutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`Received ${signal}; initiating graceful shutdown`);
    clearInterval(orphanCleanupTimer);

    try {
      if (httpServer.listening) {
        await new Promise((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      }
      await nextApp.close();
      await shutdownDatabase();
    } catch (error) {
      logger.error('Graceful shutdown failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    }
  };

  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — server will continue running', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection — server will continue running', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

startServer().catch((error) => {
  logger.error('Failed to start ChatSphere unified server', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
