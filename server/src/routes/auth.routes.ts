import { Router, Request, Response, NextFunction } from 'express';
import { User } from '@prisma/client';
import { env } from '../config/env.ts';
import { getPrisma } from '../db/prisma.ts';
import {
  generateCsrfToken,
  generateNumericOtp,
  generateSecureRandomToken,
  hashOtp,
  hashPassword,
  sha256Hash,
  signAccessToken,
  signRefreshToken,
  verifyOtpHash,
  verifyPassword,
  verifyRefreshToken,
} from '../utils/crypto.ts';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendOtpSchema,
  resetPasswordSchema,
  verifyEmailOtpSchema,
} from '../validation/schemas.ts';
import {
  ACCESS_COOKIE_NAME,
  AuthRequest,
  CSRF_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  authRateLimiter,
  clearAuthCookies,
  getAuthCookieOptions,
  otpRateLimiter,
  requireAuth,
  requireCsrf,
} from '../middleware/security.ts';
import { sendPasswordResetEmail, sendVerificationOtpEmail } from '../services/email.service.ts';
import { recordAuditLog } from '../services/audit.service.ts';
import { Errors } from '../utils/errors.ts';
import { socketHub } from '../socket/hub.ts';

const DUMMY_BCRYPT_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4oL8s6G7r2';
const OTP_EXPIRY_MINUTES = 10;
const OTP_COOLDOWN_SECONDS = 60;
const RESET_EXPIRY_MINUTES = 30;

export function serializeSafeUser(user: User & { settings?: unknown; presence?: unknown }) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    settings: user.settings ?? null,
    presence: user.presence ?? null,
  };
}

async function createSessionAndSetCookies(req: Request, res: Response, user: User) {
  const prisma = getPrisma();
  const expiresAt = new Date(Date.now() + env.jwtRefreshExpiresInDays * 24 * 60 * 60 * 1000);
  const placeholderHash = `pending_${generateSecureRandomToken(24)}`;

  const session = await prisma.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: placeholderHash,
      userAgent: req.header('user-agent')?.slice(0, 255) ?? null,
      ipAddress: req.ip ?? null,
      deviceLabel: req.header('sec-ch-ua-platform')?.replace(/"/g, '').slice(0, 60) ?? 'Web Client',
      expiresAt,
    },
  });

  const { token: refreshToken } = signRefreshToken(user.id, session.id);
  const refreshHash = sha256Hash(refreshToken);

  await prisma.refreshSession.update({
    where: { id: session.id },
    data: { tokenHash: refreshHash },
  });

  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: session.id,
  });

  res.cookie(ACCESS_COOKIE_NAME, accessToken, getAuthCookieOptions(15 * 60 * 1000));
  res.cookie(
    REFRESH_COOKIE_NAME,
    refreshToken,
    getAuthCookieOptions(env.jwtRefreshExpiresInDays * 24 * 60 * 60 * 1000)
  );

  return session;
}

export const authRouter = Router();

authRouter.get('/csrf', (_req: Request, res: Response) => {
  const { rawToken, signedToken } = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, signedToken, getAuthCookieOptions(24 * 60 * 60 * 1000));
  res.json({
    success: true,
    data: { csrfToken: rawToken },
  });
});

