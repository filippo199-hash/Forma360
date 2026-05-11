/**
 * Re-export of better-auth's password hashing primitive.
 *
 * Routed through `@forma360/auth/crypto` so downstream packages (api,
 * permissions/scripts) hash passwords using the exact algorithm + cost
 * parameters that the live auth runtime uses to verify them — without
 * each consumer needing to add `better-auth` as a direct dependency.
 */
export { hashPassword, verifyPassword } from 'better-auth/crypto';
