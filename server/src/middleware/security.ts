import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { Role, AccountStatus } from '@prisma/client';
import { env } from '../config/env.ts';
import { getPrisma } from '../db/prisma.ts';
import { verifyAccessToken, verifyCsrfTokenPair } from '../utils/crypto.ts';
import { AppError, Errors } from '../utils/errors.ts';
import { logger } from '../config/logger.ts';

export const ACCESS_COOKIE_NAME = 'cs_access_token';
export const REFRESH_COOKIE_NAME = 'cs_refresh_token';
export const CSRF_COOKIE_NAME = 'cs_csrf_token';
export const OAUTH_STATE_COOKIE_NAME = 'cs_oauth_state';

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: Role;
  status: AccountStatus;
  sessionId: string;
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
}

export function getAuthCookieOptions(maxAgeMs: number) {
  const secure = env.cookie.secure;
  const sameSite = env.cookie.sameSite === 'none' && !secure ? 'lax' : env.cookie.sameSite;
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: maxAgeMs,
    ...(env.cookie.domain ? { domain: env.cookie.domain } : {}),
  };
}

export function clearAuthCookies(res: Response) {
  const secure = env.cookie.secure;
  const sameSite = env.cookie.sameSite === 'none' && !secure ? 'lax' : env.cookie.sameSite;
  const base = {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    ...(env.cookie.domain ? { domain: env.cookie.domain } : {}),
  };
  res.clearCookie(ACCESS_COOKIE_NAME, base);
  res.clearCookie(REFRESH_COOKIE_NAME, base);
  res.clearCookie(CSRF_COOKIE_NAME, base);
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, base);
}

export async function requireAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[ACCESS_COOKIE_NAME];
    if (!token || typeof token !== 'string') {
      throw Errors.unauthorized('Authentication required. Please sign in.');
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      throw Errors.unauthorized('Access token is expired or invalid.', 'TOKEN_EXPIRED');
    }

    const prisma = getPrisma();
    const session = await prisma.refreshSession.findUnique({
      where: { id: decoded.sessionId },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      throw Errors.unauthorized('Your session has expired or been signed out.', 'SESSION_REVOKED');
    }

    const user = session.user;
    if (user.status === 'SUSPENDED') {
      throw Errors.forbidden(
        user.suspendedReason
          ? `Your account has been suspended: ${user.suspendedReason}`
          : 'Your account has been suspended by an administrator.',
        'ACCOUNT_SUSPENDED'
      );
    }

    if (session.revokedAt) {
      throw Errors.unauthorized('Your session has expired or been signed out.', 'SESSION_REVOKED');
    }

    if (user.status === 'PENDING_VERIFICATION') {
      throw Errors.forbidden(
        'Please complete email OTP verification before accessing ChatSphere.',
        'EMAIL_UNVERIFIED'
      );
    }

    req.authUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      sessionId: session.id,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  if (!req.authUser) {
    return next(Errors.unauthorized());
  }
  if (req.authUser.role !== 'ADMIN') {
    return next(Errors.forbidden('Administrator privileges are required.', 'ADMIN_REQUIRED'));
  }
  return next();
}

export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  if (safeMethods.has(req.method.toUpperCase())) {
    return next();
  }

  const headerToken = req.header('x-csrf-token');
  const cookieSignedToken = req.cookies?.[CSRF_COOKIE_NAME];

  if (!verifyCsrfTokenPair(headerToken, cookieSignedToken)) {
    return next(
      Errors.forbidden(
        'Invalid or missing CSRF security token. Refresh the page and try again.',
        'CSRF_INVALID'
      )
    );
  }

  return next();
}

const isTestEnv = Boolean(process.env.VITEST) || env.nodeEnv === 'test';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 500 : 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many authentication attempts. Please wait a few minutes before retrying.',
    },
  },
});

export const otpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: isTestEnv ? 500 : 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many verification code requests. Please wait before trying again.',
    },
  },
});

export const uploadRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: isTestEnv ? 500 : 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Upload rate limit exceeded. Please wait briefly before uploading more files.',
    },
  },
});

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTestEnv ? 2000 : 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down.',
    },
  },
});

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'The uploaded content exceeds the allowed size limit.' } });
    return;
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ success: false, error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' } });
    return;
  }

  if (err instanceof ZodError) {
    const formatted = err.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: formatted[0]?.message || 'Invalid request payload.',
        details: formatted,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  logger.error('Unhandled API exception', {
    method: req.method,
    path: req.originalUrl,
    error: err instanceof Error ? err.message : String(err),
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred. Please try again shortly.',
    },
  });
}
