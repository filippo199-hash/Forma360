import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseClientEnv, parseServerEnv } from './env';

const validServerEnv = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/forma360',
  REDIS_URL: 'redis://localhost:6379',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  R2_ACCOUNT_ID: 'acct-123',
  R2_ACCESS_KEY_ID: 'key-123',
  R2_SECRET_ACCESS_KEY: 'secret-123',
  R2_BUCKET: 'forma360-dev',
  R2_PUBLIC_URL: 'https://cdn.forma360.dev',
  RESEND_API_KEY: 're_123',
  RESEND_FROM: 'Forma360 <noreply@forma360.dev>',
  EMAIL_DELIVERY: 'console',
  RENDER_SHARED_SECRET: 'r'.repeat(32),
  LOG_LEVEL: 'info',
} as const;

describe('parseServerEnv', () => {
  it('parses a fully valid env', () => {
    const env = parseServerEnv(validServerEnv);
    expect(env.DATABASE_URL).toBe(validServerEnv.DATABASE_URL);
    expect(env.NODE_ENV).toBe('development');
    expect(env.EMAIL_DELIVERY).toBe('console');
  });

  it('applies defaults for optional variables', () => {
    const { NODE_ENV: _n, LOG_LEVEL: _l, EMAIL_DELIVERY: _e, ...rest } = validServerEnv;
    const env = parseServerEnv(rest);
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.EMAIL_DELIVERY).toBe('resend');
  });

  it('rejects a missing required variable with a descriptive error', () => {
    const { DATABASE_URL: _omit, ...rest } = validServerEnv;
    expect(() => parseServerEnv(rest)).toThrow(EnvValidationError);
    try {
      parseServerEnv(rest);
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as EnvValidationError).message).toContain('DATABASE_URL');
    }
  });

  it('rejects an invalid URL', () => {
    expect(() => parseServerEnv({ ...validServerEnv, APP_URL: 'not-a-url' })).toThrow(/APP_URL/);
  });

  it('rejects a BETTER_AUTH_SECRET shorter than 32 bytes', () => {
    expect(() => parseServerEnv({ ...validServerEnv, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('rejects a RENDER_SHARED_SECRET shorter than 32 bytes', () => {
    expect(() => parseServerEnv({ ...validServerEnv, RENDER_SHARED_SECRET: 'short' })).toThrow(
      /RENDER_SHARED_SECRET/,
    );
  });

  it('rejects an invalid NODE_ENV value', () => {
    expect(() => parseServerEnv({ ...validServerEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects an invalid LOG_LEVEL value', () => {
    expect(() => parseServerEnv({ ...validServerEnv, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('allows EMAIL_DELIVERY=console when NODE_ENV=development', () => {
    expect(() =>
      parseServerEnv({ ...validServerEnv, NODE_ENV: 'development', EMAIL_DELIVERY: 'console' }),
    ).not.toThrow();
  });

  it('allows EMAIL_DELIVERY=console when NODE_ENV=test', () => {
    expect(() =>
      parseServerEnv({ ...validServerEnv, NODE_ENV: 'test', EMAIL_DELIVERY: 'console' }),
    ).not.toThrow();
  });

  it('refuses EMAIL_DELIVERY=console when NODE_ENV=production', () => {
    expect(() =>
      parseServerEnv({ ...validServerEnv, NODE_ENV: 'production', EMAIL_DELIVERY: 'console' }),
    ).toThrow(/EMAIL_DELIVERY=console.*NODE_ENV=production/);
  });

  it('allows EMAIL_DELIVERY=resend when NODE_ENV=production', () => {
    expect(() =>
      parseServerEnv({ ...validServerEnv, NODE_ENV: 'production', EMAIL_DELIVERY: 'resend' }),
    ).not.toThrow();
  });

  it('treats SENTRY_DSN as optional', () => {
    const withDsn = parseServerEnv({
      ...validServerEnv,
      SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1',
    });
    expect(withDsn.SENTRY_DSN).toBe('https://key@o1.ingest.sentry.io/1');
    const withoutDsn = parseServerEnv(validServerEnv);
    expect(withoutDsn.SENTRY_DSN).toBeUndefined();
  });

  it('collects all failing variables in a single error', () => {
    try {
      parseServerEnv({ ...validServerEnv, APP_URL: 'bad', DATABASE_URL: 'also-bad' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const message = (err as EnvValidationError).message;
      expect(message).toContain('APP_URL');
      expect(message).toContain('DATABASE_URL');
    }
  });
});

describe('parseClientEnv', () => {
  it('parses when NEXT_PUBLIC_SENTRY_DSN is absent', () => {
    expect(() => parseClientEnv({})).not.toThrow();
  });

  it('parses when NEXT_PUBLIC_SENTRY_DSN is a valid URL', () => {
    const env = parseClientEnv({
      NEXT_PUBLIC_SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1',
    });
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBe('https://key@o1.ingest.sentry.io/1');
  });

  it('rejects a NEXT_PUBLIC_SENTRY_DSN that is not a URL', () => {
    expect(() => parseClientEnv({ NEXT_PUBLIC_SENTRY_DSN: 'not-a-url' })).toThrow(
      /NEXT_PUBLIC_SENTRY_DSN/,
    );
  });

  it('ignores server-only variables', () => {
    // A client env parse must not reject just because a server-only var is present
    // (process.env contains everything).
    expect(() =>
      parseClientEnv({
        NEXT_PUBLIC_SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1',
        DATABASE_URL: 'postgresql://whatever',
      }),
    ).not.toThrow();
  });
});
