import { describe, expect, it } from 'vitest';
import { loadAndValidateEnv } from '../src/config/env.ts';

const requiredProductionKeys = [
  'NODE_ENV',
  'DATABASE_URL',
  'DIRECT_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'CSRF_SECRET',
] as const;

function withProductionEnvironment(values: Record<string, string>, run: () => void) {
  const previous = new Map<string, string | undefined>(
    requiredProductionKeys.map((key) => [key, process.env[key]])
  );
  const providerKeys = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_PASSWORD',
  ];
  for (const key of providerKeys) {
    previous.set(key, process.env[key]);
  }

  try {
    for (const key of requiredProductionKeys) {
      delete process.env[key];
    }
    for (const key of providerKeys) {
      delete process.env[key];
    }
    Object.assign(process.env, values);
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('production deployment configuration', () => {
  it('rejects missing PostgreSQL URLs and signing secrets in production', () => {
    withProductionEnvironment({ NODE_ENV: 'production' }, () => {
      expect(() => loadAndValidateEnv()).toThrow(
        /DATABASE_URL, DIRECT_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, CSRF_SECRET/
      );
    });
  });

  it('requires email and media providers for a feature-complete production configuration', () => {
    withProductionEnvironment(
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:password@db.example/chatsphere',
        DIRECT_URL: 'postgresql://user:password@db.example/chatsphere',
        JWT_ACCESS_SECRET: 'a'.repeat(48),
        JWT_REFRESH_SECRET: 'b'.repeat(48),
        CSRF_SECRET: 'c'.repeat(48),
      },
      () => {
        expect(() => loadAndValidateEnv()).toThrow(
          /CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, SMTP_HOST, SMTP_USER, SMTP_PASS/
        );
      }
    );
  });

  it('accepts complete production settings for the required database, email, and media services', () => {
    withProductionEnvironment(
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:password@db.example/chatsphere',
        DIRECT_URL: 'postgresql://user:password@db.example/chatsphere',
        JWT_ACCESS_SECRET: 'a'.repeat(48),
        JWT_REFRESH_SECRET: 'b'.repeat(48),
        CSRF_SECRET: 'c'.repeat(48),
        CLOUDINARY_CLOUD_NAME: 'chatsphere-test',
        CLOUDINARY_API_KEY: '123456789012345',
        CLOUDINARY_API_SECRET: 'test-cloudinary-secret',
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'mail@chatsphere.test',
        SMTP_PASS: 'test-smtp-password',
      },
      () => {
        const config = loadAndValidateEnv();
        expect(config.hasExternalDatabaseUrl).toBe(true);
        expect(config.cloudinary.enabled).toBe(true);
        expect(config.smtp.enabled).toBe(true);
      }
    );
  });
});
