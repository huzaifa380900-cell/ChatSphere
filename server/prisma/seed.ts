import { initializeDatabase, shutdownDatabase } from '../src/db/prisma.ts';
import { hashPassword } from '../src/utils/crypto.ts';

/**
 * OPTIONAL DEVELOPMENT-ONLY SEED SCRIPT
 * Strictly blocked in production environments. All records are explicitly prefixed with [DEV TEST].
 */
async function runDevSeed() {
  if (process.env.NODE_ENV === 'production' || process.env.STRICT_PRODUCTION_ENV === 'true') {
    console.error('REFUSED: Development seed script must never be executed in production.');
    process.exit(1);
  }

  const devPassword = process.env.DEV_SEED_PASSWORD;
  if (!devPassword || devPassword.length < 10) {
    console.error(
      'Provide DEV_SEED_PASSWORD (>= 10 chars) in your environment when running the optional dev seed script.'
    );
    process.exit(1);
  }

  const prisma = await initializeDatabase();

  try {
    const passwordHash = await hashPassword(devPassword);
    const now = new Date();

    const alice = await prisma.user.upsert({
      where: { email: 'alice.devtest@chatsphere.local' },
      update: {},
      create: {
        email: 'alice.devtest@chatsphere.local',
        username: 'devtest_alice',
        displayName: '[DEV TEST] Alice Chen',
        bio: 'Development test engineering lead account',
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        emailVerifiedAt: now,
        settings: { create: {} },
        presence: { create: { isOnline: false } },
      },
    });

    const marcus = await prisma.user.upsert({
      where: { email: 'marcus.devtest@chatsphere.local' },
      update: {},
      create: {
        email: 'marcus.devtest@chatsphere.local',
        username: 'devtest_marcus',
        displayName: '[DEV TEST] Marcus Vance',
        bio: 'Development test security architect account',
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        emailVerifiedAt: now,
        settings: { create: {} },
        presence: { create: { isOnline: false } },
      },
    });

    const directKey = [alice.id, marcus.id].sort().join(':');
    const existingDm = await prisma.conversation.findUnique({ where: { directKey } });

    if (!existingDm) {
      await prisma.conversation.create({
        data: {
          type: 'DIRECT',
          directKey,
          createdById: alice.id,
          members: {
            create: [
              { userId: alice.id, role: 'MEMBER' },
              { userId: marcus.id, role: 'MEMBER', unreadCount: 1 },
            ],
          },
          messages: {
            create: {
              clientMessageId: 'dev_seed_msg_001',
              senderId: alice.id,
              type: 'TEXT',
              content: '[DEV TEST] Welcome to the local development workspace.',
            },
          },
        },
      });
    }

    console.log('Development test seed completed ([DEV TEST] Alice & Marcus created).');
  } finally {
    await shutdownDatabase();
  }
}

runDevSeed().catch((err) => {
  console.error('Development seed failed:', err);
  process.exit(1);
});
