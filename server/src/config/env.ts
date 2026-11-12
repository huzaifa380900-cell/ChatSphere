import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export function isRealValue(val: string | undefined | null): val is string {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  const upper = trimmed.toUpperCase();
  if (
    upper.startsWith('YOUR_') ||
    upper.startsWith('YOUR-') ||
    upper.startsWith('MY_') ||
    upper.includes('CHANGE_ME') ||
    trimmed.includes('ep-example') ||
    trimmed.includes('@example.com') ||
    trimmed === 'your-smtp-app-password'
  ) {
    return false;
  }
  return true;
}

function parseEnvInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER
): number {
  if (!isRealValue(raw)) return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function parseEnvEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  if (!isRealValue(raw)) return fallback;
  const normalized = raw.trim().toLowerCase() as T;
  return (allowed as readonly string[]).includes(normalized) ? normalized : fallback;
}

function parseJwtDuration(raw: string | undefined, fallback: string): string {
  if (!isRealValue(raw)) return fallback;
  const trimmed = raw.trim();
  return /^\d+(ms|s|m|h|d)?$/i.test(trimmed) ? trimmed : fallback;
}

function getOrCreateLocalKeyFile(): { access: string; refresh: string; csrf: string } {
  const keyFilePath = path.resolve(process.cwd(), '.pgdata', '.dev-jwt-keys.json');
  try {
    if (fs.existsSync(keyFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(keyFilePath, 'utf-8'));
      if (parsed.access && parsed.refresh && parsed.csrf) {
        return parsed;
      }
    }
    fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
    const generated = {
      access: crypto.randomBytes(48).toString('hex'),
      refresh: crypto.randomBytes(48).toString('hex'),
      csrf: crypto.randomBytes(48).toString('hex'),
    };
    fs.writeFileSync(keyFilePath, JSON.stringify(generated, null, 2), { mode: 0o600 });
    return generated;
  } catch {
    return {
      access: crypto.randomBytes(48).toString('hex'),
      refresh: crypto.randomBytes(48).toString('hex'),
      csrf: crypto.randomBytes(48).toString('hex'),
    };
  }
}

