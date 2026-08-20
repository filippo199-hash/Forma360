/**
 * better-auth server factory.
 *
 * Exports `createAuth(deps)` which returns a configured better-auth instance.
 * Dependencies (db, redis, sendEmail, sendTemplatedEmail) are injected so
 * this package does not reach out to env itself — the consumer (apps/web)
 * wires everything together from its own boot module.
 *
 * Features enabled:
 *   - **email + password sign-in** (`/sign-in/email`) against `credential`
 *     account rows. Sign-UP through better-auth stays disabled — a tenant
 *     row must exist first, which only the tRPC `signUpWithTenant` /
 *     `acceptInvite` mutations know how to create; they hash via
 *     `@forma360/auth/crypto` (the exact scrypt this instance verifies)
 *     and insert the credential row themselves.
 *   - **email sign-in via OTP** (passwordless). The `emailOTP` plugin
 *     POSTs a 6-digit code to `/email-otp/send-verification-otp`, then
 *     `/sign-in/email-otp` exchanges the code for a session. Both methods
 *     coexist; OTP remains available to every user.
 *   - email verification — folded into the OTP flow via
 *     `overrideDefaultEmailVerification: true`. Password sign-in refuses
 *     unverified accounts (`requireEmailVerification`), and the UI routes
 *     that refusal into the OTP flow, whose exchange verifies the inbox.
 *   - password reset over the templated `password-reset` email; a
 *     `password-changed` notification goes out on every reset so a
 *     hijacked reset cannot happen silently.
 *   - two-factor authentication via TOTP (`twoFactor` plugin, kept for
 *     opt-in 2FA).
 *   - Redis secondary session storage via `@better-auth/redis-storage`.
 *
 * Deactivated users: a password sign-in will mint a session for a
 * deactivated user, exactly as the OTP exchange always has — the control
 * is the live `isUserActive` check every request runs (SEC-D01), not the
 * sign-in gate.
 *
 * See ADR 0004 for the user-table tenant extension rules.
 */
import { redisStorage } from '@better-auth/redis-storage';
import * as schema from '@forma360/db/schema';
import { appLink } from '@forma360/shared/app-link';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import {
  isPasswordBreached,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordBreachCheck,
} from '@forma360/shared/password';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP, twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import { z } from 'zod';

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
  /**
   * Leaked-password check applied to `/reset-password` and
   * `/change-password` (the tRPC sign-up paths run their own via router
   * deps). Defaults to the shared fail-open HIBP helper; injectable so
   * tests never touch the network.
   */
  checkPasswordBreached?: PasswordBreachCheck;
}

export function createAuth(deps: AuthDeps) {
  const { db, redis, sendTemplatedEmail, secret, baseUrl, nodeEnv } = deps;
  const isProduction = nodeEnv === 'production';
  const checkPasswordBreached =
    deps.checkPasswordBreached ?? ((password: string) => isPasswordBreached(password));

  /**
   * Per-user email locale (PF-20). better-auth's `user` object only carries
   * declared additionalFields (`tenantId`), so the locale is a one-row read.
   * Null/unset falls back to English inside the dispatcher.
   */
  async function lookupUserLocale(userId: string): Promise<string | undefined> {
    const rows = await db
      .select({ locale: schema.user.locale })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    return rows[0]?.locale ?? undefined;
  }

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

    // Email + password sign-in, alongside the OTP plugin below. Sign-UP
    // through better-auth stays off: `/sign-up/email` cannot create the
    // tenant row Forma360 requires first, so the tRPC mutations own user
    // creation and write the credential `account` row themselves (hashed
    // via `@forma360/auth/crypto`, the exact scrypt verified here).
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      // One policy, one module: the same constants back the Zod schema on
      // the tRPC sign-up paths and the bootstrap script's validation.
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Password sign-in refuses accounts that never completed the OTP
      // exchange (`emailVerified=false`). better-auth verifies the
      // password BEFORE this check, so the FORBIDDEN response leaks
      // nothing to a guesser; the UI answers it by sending an OTP, whose
      // exchange verifies the inbox and signs in.
      requireEmailVerification: true,
      // 30 minutes — the `password-reset` email copy in every locale
      // promises exactly this window. Change both together or neither.
      resetPasswordTokenExpiresIn: 60 * 30,
      // A reset proves control of the inbox, not of every device holding
      // a session cookie. Drop them all; the resetter signs back in.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendTemplatedEmail({
          to: user.email,
          templateKey: 'password-reset',
          variables: { url },
          locale: await lookupUserLocale(user.id),
        });
      },
      // Every completed reset is announced to the account inbox so a
      // hijacked reset cannot happen silently. The link goes to sign-in:
      // "wasn't you" recovery is Forgot password, which the page carries.
      onPasswordReset: async ({ user }) => {
        const locale = await lookupUserLocale(user.id);
        await sendTemplatedEmail({
          to: user.email,
          templateKey: 'password-changed',
          variables: { url: appLink(baseUrl, locale ?? null, '/sign-in') },
          locale,
        });
      },
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

      // RL-K01, for better-auth's limiter. Stated explicitly because the
      // default is the same value and the reason it is safe lives elsewhere:
      //
      // better-auth's `getIp` takes `value.split(',')[0]` — the LEFTMOST hop,
      // i.e. whatever the caller sent — from whichever header is named here.
      // Listing a different header would not change that, and naming a
      // single-valued one the platform might not set would make `getIp`
      // return null, which makes better-auth SKIP rate limiting entirely.
      //
      // The trust boundary is therefore enforced upstream, in
      // `apps/web/app/api/auth/[...all]/route.ts`, which collapses
      // `x-forwarded-for` to the single hop our own edge wrote before this
      // handler ever sees it. Keep that wrapper: without it the two limits
      // below are keyed on a value the attacker chooses.
      ipAddress: {
        ipAddressHeaders: ['x-forwarded-for'],
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
        // Password brute force: tighter than the global 30/60s so a
        // credential-stuffing run burns out an order of magnitude sooner.
        '/sign-in/email': { window: 60, max: 10 },
        // Reset-mail bombing, mirroring the OTP-send rule above.
        '/request-password-reset': { window: 300, max: 5 },
        // Token guessing on the reset exchange + current-password
        // guessing from a stolen session.
        '/reset-password': { window: 300, max: 10 },
        '/change-password': { window: 300, max: 10 },
      },
    },

    hooks: {
      // Leaked-password gate for the two better-auth-owned endpoints that
      // accept a new password over HTTP. The tRPC sign-up paths run the
      // same check through their router deps; the settings route runs it
      // itself before calling `auth.api`. Fail-open by construction — see
      // `@forma360/shared/password`.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/reset-password' && ctx.path !== '/change-password') return;
        const parsed = z.object({ newPassword: z.string() }).safeParse(ctx.body);
        if (!parsed.success) return; // endpoint's own validation answers this
        if (await checkPasswordBreached(parsed.data.newPassword)) {
          throw new APIError('BAD_REQUEST', {
            message:
              'This password has appeared in a known data breach. Please choose a different one.',
            code: 'PASSWORD_COMPROMISED',
          });
        }
      }),
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
