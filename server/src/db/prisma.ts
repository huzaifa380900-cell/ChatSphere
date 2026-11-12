import fs from 'fs';
import net from 'net';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { env } from '../config/env.ts';
import { logger } from '../config/logger.ts';

let prismaInstance: PrismaClient | null = null;
let embeddedPg: PGlite | null = null;
let embeddedSocketServer: PGLiteSocketServer | null = null;
let initPromise: Promise<PrismaClient> | null = null;
let activeDatabaseMode: 'neon-postgresql' | 'embedded-postgresql' = env.hasExternalDatabaseUrl
  ? 'neon-postgresql'
  : 'embedded-postgresql';

async function findFreeLocalPort(preferredPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', () => {
      const fallback = net.createServer();
      fallback.once('error', reject);
      fallback.listen(0, '127.0.0.1', () => {
        const addr = fallback.address();
        const port = typeof addr === 'object' && addr ? addr.port : 5439;
        fallback.close(() => resolve(port));
      });
    });
    tester.listen(preferredPort, '127.0.0.1', () => {
      tester.close(() => resolve(preferredPort));
    });
  });
}

async function applySqlMigrationsToPglite(pg: PGlite) {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS "_chatsphere_migrations" (
      "name" TEXT PRIMARY KEY,
      "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrationsDirCandidates = [
    path.resolve(process.cwd(), 'chatsphere/server/prisma/migrations'),
    path.resolve(process.cwd(), 'prisma/migrations'),
  ];
  const migrationsRoot = migrationsDirCandidates.find((p) => fs.existsSync(p));
  if (!migrationsRoot) {
    throw new Error('Prisma migrations directory not found.');
  }

  const entries = fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const folderName of entries) {
    const sqlPath = path.join(migrationsRoot, folderName, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;

    const existing = await pg.query<{ name: string }>(
      `SELECT "name" FROM "_chatsphere_migrations" WHERE "name" = $1`,
      [folderName]
    );
    if (existing.rows.length > 0) continue;

    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
    await pg.exec(sqlContent);
    await pg.query(`INSERT INTO "_chatsphere_migrations" ("name") VALUES ($1)`, [folderName]);
    logger.info('Applied PostgreSQL Prisma migration', { migration: folderName });
  }
}

function getDatabaseUrlForRuntime(databaseUrl: string): string {
  if (!process.env.VERCEL) return databaseUrl;
  const url = new URL(databaseUrl);
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', '1');
  }
  return url.toString();
}

export async function initializeDatabase(customDataDir?: string): Promise<PrismaClient> {
  if (prismaInstance) return prismaInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (env.hasExternalDatabaseUrl && !customDataDir) {
      activeDatabaseMode = 'neon-postgresql';
      const databaseUrl = getDatabaseUrlForRuntime(env.databaseUrl!);
      process.env.DATABASE_URL = databaseUrl;
      process.env.DIRECT_URL = env.directUrl ?? env.databaseUrl;

      prismaInstance = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
        log: env.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
      });
      await prismaInstance.$connect();
      logger.info('Connected Prisma ORM to Neon PostgreSQL database');
      return prismaInstance;
    }

    activeDatabaseMode = 'embedded-postgresql';
    const dataDir =
      customDataDir ??
      path.resolve(
        process.cwd(),
        process.env.VITEST ? '.pgdata-test' : '.pgdata'
      );
    fs.mkdirSync(dataDir, { recursive: true });

    embeddedPg = new PGlite(dataDir);
    await embeddedPg.waitReady;
    await applySqlMigrationsToPglite(embeddedPg);

    const port = await findFreeLocalPort(process.env.VITEST ? 5438 : 5433);
    embeddedSocketServer = new PGLiteSocketServer({
      db: embeddedPg,
      host: '127.0.0.1',
      port,
      maxConnections: 20,
    });
    await embeddedSocketServer.start();

    const localConnUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable&connection_limit=1`;
    process.env.DATABASE_URL = localConnUrl;
    process.env.DIRECT_URL = localConnUrl;

    prismaInstance = new PrismaClient({
      datasources: { db: { url: localConnUrl } },
      log: ['error'],
    });
    await prismaInstance.$connect();
    logger.info('Initialized persistent PostgreSQL 16 engine for Prisma ORM', {
      port,
      persistentDirectory: path.basename(dataDir),
    });
    return prismaInstance;
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

export function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    throw new Error('Database has not been initialized yet. Call initializeDatabase() first.');
  }
  return prismaInstance;
}

export function getDatabaseEngineMode() {
  return activeDatabaseMode;
}

export async function checkDatabaseHealth(): Promise<{ healthy: boolean; latencyMs: number; engine: string }> {
  const start = Date.now();
  try {
    const db = await initializeDatabase();
    await db.$queryRaw`SELECT 1`;
    return {
      healthy: true,
      latencyMs: Date.now() - start,
      engine: activeDatabaseMode,
    };
  } catch (err) {
    logger.error('Database health check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      engine: activeDatabaseMode,
    };
  }
}

export async function shutdownDatabase(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
  if (embeddedSocketServer) {
    await embeddedSocketServer.stop();
    embeddedSocketServer = null;
  }
  if (embeddedPg) {
    await embeddedPg.close();
    embeddedPg = null;
  }
  initPromise = null;
}
