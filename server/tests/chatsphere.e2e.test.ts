import fs from 'fs';
import http from 'http';
import path from 'path';
import request from 'supertest';
import { v2 as cloudinary } from 'cloudinary';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeDatabase, getPrisma, shutdownDatabase } from '../src/db/prisma.ts';
import { createApiApp } from '../src/app.ts';
import { cleanupOrphanedUploads } from '../src/services/cloudinary.service.ts';
import { loadAndValidateEnv } from '../src/config/env.ts';
import { finalizeUploadSchema } from '../src/validation/schemas.ts';

type SuperAgent = ReturnType<typeof request.agent>;

async function withCsrf(agent: SuperAgent): Promise<string> {
  const res = await agent.get('/api/auth/csrf').expect(200);
  expect(res.body.success).toBe(true);
  expect(typeof res.body.data.csrfToken).toBe('string');
  return res.body.data.csrfToken as string;
}

describe('ChatSphere End-to-End Full-Stack Verification Suite', () => {
  const testPgDir = path.resolve(process.cwd(), `.pgdata-e2e-${Date.now()}`);
  let httpServer: http.Server;
  let baseUrl = '';

  let aliceAgent: SuperAgent;
  let bobAgent: SuperAgent;
  let carolAgent: SuperAgent;
  let adminAgent: SuperAgent;

  let aliceId = '';
  let bobId = '';
  let carolId = '';
  let adminId = '';
  let directConvId = '';
  let groupConvId = '';

  beforeAll(async () => {
    fs.rmSync(testPgDir, { recursive: true, force: true });
    await initializeDatabase(testPgDir);

    const app = createApiApp();
    httpServer = http.createServer(app);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        const port = typeof addr === 'object' && addr ? addr.port : 4099;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    aliceAgent = request.agent(baseUrl);
    bobAgent = request.agent(baseUrl);
    carolAgent = request.agent(baseUrl);
    adminAgent = request.agent(baseUrl);
  });

  afterAll(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    await shutdownDatabase();
    fs.rmSync(testPgDir, { recursive: true, force: true });
  });

  it('1. Health endpoint & startup env loader handle unset/placeholder env vars without crashing or leaking secrets', async () => {
    const prevTtl = process.env.CLOUDINARY_SIGNED_URL_TTL_SECONDS;
    const prevSmtpHost = process.env.SMTP_HOST;
    const prevSmtpUser = process.env.SMTP_USER;
    const prevSmtpPass = process.env.SMTP_PASS;
    const prevSmtpPassword = process.env.SMTP_PASSWORD;
    const prevVapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const prevVapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const prevVapidSubject = process.env.VAPID_SUBJECT;
    process.env.CLOUDINARY_SIGNED_URL_TTL_SECONDS = 'MY_CLOUDINARY_SIGNED_URL_TTL_SECONDS';
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_USER = 'haris380900@gmail.com';
    process.env.SMTP_PASS = 'smtp-app-password';
    process.env.SMTP_PASSWORD = 'smtp-app-password';
    process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-vapid-private-key';
    process.env.VAPID_SUBJECT = 'mailto:security@chatsphere.test';
    try {
      const parsedCfg = loadAndValidateEnv();
      expect(parsedCfg.cloudinary.signedUrlTtlSeconds).toBe(300);
      expect(parsedCfg.smtp.enabled).toBe(true);
      expect(parsedCfg.smtp.pass).toBe('smtp-app-password');
      expect(parsedCfg.webPush.enabled).toBe(true);
    } finally {
      if (prevTtl === undefined) delete process.env.CLOUDINARY_SIGNED_URL_TTL_SECONDS;
      else process.env.CLOUDINARY_SIGNED_URL_TTL_SECONDS = prevTtl;
      if (prevSmtpHost === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = prevSmtpHost;
      if (prevSmtpUser === undefined) delete process.env.SMTP_USER;
      else process.env.SMTP_USER = prevSmtpUser;
      if (prevSmtpPass === undefined) delete process.env.SMTP_PASS;
      else process.env.SMTP_PASS = prevSmtpPass;
      if (prevSmtpPassword === undefined) delete process.env.SMTP_PASSWORD;
      else process.env.SMTP_PASSWORD = prevSmtpPassword;
      if (prevVapidPublicKey === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = prevVapidPublicKey;
      if (prevVapidPrivateKey === undefined) delete process.env.VAPID_PRIVATE_KEY;
      else process.env.VAPID_PRIVATE_KEY = prevVapidPrivateKey;
      if (prevVapidSubject === undefined) delete process.env.VAPID_SUBJECT;
      else process.env.VAPID_SUBJECT = prevVapidSubject;
    }

    const res = await request(baseUrl).get('/api/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
    expect(res.body.data.database.healthy).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('test_cloudinary_signing_secret_key_998877');
  });

  it('Google OAuth callback redirects to the frontend session handshake', async () => {
    const res = await request(baseUrl)
      .get('/api/auth/google/callback?code=missing&state=missing')
      .expect(303);

    const callbackUrl = new URL(res.headers.location);
    expect(callbackUrl.origin).toBe('http://localhost:3000');
    expect(callbackUrl.pathname).toBe('/auth/google/callback');
    expect(callbackUrl.searchParams.get('status')).toBe('error');
    expect(callbackUrl.searchParams.get('reason')).toContain('OAuth state');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
  });

  it('accepts zero-duration audio metadata while still validating positive upload size', () => {
    const parsed = finalizeUploadSchema.parse({
      purpose: 'CHAT_ATTACHMENT',
      conversationId: 'conversation_123',
      cloudinaryPublicId: 'chatsphere/conversations/conversation_123/voice-note',
      cloudinarySignature: '0123456789abcdef',
      cloudinaryVersion: 1,
      resourceType: 'raw',
      mimeType: 'audio/webm',
      originalFilename: 'voice-note.webm',
      fileSize: 1,
      durationSeconds: 0,
      isVoiceNote: true,
    });
    expect(parsed.durationSeconds).toBe(0);
    expect(() =>
      finalizeUploadSchema.parse({
        purpose: 'CHAT_ATTACHMENT',
        conversationId: 'conversation_123',
        cloudinaryPublicId: 'chatsphere/conversations/conversation_123/voice-note',
        cloudinarySignature: '0123456789abcdef',
        cloudinaryVersion: 1,
        resourceType: 'raw',
        mimeType: 'audio/webm',
        originalFilename: 'voice-note.webm',
        fileSize: 0,
        durationSeconds: 1,
        isVoiceNote: true,
      })
    ).toThrow();
  });

  it('2. Registration, bcrypt OTP verification, attempt tracking, anti-enumeration & CSRF protection', async () => {
    // Reject missing CSRF token on state-changing POST
    await aliceAgent
      .post('/api/auth/register')
      .send({
        email: 'alice@chatsphere.test',
        username: 'alice_sec',
        displayName: 'Alice Vance',
        password: 'StrongPassword#2026',
      })
      .expect(403);

    const csrf = await withCsrf(aliceAgent);

    const regRes = await aliceAgent
      .post('/api/auth/register')
      .set('X-CSRF-Token', csrf)
      .send({
        email: 'alice@chatsphere.test',
        username: 'alice_sec',
        displayName: 'Alice Vance',
        password: 'StrongPassword#2026',
      })
      .expect(201);

    expect(regRes.body.data.requiresVerification).toBe(true);
    const otpCode = regRes.body.data.devMailNotice?.sandboxCode as string;
    expect(otpCode).toMatch(/^\d{6}$/);

    // Verify password & OTP are stored strictly as bcrypt hashes in PostgreSQL (never plaintext)
    const prisma = getPrisma();
    const rawDbUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'alice@chatsphere.test' },
      include: { verificationOtps: true },
    });
    expect(rawDbUser.passwordHash).not.toBe('StrongPassword#2026');
    expect(rawDbUser.passwordHash?.startsWith('$2b$')).toBe(true);
    expect(rawDbUser.verificationOtps[0].otpHash).not.toBe(otpCode);
    expect(rawDbUser.verificationOtps[0].otpHash.startsWith('$2b$')).toBe(true);
    expect(rawDbUser.role).toBe('USER');

    // Block login prior to email OTP verification
    const prematureLogin = await aliceAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'alice@chatsphere.test', password: 'StrongPassword#2026' })
      .expect(403);
    expect(prematureLogin.body.error.code).toBe('EMAIL_UNVERIFIED');

    // Wrong OTP increments attempts and returns remaining count
    const badOtp = otpCode === '000000' ? '111111' : '000000';
    const wrongOtpRes = await aliceAgent
      .post('/api/auth/verify-email')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'alice@chatsphere.test', otp: badOtp })
      .expect(400);
    expect(wrongOtpRes.body.error.code).toBe('INVALID_OTP');
    expect(wrongOtpRes.body.error.details.remainingAttempts).toBe(4);

    // Resend cooldown enforced
    await aliceAgent
      .post('/api/auth/resend-otp')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'alice@chatsphere.test' })
      .expect(429);

    // Correct OTP activates account and sets HttpOnly session cookies
    const verifyRes = await aliceAgent
      .post('/api/auth/verify-email')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'alice@chatsphere.test', otp: otpCode })
      .expect(200);

    expect(verifyRes.body.data.user.status).toBe('ACTIVE');
    aliceId = verifyRes.body.data.user.id;
    const setCookies = verifyRes.headers['set-cookie'] as unknown as string[];
    expect(setCookies.some((c) => c.startsWith('cs_access_token=') && c.includes('HttpOnly'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('cs_refresh_token=') && c.includes('HttpOnly'))).toBe(true);

    const alreadyVerified = await aliceAgent
      .post('/api/auth/verify-email')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'alice@chatsphere.test', otp: otpCode })
      .expect(409);
    expect(alreadyVerified.body.error.code).toBe('ALREADY_VERIFIED');

    // Anti-enumeration on duplicate verified email registration
    const dupAgent = request.agent(baseUrl);
    const dupCsrf = await withCsrf(dupAgent);
    const dupRes = await dupAgent
      .post('/api/auth/register')
      .set('X-CSRF-Token', dupCsrf)
      .send({
        email: 'alice@chatsphere.test',
        username: 'another_handle',
        displayName: 'Duplicate Check',
        password: 'StrongPassword#2026',
      })
      .expect(202);
    expect(dupRes.body.data.requiresVerification).toBe(true);
  });

  it('2a. AI feature endpoints require authentication, CSRF and validate requests before provider calls', async () => {
    await request(baseUrl).post('/api/ai/text').send({ instruction: 'hello' }).expect(401);
    const csrf = await withCsrf(aliceAgent);
    const status = await aliceAgent.get('/api/ai/status').expect(200);
    expect(status.body.data.providers).toHaveLength(4);

    const invalidText = await aliceAgent
      .post('/api/ai/text')
      .set('X-CSRF-Token', csrf)
      .send({ instruction: 'Write a greeting', action: 'unknown' })
      .expect(400);
    expect(invalidText.body.error.code).toBe('VALIDATION_ERROR');

    const invalidImage = await aliceAgent
      .post('/api/ai/image')
      .set('X-CSRF-Token', csrf)
      .send({ prompt: 'x', style: 'photorealistic' })
      .expect(400);
    expect(invalidImage.body.error.code).toBe('VALIDATION_ERROR');

    const unsupportedAudio = await aliceAgent
      .post('/api/ai/transcribe')
      .set('X-CSRF-Token', csrf)
      .send({ audio: Buffer.from('test audio bytes').toString('base64'), mimeType: 'video/mp4' })
      .expect(415);
    expect(unsupportedAudio.body.error.code).toBe('UNSUPPORTED_AUDIO_FORMAT');
  });

  it('3. Registers Bob, Carol, and Admin; enforces session rotation, logout & multi-device sessions', async () => {
    const registerAndActivate = async (
      agent: SuperAgent,
      email: string,
      username: string,
      displayName: string
    ) => {
      const csrf = await withCsrf(agent);
      const reg = await agent
        .post('/api/auth/register')
        .set('X-CSRF-Token', csrf)
        .send({ email, username, displayName, password: 'StrongPassword#2026' })
        .expect(201);
      const ver = await agent
        .post('/api/auth/verify-email')
        .set('X-CSRF-Token', csrf)
        .send({ email, otp: reg.body.data.devMailNotice.sandboxCode })
        .expect(200);
      return ver.body.data.user.id as string;
    };

    bobId = await registerAndActivate(bobAgent, 'bob@chatsphere.test', 'bob_ops', 'Bob Mercer');
    carolId = await registerAndActivate(carolAgent, 'carol@chatsphere.test', 'carol_dev', 'Carol Chen');
    adminId = await registerAndActivate(adminAgent, 'admin@chatsphere.test', 'sec_admin', 'Platform Admin');

    // Promote admin exclusively on server side via Prisma (mimicking bootstrap-admin CLI)
    const prisma = getPrisma();
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'ADMIN' },
    });

    // Test refresh token rotation for Alice
    const refreshRes = await aliceAgent.post('/api/auth/refresh').expect(200);
    expect(refreshRes.body.data.user.id).toBe(aliceId);

    // Second device login for Alice -> creates 2 concurrent sessions
    const aliceSecondDevice = request.agent(baseUrl);
    const csrf2 = await withCsrf(aliceSecondDevice);
    await aliceSecondDevice
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf2)
      .send({ email: 'alice@chatsphere.test', password: 'StrongPassword#2026' })
      .expect(200);

    const sessionsRes = await aliceAgent.get('/api/auth/sessions').expect(200);
    expect(sessionsRes.body.data.sessions.length).toBe(2);

    // Logout second device -> revokes only that session
    await aliceSecondDevice.post('/api/auth/logout').set('X-CSRF-Token', csrf2).expect(200);
    await aliceSecondDevice.get('/api/auth/me').expect(401);
    await aliceAgent.get('/api/auth/me').expect(200);
  });

  it('4. Google OAuth 2.0 URL generation & state anti-CSRF callback verification', async () => {
    const oauthAgent = request.agent(baseUrl);
    const urlRes = await oauthAgent.get('/api/auth/google/url').expect(200);
    expect(urlRes.body.data.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(urlRes.body.data.redirectUri).toContain('/api/auth/google/callback');

    // Tampered state parameter must be rejected
    const badCallback = await oauthAgent
      .get('/api/auth/google/callback?code=fake_code&state=tampered_state')
      .expect(303);
    const callbackUrl = new URL(badCallback.headers.location);
    expect(callbackUrl.pathname).toBe('/auth/google/callback');
    expect(callbackUrl.searchParams.get('status')).toBe('error');
    expect(callbackUrl.searchParams.get('reason')).toContain('Invalid or expired OAuth state');
  });

  it('5. Forgot-password and reset-password flow hashes reset token and invalidates prior sessions', async () => {
    const resetAgent = request.agent(baseUrl);
    const csrf = await withCsrf(resetAgent);

    const forgotRes = await resetAgent
      .post('/api/auth/forgot-password')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'carol@chatsphere.test' })
      .expect(200);

    const rawToken = forgotRes.body.data.devResetNotice.sandboxResetToken as string;
    expect(rawToken.length).toBeGreaterThan(20);

    // Verify DB does not store plaintext reset token
    const prisma = getPrisma();
    const storedTokens = await prisma.passwordResetToken.findMany({ where: { userId: carolId } });
    expect(storedTokens[0].tokenHash).not.toBe(rawToken);

    await resetAgent
      .post('/api/auth/reset-password')
      .set('X-CSRF-Token', csrf)
      .send({ token: rawToken, newPassword: 'UpdatedPassword#2027' })
      .expect(200);

    // Carol's previous session must now be revoked
    await carolAgent.get('/api/auth/me').expect(401);

    // Re-login Carol with new password
    const carolCsrf = await withCsrf(carolAgent);
    await carolAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', carolCsrf)
      .send({ email: 'carol@chatsphere.test', password: 'UpdatedPassword#2027' })
      .expect(200);
  });

  it('6. Enforces strict USER vs ADMIN RBAC and blocks privilege escalation', async () => {
    // Standard USER cannot access admin overview or user list
    await aliceAgent.get('/api/admin/overview').expect(403);
    await aliceAgent.get('/api/admin/users').expect(403);

    // Attempted role injection on profile update is ignored by Zod & Prisma
    const aliceCsrf = await withCsrf(aliceAgent);
    const profRes = await aliceAgent
      .patch('/api/users/me/profile')
      .set('X-CSRF-Token', aliceCsrf)
      .send({ displayName: 'Alice Vance', role: 'ADMIN' })
      .expect(200);
    expect(profRes.body.data.user.role).toBe('USER');

    const userSearch = await aliceAgent.get('/api/users/search?q=Platform').expect(200);
    expect(userSearch.body.data.users).not.toContainEqual(
      expect.objectContaining({ id: adminId })
    );

    await aliceAgent
      .post('/api/conversations/direct')
      .set('X-CSRF-Token', aliceCsrf)
      .send({ targetUserId: adminId })
      .expect(404);

    // Admin has full access to overview, users, reports, and audit logs
    const overviewRes = await adminAgent.get('/api/admin/overview').expect(200);
    expect(overviewRes.body.data.stats.totalUsers).toBe(4);

    const auditRes = await adminAgent.get('/api/admin/audit-logs').expect(200);
    expect(auditRes.body.data.logs.length).toBeGreaterThan(0);
  });

  it('7. Direct messaging deduplication, idempotency, cursor pagination & receipts', async () => {
    const aliceCsrf = await withCsrf(aliceAgent);

    const [convRes1, concurrentConvRes] = await Promise.all([
      aliceAgent
        .post('/api/conversations/direct')
        .set('X-CSRF-Token', aliceCsrf)
        .send({ targetUserId: bobId })
        .expect(201),
      aliceAgent
        .post('/api/conversations/direct')
        .set('X-CSRF-Token', aliceCsrf)
        .send({ targetUserId: bobId })
        .expect(201),
    ]);
    directConvId = convRes1.body.data.conversation.id;
    expect(concurrentConvRes.body.data.conversation.id).toBe(directConvId);

    // Duplicate direct conversation request returns the exact same conversation
    const convRes2 = await aliceAgent
      .post('/api/conversations/direct')
      .set('X-CSRF-Token', aliceCsrf)
      .send({ targetUserId: bobId })
      .expect(201);
    expect(convRes2.body.data.conversation.id).toBe(directConvId);

    // Outsider Carol cannot read Alice-Bob direct messages
    await carolAgent.get(`/api/conversations/${directConvId}/messages`).expect(403);

    // Idempotent message creation using clientMessageId
    const msgRes1 = await aliceAgent
      .post(`/api/conversations/${directConvId}/messages`)
      .set('X-CSRF-Token', aliceCsrf)
      .send({ clientMessageId: 'idem_key_001', content: 'Hello Bob, encrypted check!' })
      .expect(201);
    expect(msgRes1.body.data.duplicate).toBe(false);

    const msgRes2 = await aliceAgent
      .post(`/api/conversations/${directConvId}/messages`)
      .set('X-CSRF-Token', aliceCsrf)
      .send({ clientMessageId: 'idem_key_001', content: 'Hello Bob, encrypted check!' })
      .expect(200);
    expect(msgRes2.body.data.duplicate).toBe(true);
    expect(msgRes2.body.data.message.id).toBe(msgRes1.body.data.message.id);

    // Insert additional messages to verify cursor pagination
    for (let i = 2; i <= 5; i++) {
      await aliceAgent
        .post(`/api/conversations/${directConvId}/messages`)
        .set('X-CSRF-Token', aliceCsrf)
        .send({ clientMessageId: `idem_key_00${i}`, content: `Paginated message #${i}` })
        .expect(201);
    }

    const page1 = await bobAgent
      .get(`/api/conversations/${directConvId}/messages?limit=3`)
      .expect(200);
    expect(page1.body.data.messages.length).toBe(3);
    expect(page1.body.data.hasMore).toBe(true);
    expect(typeof page1.body.data.nextCursor).toBe('string');

    const page2 = await bobAgent
      .get(`/api/conversations/${directConvId}/messages?limit=3&cursor=${page1.body.data.nextCursor}`)
      .expect(200);
    expect(page2.body.data.messages.length).toBe(2);
    expect(page2.body.data.hasMore).toBe(false);

    // Bob marks conversation read -> resets unread count and updates read receipts
    const bobCsrf = await withCsrf(bobAgent);
    const readRes = await bobAgent
      .post(`/api/conversations/${directConvId}/read`)
      .set('X-CSRF-Token', bobCsrf)
      .expect(200);
    expect(readRes.body.data.markedCount).toBe(5);
  });

  it('8. Group conversations & strict membership revocation enforcement', async () => {
    const aliceCsrf = await withCsrf(aliceAgent);
    const grpRes = await aliceAgent
      .post('/api/conversations/group')
      .set('X-CSRF-Token', aliceCsrf)
      .send({
        name: 'Core Incident Response',
        description: 'Production security ops room',
        memberIds: [bobId, carolId],
        onlyAdminsCanPost: false,
      })
      .expect(201);

    groupConvId = grpRes.body.data.conversation.id;
    expect(grpRes.body.data.conversation.members.length).toBe(3);
    const bobNotifications = await bobAgent.get('/api/notifications').expect(200);
    const inviteNotification = bobNotifications.body.data.notifications.find(
      (notification: { type: string; conversationId: string; userId: string }) =>
        notification.type === 'GROUP_INVITE' && notification.conversationId === groupConvId
    );
    expect(inviteNotification?.userId).toBe(bobId);

    // Carol can view messages while she is an active member
    await carolAgent.get(`/api/conversations/${groupConvId}/messages`).expect(200);

    // Non-admin Bob cannot remove Carol
    const bobCsrf = await withCsrf(bobAgent);
    await bobAgent
      .delete(`/api/conversations/${groupConvId}/members/${carolId}`)
      .set('X-CSRF-Token', bobCsrf)
      .expect(403);

    // Group Owner Alice removes Carol -> Carol immediately loses access
    await aliceAgent
      .delete(`/api/conversations/${groupConvId}/members/${carolId}`)
      .set('X-CSRF-Token', aliceCsrf)
      .expect(200);

    await carolAgent.get(`/api/conversations/${groupConvId}/messages`).expect(403);
    const carolCsrf = await withCsrf(carolAgent);
    await carolAgent
      .post(`/api/conversations/${groupConvId}/messages`)
      .set('X-CSRF-Token', carolCsrf)
      .send({ clientMessageId: 'carol_blocked_1', content: 'Should fail' })
      .expect(403);
  });

  it('stores and removes authenticated per-device push subscriptions', async () => {
    const configRes = await bobAgent.get('/api/notifications/push/config').expect(200);
    expect(typeof configRes.body.data.enabled).toBe('boolean');
    const csrf = await withCsrf(bobAgent);

    if (!configRes.body.data.enabled) {
      await bobAgent
        .post('/api/notifications/push/subscriptions')
        .set('X-CSRF-Token', csrf)
        .send({
          endpoint: 'https://push.example.test/subscription',
          keys: { p256dh: 'public-key', auth: 'auth-key' },
        })
        .expect(400);
      return;
    }

    const endpoint = 'https://push.example.test/subscription';
    await bobAgent
      .post('/api/notifications/push/subscriptions')
      .set('X-CSRF-Token', csrf)
      .send({
        endpoint,
        expirationTime: null,
        keys: { p256dh: 'public-key', auth: 'auth-key' },
      })
      .expect(201);

    const registered = await bobAgent
      .get('/api/notifications/push/subscriptions/status')
      .query({ endpoint })
      .expect(200);
    expect(registered.body.data.currentDeviceRegistered).toBe(true);

    await bobAgent
      .delete('/api/notifications/push/subscriptions')
      .set('X-CSRF-Token', csrf)
      .send({ endpoint })
      .expect(200);
    const removed = await bobAgent
      .get('/api/notifications/push/subscriptions/status')
      .query({ endpoint })
      .expect(200);
    expect(removed.body.data.currentDeviceRegistered).toBe(false);
  });

  it('9. Cloudinary upload validation, signature verification, private media authorization & orphan cleanup', async () => {
    const aliceCsrf = await withCsrf(aliceAgent);

    // Reject disallowed executable MIME / extension
    const badMime = await aliceAgent
      .post('/api/uploads/sign')
      .set('X-CSRF-Token', aliceCsrf)
      .send({
        purpose: 'CHAT_ATTACHMENT',
        conversationId: directConvId,
        filename: 'payload.exe',
        mimeType: 'application/x-msdownload',
        fileSize: 2048,
      })
      .expect(400);
    expect(badMime.body.error.code).toBe('INVALID_FILE_TYPE');

    // Reject spoofed magic bytes (e.g.,MZ header disguised as image/png)
    const badMagic = await aliceAgent
      .post('/api/uploads/sign')
      .set('X-CSRF-Token', aliceCsrf)
      .send({
        purpose: 'CHAT_ATTACHMENT',
        conversationId: directConvId,
        filename: 'spoofed.png',
        mimeType: 'image/png',
        fileSize: 4096,
        magicBytesHex: '4d5a900005173000',
      })
      .expect(400);
    expect(badMagic.body.error.code).toBe('FILE_SIGNATURE_MISMATCH');

    // Reject oversized file (> 10MB image limit)
    const tooLarge = await aliceAgent
      .post('/api/uploads/sign')
      .set('X-CSRF-Token', aliceCsrf)
      .send({
        purpose: 'CHAT_ATTACHMENT',
        conversationId: directConvId,
        filename: 'huge.png',
        mimeType: 'image/png',
        fileSize: 25 * 1024 * 1024,
        magicBytesHex: '89504e470d0a1a0a',
      })
      .expect(400);
    expect(tooLarge.body.error.code).toBe('FILE_TOO_LARGE');

    // Valid PNG upload sign request generates short-lived server signature without exposing secret
    const signRes = await aliceAgent
      .post('/api/uploads/sign')
      .set('X-CSRF-Token', aliceCsrf)
      .send({
        purpose: 'CHAT_ATTACHMENT',
        conversationId: directConvId,
        filename: 'architecture.png',
        mimeType: 'image/png',
        fileSize: 120400,
        magicBytesHex: '89504e470d0a1a0a',
      })
      .expect(200);

    expect(signRes.body.data.deliveryType).toBe('authenticated');
    expect(JSON.stringify(signRes.body)).not.toContain('test_cloudinary_signing_secret_key_998877');

    const publicId = signRes.body.data.publicId as string;
    const version = 1751731122;

    // Tampered finalize signature is rejected
    await aliceAgent
      .post('/api/uploads/finalize')
      .set('X-CSRF-Token', aliceCsrf)
      .send({
        purpose: 'CHAT_ATTACHMENT',
        conversationId: directConvId,
        cloudinaryPublicId: publicId,
        cloudinarySignature: '0000000000000000000000000000000000000000',
        cloudinaryVersion: version,
        resourceType: 'image',
        mimeType: 'image/png',
        originalFilename: 'architecture.png',
        fileSize: 120400,
        width: 1280,
        height: 720,
      })
      .expect(400);

    // Authentic Cloudinary signature finalizes metadata in PostgreSQL
    const validSignature = cloudinary.utils.api_sign_request(
      { public_id: publicId, version },
      process.env.CLOUDINARY_API_SECRET!
    );

    const finalizeRes = await aliceAgent
      .post('/api/uploads/finalize')
      .set('X-CSRF-Token', aliceCsrf)
      .send({
        purpose: 'CHAT_ATTACHMENT',
        conversationId: directConvId,
        cloudinaryPublicId: publicId,
        cloudinarySignature: validSignature,
        cloudinaryVersion: version,
        resourceType: 'image',
        mimeType: 'image/png',
        originalFilename: 'architecture.png',
        fileSize: 120400,
        width: 1280,
        height: 720,
      })
      .expect(201);

    const attachmentId = finalizeRes.body.data.attachment.id as string;
    expect(finalizeRes.body.data.attachment.url).toContain('s--');

    // Attach to a persistent message
    await aliceAgent
      .post(`/api/conversations/${directConvId}/messages`)
      .set('X-CSRF-Token', aliceCsrf)
      .send({
        clientMessageId: 'media_msg_001',
        content: 'Attached architecture diagram',
        type: 'MEDIA',
        attachmentIds: [attachmentId],
      })
      .expect(201);

    // Authorized conversation peer Bob can fetch refreshed signed URL; non-member Carol gets 403
    const bobUrlRes = await bobAgent.get(`/api/uploads/attachments/${attachmentId}/url`).expect(200);
    expect(bobUrlRes.body.data.url).toContain('res.cloudinary.com');
    await carolAgent.get(`/api/uploads/attachments/${attachmentId}/url`).expect(403);

    // Test staged upload cancellation & orphan cleanup job
    const signStaged = await aliceAgent
      .post('/api/uploads/sign')
      .set('X-CSRF-Token', aliceCsrf)
      .send({
        purpose: 'CHAT_ATTACHMENT',
        conversationId: directConvId,
        filename: 'draft.pdf',
        mimeType: 'application/pdf',
        fileSize: 8192,
        magicBytesHex: '255044462d312e37',
      })
      .expect(200);

    const stagedSig = cloudinary.utils.api_sign_request(
      { public_id: signStaged.body.data.publicId, version },
      process.env.CLOUDINARY_API_SECRET!
    );

    const stagedFin = await aliceAgent
      .post('/api/uploads/finalize')
      .set('X-CSRF-Token', aliceCsrf)
      .send({
        purpose: 'CHAT_ATTACHMENT',
        conversationId: directConvId,
        cloudinaryPublicId: signStaged.body.data.publicId,
        cloudinarySignature: stagedSig,
        cloudinaryVersion: version,
        resourceType: 'raw',
        mimeType: 'application/pdf',
        originalFilename: 'draft.pdf',
        fileSize: 8192,
      })
      .expect(201);

    const stagedId = stagedFin.body.data.attachment.id as string;
    // Age staged upload in DB so orphan cleaner picks it up
    const prisma = getPrisma();
    await prisma.messageAttachment.update({
      where: { id: stagedId },
      data: { uploadedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });

    const cleanedCount = await cleanupOrphanedUploads(60);
    expect(cleanedCount).toBe(1);
    const afterClean = await prisma.messageAttachment.findUniqueOrThrow({ where: { id: stagedId } });
    expect(afterClean.status).toBe('ORPHANED');
  });

  it('10. Realtime authorization, typing, and reconnect sync use authenticated HTTP APIs', async () => {
    const unauthenticated = await request(baseUrl)
      .post('/api/realtime/auth')
      .send({ socket_id: '123.456', channel_name: `private-user-${aliceId}` })
      .expect(401);
    expect(unauthenticated.body.error.code).toBe('UNAUTHORIZED');

    const aliceCsrf = await withCsrf(aliceAgent);
    const channelAuth = await aliceAgent
      .post('/api/realtime/auth')
      .set('X-CSRF-Token', aliceCsrf)
      .send({ socket_id: '123.456', channel_name: `private-user-${aliceId}` })
      .expect(503);
    expect(channelAuth.body.error.code).toBe('PUSHER_NOT_CONFIGURED');

    const invalidMembership = await aliceAgent
      .post('/api/realtime/typing')
      .set('X-CSRF-Token', aliceCsrf)
      .send({ conversationId: 'not-a-conversation', isTyping: true })
      .expect(403);
    expect(invalidMembership.body.error.code).toBe('NOT_CONVERSATION_MEMBER');

    const typing = await aliceAgent
      .post('/api/realtime/typing')
      .set('X-CSRF-Token', aliceCsrf)
      .send({ conversationId: directConvId, isTyping: true })
      .expect(503);
    expect(typing.body.error.code).toBe('PUSHER_NOT_CONFIGURED');

    const since = new Date().toISOString();
    for (const [clientMessageId, content] of [
      ['realtime_http_msg_01', 'Persisted through the serverless HTTP API'],
      ['realtime_http_msg_02', 'Available through reconnect delta sync'],
    ]) {
      await aliceAgent
        .post(`/api/conversations/${directConvId}/messages`)
        .set('X-CSRF-Token', aliceCsrf)
        .send({ clientMessageId, content })
        .expect(201);
    }

    const delta = await bobAgent
      .get(`/api/conversations/${directConvId}/messages`)
      .query({ after: since })
      .expect(200);
    expect(
      delta.body.data.messages.map((message: { clientMessageId: string }) => message.clientMessageId)
    ).toEqual(['realtime_http_msg_01', 'realtime_http_msg_02']);
  });

  it('11. Abuse report moderation & suspended account access revocation', async () => {

    // Alice submits an abuse report against Carol
    const aliceCsrf = await withCsrf(aliceAgent);
    const repRes = await aliceAgent
      .post('/api/notifications/reports')
      .set('X-CSRF-Token', aliceCsrf)
      .send({
        targetUserId: carolId,
        reason: 'SPAM',
        details: 'Automated spam messages detected during test scenario.',
      })
      .expect(201);

    // Admin resolves report and suspends Carol
    const adminCsrf = await withCsrf(adminAgent);
    await adminAgent
      .patch(`/api/admin/reports/${repRes.body.data.report.id}`)
      .set('X-CSRF-Token', adminCsrf)
      .send({
        status: 'RESOLVED',
        resolutionNotes: 'Confirmed spam activity; account suspended.',
        deleteReportedMessage: false,
        suspendTargetUser: true,
      })
      .expect(200);

    // Suspended Carol cannot call protected endpoints or log back in
    await carolAgent.get('/api/conversations').expect(403);
    const freshCarol = request.agent(baseUrl);
    const freshCsrf = await withCsrf(freshCarol);
    const blockedLogin = await freshCarol
      .post('/api/auth/login')
      .set('X-CSRF-Token', freshCsrf)
      .send({ email: 'carol@chatsphere.test', password: 'UpdatedPassword#2027' })
      .expect(403);
    expect(blockedLogin.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('12. Persistence across full database client shutdown and restart', async () => {
    await shutdownDatabase();
    const reopenedPrisma = await initializeDatabase(testPgDir);

    const persistedMessages = await reopenedPrisma.message.count({
      where: { conversationId: directConvId },
    });
    expect(persistedMessages).toBeGreaterThanOrEqual(8);

    const persistedAuditLogs = await reopenedPrisma.auditLog.count();
    expect(persistedAuditLogs).toBeGreaterThanOrEqual(5);
  });
});
