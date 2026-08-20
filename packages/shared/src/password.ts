/**
 * Password policy — the isomorphic half.
 *
 * One module owns the numbers so the tRPC sign-up path, the better-auth
 * `emailAndPassword` config, the set/change route, the bootstrap script
 * and the client-side hints can never disagree about what a valid
 * password is. Safe to import from client components (no node builtins);
 * the HIBP lookup lives in `./password-breach`, which is node-only.
 *
 * Policy (NIST 800-63B posture): length is the only composition rule —
 * no mandatory digits/symbols, which push people toward `Password1!` —
 * combined with the leaked-password check in `./password-breach`.
 */
import { z } from 'zod';

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
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Shape of the injectable breach check (implemented in ./password-breach). */
export type PasswordBreachCheck = (password: string) => Promise<boolean>;