export function loadAndValidateEnv() {
  const raw: Record<string, string | undefined> = { ...process.env };

  const nodeEnv = parseEnvEnum(
    raw.NODE_ENV,
    ['development', 'test', 'production'] as const,
    'development'
  );
  const strictProd = nodeEnv === 'production' || raw.STRICT_PRODUCTION_ENV === 'true';

  if (strictProd) {
    const isPostgresUrl = (value: string | undefined) =>
      isRealValue(value) && /^postgres(?:ql)?:\/\//i.test(value.trim());
    const isSigningSecret = (value: string | undefined) =>
      isRealValue(value) && value.trim().length >= 32;
    const requiredInStrictProd: Array<[string, boolean]> = [
      ['DATABASE_URL', isPostgresUrl(raw.DATABASE_URL)],
      ['DIRECT_URL', isPostgresUrl(raw.DIRECT_URL)],
      ['JWT_ACCESS_SECRET', isSigningSecret(raw.JWT_ACCESS_SECRET)],
      ['JWT_REFRESH_SECRET', isSigningSecret(raw.JWT_REFRESH_SECRET)],
      ['CSRF_SECRET', isSigningSecret(raw.CSRF_SECRET)],
      ['CLOUDINARY_CLOUD_NAME', isRealValue(raw.CLOUDINARY_CLOUD_NAME)],
      ['CLOUDINARY_API_KEY', isRealValue(raw.CLOUDINARY_API_KEY)],
      ['CLOUDINARY_API_SECRET', isRealValue(raw.CLOUDINARY_API_SECRET)],
      ['SMTP_HOST', isRealValue(raw.SMTP_HOST)],
      ['SMTP_USER', isRealValue(raw.SMTP_USER)],
      ['SMTP_PASS', isRealValue(raw.SMTP_PASS) || isRealValue(raw.SMTP_PASSWORD)],
    ];
    const missing = requiredInStrictProd
      .filter(([, configured]) => !configured)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(
        `Fatal configuration error: Missing required production environment variables: ${missing.join(', ')}`
      );
    }
  }

  const port = parseEnvInt(raw.PORT, 4000, 1, 65535);
  const jwtRefreshExpiresInDays = parseEnvInt(raw.JWT_REFRESH_EXPIRES_IN_DAYS, 7, 1, 90);
  const jwtAccessExpiresIn = parseJwtDuration(raw.JWT_ACCESS_EXPIRES_IN, '15m');
  const cloudinarySignedUrlTtlSeconds = parseEnvInt(
    raw.CLOUDINARY_SIGNED_URL_TTL_SECONDS,
    300,
    60,
    3600
  );
  const maxImageBytes = parseEnvInt(raw.MAX_IMAGE_UPLOAD_BYTES, 10 * 1024 * 1024, 1024);
  const maxVideoBytes = parseEnvInt(raw.MAX_VIDEO_UPLOAD_BYTES, 50 * 1024 * 1024, 1024);
  const maxAudioBytes = parseEnvInt(raw.MAX_AUDIO_UPLOAD_BYTES, 20 * 1024 * 1024, 1024);
  const maxDocumentBytes = parseEnvInt(raw.MAX_DOCUMENT_UPLOAD_BYTES, 25 * 1024 * 1024, 1024);
  const smtpPort = parseEnvInt(raw.SMTP_PORT, 587, 1, 65535);

  const fallbackKeys = getOrCreateLocalKeyFile();
  const jwtAccessSecret =
    isRealValue(raw.JWT_ACCESS_SECRET) && raw.JWT_ACCESS_SECRET.trim().length >= 32
      ? raw.JWT_ACCESS_SECRET.trim()
      : fallbackKeys.access;
  const jwtRefreshSecret =
    isRealValue(raw.JWT_REFRESH_SECRET) && raw.JWT_REFRESH_SECRET.trim().length >= 32
      ? raw.JWT_REFRESH_SECRET.trim()
      : fallbackKeys.refresh;
  const csrfSecret =
    isRealValue(raw.CSRF_SECRET) && raw.CSRF_SECRET.trim().length >= 32
      ? raw.CSRF_SECRET.trim()
      : fallbackKeys.csrf;

  const configuredFrontendUrl = [
    raw.FRONTEND_PUBLIC_URL,
    raw.CLIENT_URL,
    raw.FRONTEND_URL,
    raw.APP_URL,
  ].find(isRealValue);
  const appUrl = configuredFrontendUrl
    ? configuredFrontendUrl.trim().replace(/\/+$/, '')
    : 'http://localhost:3000';

  const isTestMode = nodeEnv === 'test' || Boolean(process.env.VITEST);
  const isHttpsRuntime =
    !isTestMode &&
    (appUrl.startsWith('https://') ||
      nodeEnv === 'production' ||
      Boolean(process.env.K_SERVICE));

  const cookieSecure = isRealValue(raw.COOKIE_SECURE)
    ? raw.COOKIE_SECURE.trim().toLowerCase() === 'true'
    : isHttpsRuntime;

  const defaultSameSite: 'lax' | 'strict' | 'none' = cookieSecure ? 'none' : 'lax';
  const parsedSameSite = parseEnvEnum(
    raw.COOKIE_SAME_SITE,
    ['lax', 'strict', 'none'] as const,
    defaultSameSite
  );
  // Browsers reject SameSite=None unless Secure=true
  const cookieSameSite: 'lax' | 'strict' | 'none' =
    parsedSameSite === 'none' && !cookieSecure ? 'lax' : parsedSameSite;

  const explicitOrigins = new Set<string>([
    appUrl,
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4000',
  ]);
  for (const frontendUrl of [raw.FRONTEND_PUBLIC_URL, raw.CLIENT_URL, raw.FRONTEND_URL]) {
    if (isRealValue(frontendUrl)) {
      explicitOrigins.add(frontendUrl.trim().replace(/\/+$/, ''));
    }
  }
  if (isRealValue(raw.CORS_ALLOWED_ORIGINS)) {
    for (const item of raw.CORS_ALLOWED_ORIGINS.split(',')) {
      const trimmed = item.trim().replace(/\/+$/, '');
      if (trimmed) explicitOrigins.add(trimmed);
    }
  }
  for (const deploymentUrl of [raw.VERCEL_URL, raw.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (!isRealValue(deploymentUrl)) continue;
    const url = deploymentUrl.trim().startsWith('http')
      ? deploymentUrl.trim()
      : `https://${deploymentUrl.trim()}`;
    try {
      explicitOrigins.add(new URL(url).origin);
    } catch {
      // Ignore malformed platform-provided URLs.
    }
  }

  const hasExternalDatabaseUrl =
    isRealValue(raw.DATABASE_URL) &&
    (raw.DATABASE_URL.trim().startsWith('postgres://') ||
      raw.DATABASE_URL.trim().startsWith('postgresql://'));

  const hasCloudinaryConfig =
    isRealValue(raw.CLOUDINARY_CLOUD_NAME) &&
    isRealValue(raw.CLOUDINARY_API_KEY) &&
    isRealValue(raw.CLOUDINARY_API_SECRET);

  const hasGoogleOAuthConfig =
    isRealValue(raw.GOOGLE_CLIENT_ID) && isRealValue(raw.GOOGLE_CLIENT_SECRET);
  const hasPusherConfig =
    isRealValue(raw.PUSHER_APP_ID) &&
    isRealValue(raw.PUSHER_KEY) &&
    isRealValue(raw.PUSHER_SECRET) &&
    isRealValue(raw.PUSHER_CLUSTER);
  const webPushSubject = isRealValue(raw.VAPID_SUBJECT) ? raw.VAPID_SUBJECT.trim() : '';
  const webPushPublicKey = isRealValue(raw.VAPID_PUBLIC_KEY) ? raw.VAPID_PUBLIC_KEY.trim() : '';
  const webPushPrivateKey = isRealValue(raw.VAPID_PRIVATE_KEY) ? raw.VAPID_PRIVATE_KEY.trim() : '';
  const hasWebPushConfig =
    webPushSubject.length > 0 &&
    webPushPublicKey.length > 0 &&
    webPushPrivateKey.length > 0 &&
    /^(mailto:\S+|https:\/\/\S+)$/i.test(webPushSubject);

  const smtpPassword = isRealValue(raw.SMTP_PASS)
    ? raw.SMTP_PASS
    : isRealValue(raw.SMTP_PASSWORD)
      ? raw.SMTP_PASSWORD
      : undefined;
  const hasSmtpConfig =
    isRealValue(raw.SMTP_HOST) && isRealValue(raw.SMTP_USER) && isRealValue(smtpPassword);

  return {
    nodeEnv,
    port,
    appUrl,
    corsAllowedOrigins: Array.from(explicitOrigins),
    databaseUrl: hasExternalDatabaseUrl ? raw.DATABASE_URL!.trim() : undefined,
    directUrl:
      isRealValue(raw.DIRECT_URL) &&
      (raw.DIRECT_URL.trim().startsWith('postgres://') ||
        raw.DIRECT_URL.trim().startsWith('postgresql://'))
        ? raw.DIRECT_URL.trim()
        : undefined,
    hasExternalDatabaseUrl,
    jwtAccessSecret,
    jwtRefreshSecret,
    csrfSecret,
    jwtAccessExpiresIn,
    jwtRefreshExpiresInDays,
    cookie: {
      secure: cookieSecure,
      sameSite: cookieSameSite,
      domain: isRealValue(raw.COOKIE_DOMAIN) ? raw.COOKIE_DOMAIN.trim() : undefined,
    },
    google: {
      enabled: hasGoogleOAuthConfig,
      clientId: hasGoogleOAuthConfig ? raw.GOOGLE_CLIENT_ID!.trim() : '',
      clientSecret: hasGoogleOAuthConfig ? raw.GOOGLE_CLIENT_SECRET!.trim() : '',
      callbackUrl:
        isRealValue(raw.GOOGLE_CALLBACK_URL) && raw.GOOGLE_CALLBACK_URL.trim().startsWith('http')
          ? raw.GOOGLE_CALLBACK_URL.trim()
          : `${appUrl}/api/auth/google/callback`,
    },
    pusher: {
      enabled: hasPusherConfig,
      appId: hasPusherConfig ? raw.PUSHER_APP_ID!.trim() : '',
      key: hasPusherConfig ? raw.PUSHER_KEY!.trim() : '',
      secret: hasPusherConfig ? raw.PUSHER_SECRET!.trim() : '',
      cluster: hasPusherConfig ? raw.PUSHER_CLUSTER!.trim() : '',
    },
    webPush: {
      enabled: hasWebPushConfig,
      publicKey: hasWebPushConfig ? webPushPublicKey : '',
      privateKey: hasWebPushConfig ? webPushPrivateKey : '',
      subject: hasWebPushConfig ? webPushSubject : '',
    },
    cloudinary: {
      enabled: hasCloudinaryConfig,
      cloudName: hasCloudinaryConfig ? raw.CLOUDINARY_CLOUD_NAME!.trim() : '',
      apiKey: hasCloudinaryConfig ? raw.CLOUDINARY_API_KEY!.trim() : '',
      apiSecret: hasCloudinaryConfig ? raw.CLOUDINARY_API_SECRET!.trim() : '',
      signedUrlTtlSeconds: cloudinarySignedUrlTtlSeconds,
    },
    uploads: {
      maxImageBytes,
      maxVideoBytes,
      maxAudioBytes,
      maxDocumentBytes,
    },
    smtp: {
      enabled: hasSmtpConfig,
      host: hasSmtpConfig ? raw.SMTP_HOST!.trim() : '',
      port: smtpPort,
      secure:
        (isRealValue(raw.SMTP_SECURE) && raw.SMTP_SECURE.trim().toLowerCase() === 'true') ||
        smtpPort === 465,
      user: hasSmtpConfig ? raw.SMTP_USER!.trim() : '',
      pass: hasSmtpConfig ? smtpPassword!.trim() : '',
      from: isRealValue(raw.SMTP_FROM)
        ? raw.SMTP_FROM.trim()
        : 'ChatSphere Security <no-reply@chatsphere.app>',
    },
    adminBootstrapToken: isRealValue(raw.ADMIN_BOOTSTRAP_TOKEN)
      ? raw.ADMIN_BOOTSTRAP_TOKEN.trim()
      : undefined,
  };
}

export const env = loadAndValidateEnv();
export type AppConfig = ReturnType<typeof loadAndValidateEnv>;
