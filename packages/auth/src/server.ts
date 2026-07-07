/**
 * better-auth server factory.
 *
 * Exports `createAuth(deps)` which returns a configured better-auth instance.
 * Dependencies (db, redis, sendEmail, sendTemplatedEmail) are injected so
 * this package does not reach out to env itself — the consumer (apps/web)
 * wires everything together from its own boot module.
 *
 * Features enabled:
 *   - **email-only sign-in via OTP** (passwordless). The `emailOTP`
 *     plugin POSTs a 6-digit code to `/email-otp/send-verification-otp`,
 *     then `/sign-in/email-otp` exchanges the code for a session.
 *   - email verification — folded into the OTP flow via
 *     `overrideDefaultEmailVerification: true`.
 *   - two-factor authentication via TOTP (`twoFactor` plugin, kept for
 *     opt-in 2FA on top of OTP).
 *   - Redis secondary session storage via `@better-auth/redis-storage`.
 *
 * Passwords are intentionally NOT enabled — `emailAndPassword.enabled`
 * is false. Existing credential `account` rows are ignored at sign-in
 * time. Users prove ownership of their inbox each session start
 * (mitigated by the 90-day session window with sliding renewal so the
 * UX feels like a stay-logged-in experience).
 *
 * See ADR 0004 for the user-table tenant extension rules.
 */
import { redisStorage } from '@better-auth/redis-storage';
import * as schema from '@forma360/db/schema';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, twoFactor } from 'better-auth/plugins';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';

/**
 * Payload passed to the legacy `sendEmail` callback. Kept for backwards
 * compatibility with any non-OTP delivery path that still uses
 * better-auth's url-style helpers. The OTP plugin uses
 * `sendTemplatedEmail` directly instead.
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
  /** Legacy URL-style email dispatcher. Only invoked if better-auth
   *  reaches for a non-OTP flow (currently none — kept for safety). */
  sendEmail: (email: AuthEmail) => Promise<void>;
  /** Templated-email dispatcher. The OTP plugin uses this with the
   *  `otp` template key; {@link AuthEmail.kind} keeps the legacy path
   *  separate so the two surfaces don't collide. */
  sendTemplatedEmail: SendTemplatedEmail;
  /** Shared 32+ byte secret for signing sessions / verification URLs. */
  secret: string;
  /** Canonical base URL (e.g. https://app.forma360.com). */
  baseUrl: string;
  /** "production" | "development" | "test" — controls cookie `secure`. */
  nodeEnv: 'production' | 'development' | 'test';
}

export function createAuth(deps: AuthDeps) {
  const { db, redis, sendTemplatedEmail, secret, baseUrl, nodeEnv } = deps;
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

    // Passwords are off. Every sign-in goes through the email OTP flow
    // below. We keep `account` rows around so we don't have to migrate
    // historical data, but better-auth never consults them.
    emailAndPassword: {
      enabled: false,
    },

    session: {
      // 90-day window. Sliding refresh: every time the session is
      // touched after `updateAge`, better-auth bumps the expiry forward.
      // With a 7-day updateAge a returning user effectively stays
      // signed-in indefinitely as long as they open the app at least
      // once every 90 days.
      expiresIn: 60 * 60 * 24 * 90,
      updateAge: 60 * 60 * 24 * 7,
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

    // Rate limiting for the auth endpoints, backed by the Redis secondary
    // storage so it holds across instances. The global default caps brute
    // force / enumeration; the custom rule throttles OTP *sending* so an
    // attacker can't mail-bomb an address or churn sign-ups.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      storage: 'secondary-storage',
      customRules: {
        '/email-otp/send-verification-otp': { window: 300, max: 5 },
        '/sign-up/email': { window: 3600, max: 10 },
      },
    },

    // Declare the Forma360 extension to the user table so the inferred
    // session type exposes `session.user.tenantId` without a manual cast.
    // Matches the column added in packages/db/src/schema/auth.ts.
    user: {
      additionalFields: {
        tenantId: {
          type: 'string',
          required: true,
          input: false, // never writable from the client via auth endpoints
        },
      },
    },

    plugins: [
      twoFactor(),
      emailOTP({
        // The plugin calls this to deliver a 6-digit code. Wired to the
        // templated-email dispatcher with the `otp` template key (see
        // packages/i18n/emails/en/otp.json).
        sendVerificationOTP: async ({ email, otp, type }) => {
          await sendTemplatedEmail({
            to: email,
            templateKey: 'otp',
            variables: { otp, type },
          });
        },
        otpLength: 6,
        // 10-minute window. Generous enough for a slow inbox; short
        // enough that a leaked code expires before anyone can mail-replay it.
        expiresIn: 600,
        allowedAttempts: 5,
        // The default /verify-email + /sign-in/email-otp routes both
        // share this same plugin — flipping this makes sign-up auto-mark
        // the user as verified once they enter their first OTP.
        overrideDefaultEmailVerification: true,
        // Block the plugin's auto-signup path. Forma360 needs a tenant
        // row first, which only `signUpWithTenant` knows how to make. If
        // a stranger types an unknown email into the OTP form they'll
        // get a generic "invalid code" instead of silently bootstrapping
        // a half-formed tenant.
        disableSignUp: true,
      }),
    ],
  });
}

/** Inferred type of a constructed auth server. Useful for route-handler typing. */
export type Auth = ReturnType<typeof createAuth>;
