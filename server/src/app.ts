import express, { Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './config/env.ts';
import { checkDatabaseHealth } from './db/prisma.ts';
import { apiRateLimiter, errorHandler } from './middleware/security.ts';
import { authRouter, handleGoogleOAuthCallback, handleOAuthResultPage } from './routes/auth.routes.ts';
import { usersRouter } from './routes/users.routes.ts';
import { conversationsRouter } from './routes/conversations.routes.ts';
import { uploadsRouter } from './routes/uploads.routes.ts';
import { notificationsRouter } from './routes/notifications.routes.ts';
import { adminRouter } from './routes/admin.routes.ts';
import { aiRouter } from './routes/ai.routes.ts';
import { realtimeRouter } from './routes/realtime.routes.ts';

export function createApiApp(
  registerFrontend?: (app: Express) => void,
  installErrorHandler = true
): Express {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const clean = origin.replace(/\/+$/, '');
        if (env.corsAllowedOrigins.includes(clean)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} is not permitted by CORS allowlist.`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'],
    })
  );

  app.use(cookieParser());
  app.use('/api/ai', express.json({ limit: '14mb' }));
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));

  // Operational Health Endpoint (exposes readiness booleans, never secrets)
  app.get('/api/health', async (_req, res) => {
    const db = await checkDatabaseHealth();
    res.status(db.healthy ? 200 : 503).json({
      success: db.healthy,
      data: {
        status: db.healthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          healthy: db.healthy,
          latencyMs: db.latencyMs,
          engine: db.engine,
        },
        providers: {
          neonDatabaseConfigured: env.hasExternalDatabaseUrl,
          cloudinaryConfigured: env.cloudinary.enabled,
          googleOAuthConfigured: env.google.enabled,
          smtpConfigured: env.smtp.enabled,
        },
      },
    });
  });

  app.use('/api', apiRateLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/realtime', realtimeRouter);

  // Support top-level /auth/callback OAuth redirect alias
  app.get(['/auth/callback', '/auth/callback/'], handleGoogleOAuthCallback);

  // Support top-level /auth/google/callback OAuth result page (popup fallback target)
  app.get(['/auth/google/callback', '/auth/google/callback/'], handleOAuthResultPage);

  app.use('/api/*', (_req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'ENDPOINT_NOT_FOUND',
        message: 'The requested API endpoint does not exist.',
      },
    });
  });

  if (registerFrontend) {
    registerFrontend(app);
  }

  if (installErrorHandler) {
    app.use(errorHandler);
  }

  return app;
}

/**
 * Creates the Express app with SSR middleware attached.
 * Use this in production/SSR mode instead of createApiApp alone.
 */
export async function createSsrApp(): Promise<ReturnType<typeof createApiApp>> {
  const { registerSsrMiddleware } = await import('./ssr.ts');
  const app = createApiApp(undefined, false);
  await registerSsrMiddleware(app);
  app.use(errorHandler);
  return app;
}
