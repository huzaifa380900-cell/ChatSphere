import crypto from 'crypto';
import { initializeDatabase, shutdownDatabase } from '../src/db/prisma.ts';
import { hashPassword } from '../src/utils/crypto.ts';
import { recordAuditLog } from '../src/services/audit.service.ts';

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : undefined;
}

async function runBootstrap() {
  const configuredSecret = process.env.ADMIN_BOOTSTRAP_TOKEN?.trim();
  const suppliedSecret = parseArg('token') ?? process.env.BOOTSTRAP_TOKEN?.trim();

  if (!configuredSecret || configuredSecret.includes('CHANGE_ME') || configuredSecret.length < 16) {
    console.error(
      'ERROR: Set a strong ADMIN_BOOTSTRAP_TOKEN (>= 16 chars) in your .env before running bootstrap-admin.'
    );
    process.exit(1);
  }

  if (!suppliedSecret) {
    console.error('ERROR: Supply --token=<ADMIN_BOOTSTRAP_TOKEN> to authorize admin bootstrap.');
    process.exit(1);
  }

  const bufA = Buffer.from(configuredSecret, 'utf8');
  const bufB = Buffer.from(suppliedSecret, 'utf8');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    console.error('ERROR: Invalid bootstrap authorization token.');
    process.exit(1);
  }

  const email = parseArg('email')?.toLowerCase();
  const username = parseArg('username')?.toLowerCase() || 'platform_admin';
  const displayName = parseArg('name') || 'Platform Administrator';
  const password = parseArg('password');
  const force = process.argv.includes('--force');

  if (!email) {
    console.error(
      'Usage: npx tsx scripts/bootstrap-admin.ts --email="admin@yourdomain.com" --password="StrongPassword123" --token="<ADMIN_BOOTSTRAP_TOKEN>"'
    );
    process.exit(1);
  }

  const prisma = await initializeDatabase();

  try {
    const existingAdminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (existingAdminCount > 0 && !force) {
      console.error(
        `ABORTED: ${existingAdminCount} ADMIN account(s) already exist. Pass --force if you intend to promote another administrator.`
      );
      process.exit(1);
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    let adminUser;

    if (existingUser) {
      adminUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          role: 'ADMIN',
          status: 'ACTIVE',
          emailVerifiedAt: existingUser.emailVerifiedAt ?? new Date(),
        },
      });
      console.log(`Promoted existing account ${adminUser.email} (${adminUser.id}) to ADMIN.`);
    } else {
      if (!password || password.length < 12) {
        console.error(
          'ERROR: Creating a new initial ADMIN account requires --password with at least 12 characters.'
        );
        process.exit(1);
      }
      const passwordHash = await hashPassword(password);
      adminUser = await prisma.user.create({
        data: {
          email,
          username,
          displayName,
          passwordHash,
          role: 'ADMIN',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          settings: { create: {} },
          presence: { create: { isOnline: false } },
        },
      });
      console.log(`Created initial ADMIN account ${adminUser.email} (${adminUser.id}).`);
    }

    await recordAuditLog({
      actorId: adminUser.id,
      targetUserId: adminUser.id,
      action: 'ADMIN_BOOTSTRAPPED',
      entityType: 'User',
      entityId: adminUser.id,
      metadata: { via: 'cli_bootstrap_script' },
    });
  } finally {
    await shutdownDatabase();
  }
}

runBootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
