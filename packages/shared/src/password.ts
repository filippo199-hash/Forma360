/**
 * Password policy + breached-password check.
 *
 * One module owns the numbers so the tRPC sign-up path, the better-auth
 * `emailAndPassword` config, the set/change route and the bootstrap
 * script can never disagree about what a valid password is.
 *
 * Policy (NIST 800-63B posture): length is the only composition rule —
 * no mandatory digits/symbols, which push people toward `Password1!` —
 * combined with a leaked-password check against the Have I Been Pwned
 * range API. The check is k-anonymous (only the first 5 hex chars of the
 * SHA-1 leave the server) and **fails open**: an HIBP outage must never
 * block a sign-up or a password reset. better-auth's own `haveIBeenPwned`
 * plugin fails closed on API errors and cannot see our tRPC sign-up path,
 * which is why this helper exists instead.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Logger } from './logger';

/**
 * Minimum password length. The bootstrap script
 * (`packages/permissions/src/scripts/bootstrap-tenant.ts`) and the
 * better-auth `minPasswordLength` option both align with this.
 */
export const PASSWORD_MIN_LENGTH = 12;

/** Ceiling well above any real passphrase; caps hashing cost. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * The one Zod schema every password-accepting boundary uses
 * (`auth.signUpWithTenant`, `auth.acceptInvite`, the account
 * set/change-password route).
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH);

/** One `SUFFIX:COUNT` line of the HIBP range response. */
const RANGE_LINE_RE = /^([0-9A-Fa-f]{35}):(\d+)$/;

/** The range endpoint returns plain text; anything else is treated as an outage. */
const rangeBodySchema = z.string();

export interface PasswordBreachCheckOptions {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Abort the lookup after this long and fail open. */
  timeoutMs?: number;
  /** Warn-level channel for outages; silent when omitted. */
  logger?: Logger;
}

export type PasswordBreachCheck = (password: string) => Promise<boolean>;

/**
 * True when `password` appears in the HIBP corpus with a positive count.
 *
 * Sends only the first 5 chars of the uppercase SHA-1 (`/range/<prefix>`,
 * with `Add-Padding` so the response length leaks nothing either).
 * Padding entries come back with count 0 and must NOT count as breached.
 *
 * Every failure mode — network error, non-200, malformed body, timeout —
 * returns `false`. Refusing passwords because a third-party API is down
 * would turn an HIBP outage into a sign-up and password-reset outage.
 */
export async function isPasswordBreached(
  password: string,
  options: PasswordBreachCheckOptions = {},
): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2500;

  const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    });
    if (!response.ok) {
      options.logger?.warn(
        { status: response.status },
        '[password] breach check got a non-200 — failing open',
      );
      return false;
    }
    const body = rangeBodySchema.parse(await response.text());
    for (const rawLine of body.split('\n')) {
      const match = RANGE_LINE_RE.exec(rawLine.trim());
      if (match === null) continue;
      const [, lineSuffix, count] = match;
      if (lineSuffix !== undefined && lineSuffix.toUpperCase() === suffix && Number(count) > 0) {
        return true;
      }
    }
    return false;
  } catch (error) {
    options.logger?.warn(
      { err: error instanceof Error ? error.message : String(error) },
      '[password] breach check unavailable — failing open',
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
