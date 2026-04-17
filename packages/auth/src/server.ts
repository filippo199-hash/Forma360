/**
 * better-auth server factory.
 *
 * Exports `createAuth(deps)` which returns a configured better-auth instance.
 * Dependencies (db, redis, sendEmail) are injected so this package does not
 * reach out to env itself — the consumer (apps/web in PR 7) wires everything
 * together from its own boot module.
 *
 * Features enabled:
 *   - email + password (core, not a plugin)
 *   - email verification (requires sendEmail)
 *   - password reset (requires sendEmail)
 *   - two-factor authentication via TOTP (twoFactor plugin)
 *   - Redis secondary session storage via @better-auth/redis-storage
 *
 * See ADR 0004 for the user-table tenant extension rules.
 */
import { redisStorage } from '@better-auth/redis-storage';
import * as schema from '@forma360/db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';

/**
 * Payload passed to `sendEmail` callbacks. Concrete delivery
 * (Resend vs. pino-console) is decided by the consumer; see
 * packages/shared/src/email.ts (wired in PR 6).
 */
export interface AuthEmail {
  /** Recipient address. */
  to: string;
  /** Message kind — used to pick an i18n template. */
  kind: 'verification' | 'password-reset';
  /** Action URL the recipient clicks. Already signed / expiring. */
  url: string;
  /** The user id this email concerns, for logging. */
  userId: string;
}

export interface AuthDeps {
  /** Drizzle client from @forma360/db. */
  db: NodePgDatabase<typeof schema>;
  /** ioredis client reused from the BullMQ connection pool. */
  redis: Redis;
  /** Dispatches transactional email. Resend in prod; pino-console in dev. */
  sendEmail: (email: AuthEmail) => Promise<void>;
  /** Shared 32+ byte secret for signing sessions / verification URLs. */
  secret: string;
  /** Canonical base URL (e.g. https://app.forma360.com). */
  baseUrl: string;
  /** "production" | "development" | "test" — controls cookie `secure`. */
  nodeEnv: 'production' | 'development' | 'test';
}

export function createAuth(deps: AuthDeps) {
  const { db, redis, sendEmail, secret, baseUrl, nodeEnv } = deps;
  const isProduction = nodeEnv === 'production';

  return betterAuth({
    secret,
    baseURL: baseUrl,

    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
      },
    }),

    secondaryStorage: redisStorage({
      client: redis,
      keyPrefix: 'forma360:auth:',
    }),

    // Email + password is a core config option, not a plugin.
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({ to: user.email, kind: 'password-reset', url, userId: user.id });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({ to: user.email, kind: 'verification', url, userId: user.id });
      },
    },

    session: {
      // 7 days, refreshed on activity.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },

    advanced: {
      // Cookies are hardened in production and relaxed in dev so localhost
      // (http://) still works without TLS. The httpOnly + sameSite=lax
      // defaults stay on in every environment.
      defaultCookieAttributes: {
        secure: isProduction,
        httpOnly: true,
        sameSite: 'lax',
      },
    },

    plugins: [twoFactor()],
  });
}

/** Inferred type of a constructed auth server. Useful for route-handler typing. */
export type Auth = ReturnType<typeof createAuth>;
