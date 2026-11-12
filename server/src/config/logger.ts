const SENSITIVE_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'otp',
  'otpHash',
  'token',
  'tokenHash',
  'refreshToken',
  'accessToken',
  'secret',
  'apiSecret',
  'authorization',
  'cookie',
]);

function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k) || /secret|password|token|otp/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactObject(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function writeLog(level: LogLevel, message: string, context?: Record<string, unknown>) {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return;
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: 'chatsphere-api',
    message,
    ...(context ? { context: redactObject(context) } : {}),
  };

  const serialized = JSON.stringify(payload);
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => writeLog('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => writeLog('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => writeLog('error', message, context),
  debug: (message: string, context?: Record<string, unknown>) => writeLog('debug', message, context),
};