authRouter.post(
  '/register',
  authRateLimiter,
  requireCsrf,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = registerSchema.parse(req.body);
      const prisma = getPrisma();

      const existingByEmail = await prisma.user.findUnique({
        where: { email: input.email },
      });

      if (existingByEmail && existingByEmail.status !== 'PENDING_VERIFICATION') {
        await hashPassword(input.password);
        res.status(202).json({
          success: true,
          data: {
            email: input.email,
            requiresVerification: true,
            message: 'If this email is eligible for registration, a 6-digit verification code has been sent.',
          },
        });
        return;
      }

      const existingUsername = await prisma.user.findUnique({
        where: { username: input.username },
      });
      if (existingUsername && existingUsername.id !== existingByEmail?.id) {
        throw Errors.conflict('That username is already in use. Choose another handle.', 'USERNAME_TAKEN');
      }

      if (existingByEmail && existingByEmail.status === 'PENDING_VERIFICATION') {
        const latestOtp = await prisma.emailVerificationOTP.findFirst({
          where: { userId: existingByEmail.id, consumedAt: null },
          orderBy: { createdAt: 'desc' },
        });

        if (latestOtp && latestOtp.resendAvailableAt > new Date()) {
          const retryAfterSeconds = Math.ceil(
            (latestOtp.resendAvailableAt.getTime() - Date.now()) / 1000
          );
          throw Errors.tooManyRequests(
            `Please wait ${retryAfterSeconds}s before requesting another verification code.`,
            { retryAfterSeconds }
          );
        }
      }

      const passwordHash = await hashPassword(input.password);
      const rawOtp = generateNumericOtp();
      const otpHash = await hashOtp(rawOtp);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
      const resendAvailableAt = new Date(now.getTime() + OTP_COOLDOWN_SECONDS * 1000);

      const user = await prisma.$transaction(async (tx) => {
        const upsertedUser = existingByEmail
          ? await tx.user.update({
              where: { id: existingByEmail.id },
              data: {
                username: input.username,
                displayName: input.displayName,
                passwordHash,
              },
            })
          : await tx.user.create({
              data: {
                email: input.email,
                username: input.username,
                displayName: input.displayName,
                passwordHash,
                role: 'USER',
                status: 'PENDING_VERIFICATION',
              },
            });

        await tx.emailVerificationOTP.updateMany({
          where: { userId: upsertedUser.id, consumedAt: null },
          data: { consumedAt: now },
        });

        await tx.emailVerificationOTP.create({
          data: {
            userId: upsertedUser.id,
            email: upsertedUser.email,
            otpHash,
            expiresAt,
            resendAvailableAt,
            maxAttempts: 5,
          },
        });

        return upsertedUser;
      });

      const mailResult = await sendVerificationOtpEmail({
        to: user.email,
        displayName: user.displayName,
        otp: rawOtp,
        expiresInMinutes: OTP_EXPIRY_MINUTES,
      });

      await recordAuditLog({
        actorId: user.id,
        action: 'AUTH_REGISTER_OTP_SENT',
        entityType: 'User',
        entityId: user.id,
        ipAddress: req.ip,
        userAgent: req.header('user-agent'),
      });

      res.status(201).json({
        success: true,
        data: {
          email: user.email,
          requiresVerification: true,
          cooldownSeconds: OTP_COOLDOWN_SECONDS,
          expiresInMinutes: OTP_EXPIRY_MINUTES,
          message: 'If this email is eligible for registration, a 6-digit verification code has been sent.',
          ...(env.nodeEnv !== 'production' && !env.smtp.enabled
            ? {
                devMailNotice: {
                  mode: mailResult.deliveryMode,
                  previewUrl: mailResult.previewUrl,
                  sandboxCode: rawOtp,
                },
              }
            : {}),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  '/verify-email',
  otpRateLimiter,
  requireCsrf,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = verifyEmailOtpSchema.parse(req.body);
      const prisma = getPrisma();

      const user = await prisma.user.findUnique({
        where: { email: input.email },
      });

      if (!user || user.status === 'SUSPENDED') {
        throw Errors.badRequest('Invalid or expired verification code.', 'INVALID_OTP');
      }

      if (user.status === 'ACTIVE') {
        throw Errors.conflict('This account has already been verified. Please sign in.', 'ALREADY_VERIFIED');
      }

      const otpRecord = await prisma.emailVerificationOTP.findFirst({
        where: {
          userId: user.id,
          consumedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!otpRecord || otpRecord.expiresAt < new Date()) {
        throw Errors.badRequest('Verification code has expired. Request a new code.', 'OTP_EXPIRED');
      }

      if (otpRecord.attempts >= otpRecord.maxAttempts) {
        throw Errors.tooManyRequests(
          'Maximum verification attempts exceeded. Request a new verification code.'
        );
      }

      const valid = await verifyOtpHash(input.otp, otpRecord.otpHash);
      if (!valid) {
        const updated = await prisma.emailVerificationOTP.update({
          where: { id: otpRecord.id },
          data: { attempts: { increment: 1 } },
        });
        const remaining = Math.max(0, updated.maxAttempts - updated.attempts);
        throw Errors.badRequest(
          `Incorrect verification code. ${remaining} attempt(s) remaining.`,
          'INVALID_OTP',
          { remainingAttempts: remaining }
        );
      }

      const now = new Date();
      const activatedUser = await prisma.$transaction(async (tx) => {
        await tx.emailVerificationOTP.update({
          where: { id: otpRecord.id },
          data: { consumedAt: now },
        });

        await tx.userSettings.upsert({
          where: { userId: user.id },
          update: {},
          create: { userId: user.id },
        });

        await tx.userPresence.upsert({
          where: { userId: user.id },
          update: {},
          create: { userId: user.id, isOnline: false, lastSeenAt: now },
        });

        return tx.user.update({
          where: { id: user.id },
          data: {
            status: 'ACTIVE',
            emailVerifiedAt: now,
            lastLoginAt: now,
          },
          include: { settings: true, presence: true },
        });
      }, {
        maxWait: 5000,
        timeout: 15000,
      });

      await createSessionAndSetCookies(req, res, activatedUser);

      await recordAuditLog({
        actorId: activatedUser.id,
        action: 'AUTH_EMAIL_VERIFIED',
        entityType: 'User',
        entityId: activatedUser.id,
        ipAddress: req.ip,
        userAgent: req.header('user-agent'),
      });

      res.json({
        success: true,
        data: {
          user: serializeSafeUser(activatedUser),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  '/resend-otp',
  otpRateLimiter,
  requireCsrf,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = resendOtpSchema.parse(req.body);
      const prisma = getPrisma();

      const user = await prisma.user.findUnique({ where: { email: input.email } });
      if (!user || user.status !== 'PENDING_VERIFICATION') {
        res.json({
          success: true,
          data: {
            cooldownSeconds: OTP_COOLDOWN_SECONDS,
            message: 'If your account is awaiting verification, a fresh code has been sent.',
          },
        });
        return;
      }

      const latest = await prisma.emailVerificationOTP.findFirst({
        where: { userId: user.id, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });

      if (latest && latest.resendAvailableAt > new Date()) {
        const retryAfterSeconds = Math.ceil(
          (latest.resendAvailableAt.getTime() - Date.now()) / 1000
        );
        throw Errors.tooManyRequests(
          `Please wait ${retryAfterSeconds}s before requesting another code.`,
          { retryAfterSeconds }
        );
      }

      const rawOtp = generateNumericOtp();
      const otpHash = await hashOtp(rawOtp);
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        await tx.emailVerificationOTP.updateMany({
          where: { userId: user.id, consumedAt: null },
          data: { consumedAt: now },
        });

        await tx.emailVerificationOTP.create({
          data: {
            userId: user.id,
            email: user.email,
            otpHash,
            expiresAt: new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000),
            resendAvailableAt: new Date(now.getTime() + OTP_COOLDOWN_SECONDS * 1000),
            maxAttempts: 5,
          },
        });
      });

      const mailResult = await sendVerificationOtpEmail({
        to: user.email,
        displayName: user.displayName,
        otp: rawOtp,
        expiresInMinutes: OTP_EXPIRY_MINUTES,
      });

      res.json({
        success: true,
        data: {
          cooldownSeconds: OTP_COOLDOWN_SECONDS,
          message: 'If your account is awaiting verification, a fresh code has been sent.',
          ...(env.nodeEnv !== 'production' && !env.smtp.enabled
            ? {
                devMailNotice: {
                  mode: mailResult.deliveryMode,
                  previewUrl: mailResult.previewUrl,
                  sandboxCode: rawOtp,
                },
              }
            : {}),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  '/login',
  authRateLimiter,
  requireCsrf,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = loginSchema.parse(req.body);
      const prisma = getPrisma();

      const user = await prisma.user.findUnique({
        where: { email: input.email },
        include: { settings: true, presence: true },
      });

      if (!user || !user.passwordHash) {
        await verifyPassword(input.password, DUMMY_BCRYPT_HASH);
        throw Errors.unauthorized('Invalid email address or password.', 'INVALID_CREDENTIALS');
      }

      const matches = await verifyPassword(input.password, user.passwordHash);
      if (!matches) {
        await recordAuditLog({
          actorId: user.id,
          action: 'AUTH_LOGIN_FAILED',
          entityType: 'User',
          entityId: user.id,
          ipAddress: req.ip,
          userAgent: req.header('user-agent'),
        });
        throw Errors.unauthorized('Invalid email address or password.', 'INVALID_CREDENTIALS');
      }

      if (user.status === 'PENDING_VERIFICATION') {
        throw Errors.forbidden(
          'Your email address has not been verified yet. Please verify with your 6-digit OTP.',
          'EMAIL_UNVERIFIED'
        );
      }

      if (user.status === 'SUSPENDED') {
        throw Errors.forbidden(
          user.suspendedReason
            ? `Your account is suspended: ${user.suspendedReason}`
            : 'Your account has been suspended by an administrator.',
          'ACCOUNT_SUSPENDED'
        );
      }

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
        include: { settings: true, presence: true },
      });

      await createSessionAndSetCookies(req, res, updatedUser);

      await recordAuditLog({
        actorId: updatedUser.id,
        action: 'AUTH_LOGIN_SUCCESS',
        entityType: 'User',
        entityId: updatedUser.id,
        ipAddress: req.ip,
        userAgent: req.header('user-agent'),
      });

      res.json({
        success: true,
        data: {
          user: serializeSafeUser(updatedUser),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  '/refresh',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawRefresh = req.cookies?.[REFRESH_COOKIE_NAME];
      if (!rawRefresh || typeof rawRefresh !== 'string') {
        clearAuthCookies(res);
        throw Errors.unauthorized('No active refresh session.', 'NO_REFRESH_TOKEN');
      }

      let decoded;
      try {
        decoded = verifyRefreshToken(rawRefresh);
      } catch {
        clearAuthCookies(res);
        throw Errors.unauthorized('Refresh token is invalid or expired.', 'INVALID_REFRESH_TOKEN');
      }

      const prisma = getPrisma();
      const incomingHash = sha256Hash(rawRefresh);
      const session = await prisma.refreshSession.findUnique({
        where: { id: decoded.sessionId },
        include: { user: { include: { settings: true, presence: true } } },
      });

      if (!session) {
        clearAuthCookies(res);
        throw Errors.unauthorized('Session no longer exists.');
      }

      if (session.revokedAt || session.tokenHash !== incomingHash) {
        // Potential refresh token replay -> revoke all sessions for safety
        await prisma.refreshSession.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        clearAuthCookies(res);
        throw Errors.unauthorized('Session security check failed. Please sign in again.', 'SESSION_REVOKED');
      }

      if (session.expiresAt < new Date() || session.user.status !== 'ACTIVE') {
        clearAuthCookies(res);
        throw Errors.unauthorized('Session expired or account inactive.');
      }

      const { token: nextRefreshToken } = signRefreshToken(session.user.id, session.id);
      const nextRefreshHash = sha256Hash(nextRefreshToken);
      const nextExpiresAt = new Date(Date.now() + env.jwtRefreshExpiresInDays * 24 * 60 * 60 * 1000);

      await prisma.refreshSession.update({
        where: { id: session.id },
        data: {
          tokenHash: nextRefreshHash,
          expiresAt: nextExpiresAt,
        },
      });

      const nextAccessToken = signAccessToken({
        sub: session.user.id,
        role: session.user.role,
        sessionId: session.id,
      });

      res.cookie(ACCESS_COOKIE_NAME, nextAccessToken, getAuthCookieOptions(15 * 60 * 1000));
      res.cookie(
        REFRESH_COOKIE_NAME,
        nextRefreshToken,
        getAuthCookieOptions(env.jwtRefreshExpiresInDays * 24 * 60 * 60 * 1000)
      );

      res.json({
        success: true,
        data: {
          user: serializeSafeUser(session.user),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  '/logout',
  requireCsrf,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawRefresh = req.cookies?.[REFRESH_COOKIE_NAME];
      if (rawRefresh && typeof rawRefresh === 'string') {
        const prisma = getPrisma();
        const hash = sha256Hash(rawRefresh);
        await prisma.refreshSession.updateMany({
          where: { tokenHash: hash, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      clearAuthCookies(res);
      res.json({ success: true, data: { loggedOut: true } });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  '/logout-all',
  requireAuth,
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const prisma = getPrisma();
      const userId = req.authUser!.id;
      await prisma.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      clearAuthCookies(res);
      await socketHub.disconnectUserSockets(userId, 'all_sessions_revoked');
      res.json({ success: true, data: { loggedOutAll: true } });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: req.authUser!.id },
      include: { settings: true, presence: true },
    });
    if (!user) {
      throw Errors.notFound('Account not found.');
    }
    res.json({
      success: true,
      data: {
        user: serializeSafeUser(user),
        sessionId: req.authUser!.sessionId,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/sessions', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const sessions = await prisma.refreshSession.findMany({
      where: {
        userId: req.authUser!.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        deviceLabel: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    res.json({
      success: true,
      data: {
        currentSessionId: req.authUser!.sessionId,
        sessions,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.delete(
  '/sessions/:sessionId',
  requireAuth,
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const prisma = getPrisma();
      const targetId = String(req.params.sessionId);
      const session = await prisma.refreshSession.findFirst({
        where: { id: targetId, userId: req.authUser!.id, revokedAt: null },
      });
      if (!session) {
        throw Errors.notFound('Active session not found.');
      }
      await prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      res.json({ success: true, data: { revokedSessionId: session.id } });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  '/forgot-password',
  authRateLimiter,
  requireCsrf,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = forgotPasswordSchema.parse(req.body);
      const prisma = getPrisma();

      const user = await prisma.user.findUnique({ where: { email: input.email } });
      let devResetNotice: Record<string, unknown> | undefined;

      if (user && user.status === 'ACTIVE') {
        const rawToken = generateSecureRandomToken(32);
        const tokenHash = sha256Hash(rawToken);
        const now = new Date();

        await prisma.$transaction(async (tx) => {
          await tx.passwordResetToken.updateMany({
            where: { userId: user.id, consumedAt: null },
            data: { consumedAt: now },
          });

          await tx.passwordResetToken.create({
            data: {
              userId: user.id,
              tokenHash,
              expiresAt: new Date(now.getTime() + RESET_EXPIRY_MINUTES * 60 * 1000),
              ipAddress: req.ip ?? null,
            },
          });
        });

        const resetUrl = `${env.appUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
        const mailResult = await sendPasswordResetEmail({
          to: user.email,
          displayName: user.displayName,
          resetUrl,
          rawToken,
          expiresInMinutes: RESET_EXPIRY_MINUTES,
        });

        if (env.nodeEnv !== 'production' && !env.smtp.enabled) {
          devResetNotice = {
            mode: mailResult.deliveryMode,
            previewUrl: mailResult.previewUrl,
            sandboxResetToken: rawToken,
          };
        }

        await recordAuditLog({
          actorId: user.id,
          action: 'AUTH_PASSWORD_RESET_REQUESTED',
          entityType: 'User',
          entityId: user.id,
          ipAddress: req.ip,
          userAgent: req.header('user-agent'),
        });
      }

      res.json({
        success: true,
        data: {
          message:
            'If an active account matches that email address, password reset instructions have been sent.',
          ...(devResetNotice ? { devResetNotice } : {}),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  '/reset-password',
  authRateLimiter,
  requireCsrf,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = resetPasswordSchema.parse(req.body);
      const prisma = getPrisma();

      const tokenHash = sha256Hash(input.token);
      const resetRecord = await prisma.passwordResetToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (!resetRecord || resetRecord.consumedAt || resetRecord.expiresAt < new Date()) {
        throw Errors.badRequest(
          'This password reset link is invalid or has expired. Request a new password reset.',
          'INVALID_RESET_TOKEN'
        );
      }

      if (resetRecord.user.status === 'SUSPENDED') {
        throw Errors.forbidden('Suspended accounts cannot reset credentials.', 'ACCOUNT_SUSPENDED');
      }

      const newPasswordHash = await hashPassword(input.newPassword);
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.update({
          where: { id: resetRecord.id },
          data: { consumedAt: now },
        });

        await tx.user.update({
          where: { id: resetRecord.userId },
          data: { passwordHash: newPasswordHash },
        });

        await tx.refreshSession.updateMany({
          where: { userId: resetRecord.userId, revokedAt: null },
          data: { revokedAt: now },
        });
      });

      clearAuthCookies(res);
      await socketHub.disconnectUserSockets(resetRecord.userId, 'password_reset');

      await recordAuditLog({
        actorId: resetRecord.userId,
        action: 'AUTH_PASSWORD_RESET_COMPLETED',
        entityType: 'User',
        entityId: resetRecord.userId,
        ipAddress: req.ip,
        userAgent: req.header('user-agent'),
      });

      res.json({
        success: true,
        data: {
          message: 'Password updated. All previous sessions were signed out for your security.',
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// Google OAuth 2.0 Authorization URL (Popup-safe & Redirect-safe)
authRouter.get('/google/url', authRateLimiter, (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!env.google.enabled) {
      throw Errors.serviceUnavailable(
        'Google OAuth 2.0 is not configured yet. Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in environment variables.',
        'GOOGLE_OAUTH_UNCONFIGURED'
      );
    }

    const state = generateSecureRandomToken(24);
    res.cookie(OAUTH_STATE_COOKIE_NAME, state, getAuthCookieOptions(10 * 60 * 1000));

    const callbackUrl = env.google.callbackUrl;
    const params = new URLSearchParams({
      client_id: env.google.clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      access_type: 'online',
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.json({
      success: true,
      data: { url, redirectUri: callbackUrl },
    });
  } catch (err) {
    next(err);
  }
});

function getFrontendOrigin() {
  return new URL(env.appUrl).origin;
}

export function handleOAuthResultPage(req: Request, res: Response) {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const reason = typeof req.query.reason === 'string' ? req.query.reason : '';
  const ok = status === 'success';
  const frontendOrigin = getFrontendOrigin();
  const callbackUrl = new URL('/auth/google/callback', frontendOrigin);
  callbackUrl.searchParams.set('status', ok ? 'success' : 'error');
  if (!ok) callbackUrl.searchParams.set('reason', reason || 'Unable to verify Google OAuth callback.');
  res.redirect(303, callbackUrl.toString());
}

export async function handleGoogleOAuthCallback(req: Request, res: Response) {
  const redirectOAuthResult = (ok: boolean, message: string) => {
    const callbackUrl = new URL('/auth/google/callback', getFrontendOrigin());
    callbackUrl.searchParams.set('status', ok ? 'success' : 'error');
    if (!ok) callbackUrl.searchParams.set('reason', message);
    res.redirect(303, callbackUrl.toString());
  };

  try {
    if (!env.google.enabled) {
      return redirectOAuthResult(false, 'Google OAuth credentials are not configured on the server.');
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const cookieState = req.cookies?.[OAUTH_STATE_COOKIE_NAME];

    res.clearCookie(OAUTH_STATE_COOKIE_NAME, {
      httpOnly: true,
      secure: env.cookie.secure,
      sameSite: env.cookie.sameSite,
      path: '/',
    });

    if (!code || !state || !cookieState || state !== cookieState) {
      return redirectOAuthResult(false, 'Invalid or expired OAuth state parameter.');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.google.clientId,
        client_secret: env.google.clientSecret,
        redirect_uri: env.google.callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      return redirectOAuthResult(false, 'Failed to exchange Google authorization code.');
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return redirectOAuthResult(false, 'Google access token missing from token response.');
    }

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      return redirectOAuthResult(false, 'Unable to verify Google account profile.');
    }

    const profile = (await profileRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };

    if (!profile.sub || !profile.email || !profile.email_verified) {
      return redirectOAuthResult(false, 'A verified Google email address is required.');
    }

    const normalizedEmail = profile.email.trim().toLowerCase();
    const prisma = getPrisma();

    const user = await prisma.$transaction(async (tx) => {
      const existingOAuth = await tx.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: 'google',
            providerAccountId: profile.sub!,
          },
        },
        include: { user: true },
      });

      if (existingOAuth) {
        if (existingOAuth.user.status === 'SUSPENDED') {
          throw new Error('ACCOUNT_SUSPENDED');
        }
        return tx.user.update({
          where: { id: existingOAuth.user.id },
          data: {
            lastLoginAt: new Date(),
            status: 'ACTIVE',
            emailVerifiedAt: existingOAuth.user.emailVerifiedAt ?? new Date(),
          },
        });
      }

      const existingEmailUser = await tx.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (existingEmailUser) {
        if (existingEmailUser.status === 'SUSPENDED') {
          throw new Error('ACCOUNT_SUSPENDED');
        }
        await tx.oAuthAccount.create({
          data: {
            userId: existingEmailUser.id,
            provider: 'google',
            providerAccountId: profile.sub!,
            providerEmail: normalizedEmail,
          },
        });
        await tx.userSettings.upsert({
          where: { userId: existingEmailUser.id },
          update: {},
          create: { userId: existingEmailUser.id },
        });
        await tx.userPresence.upsert({
          where: { userId: existingEmailUser.id },
          update: {},
          create: { userId: existingEmailUser.id, isOnline: false },
        });
        return tx.user.update({
          where: { id: existingEmailUser.id },
          data: {
            status: 'ACTIVE',
            emailVerifiedAt: existingEmailUser.emailVerifiedAt ?? new Date(),
            lastLoginAt: new Date(),
          },
        });
      }

      const baseHandle = normalizedEmail
        .split('@')[0]
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 20) || 'member';
      let candidateUsername = baseHandle.length >= 3 ? baseHandle : `${baseHandle}_user`;
      const collision = await tx.user.findUnique({ where: { username: candidateUsername } });
      if (collision) {
        candidateUsername = `${candidateUsername.slice(0, 22)}_${generateSecureRandomToken(3)}`;
      }

      const created = await tx.user.create({
        data: {
          email: normalizedEmail,
          username: candidateUsername,
          displayName: (profile.name || candidateUsername).slice(0, 60),
          role: 'USER',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          lastLoginAt: new Date(),
          oauthAccounts: {
            create: {
              provider: 'google',
              providerAccountId: profile.sub!,
              providerEmail: normalizedEmail,
            },
          },
          settings: { create: {} },
          presence: { create: { isOnline: false } },
        },
      });

      return created;
    });

    await createSessionAndSetCookies(req, res, user);

    await recordAuditLog({
      actorId: user.id,
      action: 'AUTH_GOOGLE_OAUTH_LOGIN',
      entityType: 'User',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
    });

    return redirectOAuthResult(true, 'Google authentication complete.');
  } catch (err) {
    if (err instanceof Error && err.message === 'ACCOUNT_SUSPENDED') {
      return redirectOAuthResult(false, 'This ChatSphere account has been suspended.');
    }
    return redirectOAuthResult(false, 'Authentication failed during Google callback.');
  }
}

authRouter.get(['/google/callback', '/google/callback/'], handleGoogleOAuthCallback);
