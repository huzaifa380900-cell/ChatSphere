import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.ts';

const BCRYPT_ROUNDS = 12;

export interface AccessTokenPayload {
  sub: string;
  role: 'USER' | 'ADMIN';
  sessionId: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
  jti: string;
  type: 'refresh';
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10);
}

export async function verifyOtpHash(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash);
}

export function generateNumericOtp(): string {
  const num = crypto.randomInt(100000, 1000000);
  return String(num);
}

export function generateSecureRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256Hash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'access' },
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessExpiresIn as jwt.SignOptions['expiresIn'] }
  );
}

export function signRefreshToken(userId: string, sessionId: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: userId, sessionId, jti, type: 'refresh' },
    env.jwtRefreshSecret,
    { expiresIn: `${env.jwtRefreshExpiresInDays}d` }
  );
  return { token, jti };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
  if (decoded.type !== 'access' || !decoded.sub || !decoded.sessionId) {
    throw new Error('Malformed access token');
  }
  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.jwtRefreshSecret) as RefreshTokenPayload;
  if (decoded.type !== 'refresh' || !decoded.sub || !decoded.sessionId) {
    throw new Error('Malformed refresh token');
  }
  return decoded;
}

export function generateCsrfToken(): { rawToken: string; signedToken: string } {
  const rawToken = crypto.randomBytes(24).toString('hex');
  const signature = crypto
    .createHmac('sha256', env.csrfSecret)
    .update(rawToken)
    .digest('hex');
  return { rawToken, signedToken: `${rawToken}.${signature}` };
}

export function verifyCsrfTokenPair(headerToken: string | undefined, cookieSignedToken: string | undefined): boolean {
  if (!headerToken || !cookieSignedToken) return false;
  const parts = cookieSignedToken.split('.');
  if (parts.length !== 2) return false;
  const [rawFromCookie, sigFromCookie] = parts;
  if (headerToken !== rawFromCookie) return false;

  const expectedSig = crypto
    .createHmac('sha256', env.csrfSecret)
    .update(rawFromCookie)
    .digest('hex');

  const bufA = Buffer.from(sigFromCookie, 'utf8');
  const bufB = Buffer.from(expectedSig, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
