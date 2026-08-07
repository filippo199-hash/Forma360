/**
 * Server-side session minting for the try-it-now sandbox.
 *
 * The sandbox (ADR 0017) hands a visitor a real, signed-in workspace
 * before they have given us an email address, so there is no OTP round
 * trip to exchange for a session. Everything downstream — the tRPC
 * context, `tenantProcedure`, `requirePermission` — resolves the caller
 * from `auth.api.getSession()`, so the sandbox must produce a session
 * better-auth itself recognises rather than inventing a second kind of
 * principal. That keeps the security surface exactly as it was: one
 * session type, one resolution path, no bypass in the context factory.
 *
 * Two steps:
 *   1. `internalAdapter.createSession(userId)` — better-auth's own
 *      session writer (row + Redis secondary storage + expiry policy).
 *   2. Serialise the session token into the cookie better-auth reads
 *      back. That cookie is *signed*, and better-auth's signer lives
 *      behind `setSessionCookie`, which needs an endpoint context we do
 *      not have out here. So the signing is reproduced below — it is a
 *      proven boundary, pinned by `sandbox-session.test.ts`, which
 *      round-trips a minted cookie through `auth.api.getSession()`. If
 *      better-auth ever changes the scheme, that test fails loudly
 *      instead of the sandbox silently handing out dead sessions.
 *
 * Signing scheme (better-call `signCookieValue`): the cookie value is
 * `encodeURIComponent(`${token}.${base64(HMAC-SHA256(secret, token))}`)`.
 * Note base64, not base64url, and the HMAC covers the raw token only.
 */
import type { Auth } from './server';

/** A minted sandbox session and the `Set-Cookie` header that carries it. */
export interface SandboxSession {
  /** Opaque better-auth session token (also the DB primary lookup key). */
  token: string;
  /** Fully serialised `Set-Cookie` header value. */
  setCookie: string;
  /** Absolute expiry, straight from better-auth's session policy. */
  expiresAt: Date;
}

/**
 * Base64 (standard alphabet, padded) of an HMAC-SHA256 over `value`.
 * Mirrors better-call's `makeSignature`.
 */
async function makeSignature(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/** Mirrors better-call's `signCookieValue`. */
export async function signCookieValue(value: string, secret: string): Promise<string> {
  return encodeURIComponent(`${value}.${await makeSignature(value, secret)}`);
}

/**
 * Serialise one cookie. Deliberately minimal — the attribute set is
 * whatever better-auth configured for its own session cookie, so the
 * sandbox cookie and a post-OTP cookie are indistinguishable to the
 * browser.
 */
function serializeCookie(
  name: string,
  value: string,
  attrs: {
    maxAge: number;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: string;
    domain?: string | undefined;
  },
): string {
  const parts = [`${name}=${value}`, `Max-Age=${attrs.maxAge}`, `Path=${attrs.path}`];
  if (attrs.domain !== undefined) parts.push(`Domain=${attrs.domain}`);
  parts.push(`SameSite=${attrs.sameSite}`);
  if (attrs.secure) parts.push('Secure');
  if (attrs.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

/**
 * Mint a session for `userId` and return the `Set-Cookie` header that
 * signs the caller in. The caller is responsible for appending it to
 * the outgoing response.
 *
 * `secret` must be the same `BETTER_AUTH_SECRET` the auth instance was
 * built with — a mismatch produces a cookie better-auth rejects, which
 * the round-trip test exists to catch.
 */
export async function createSandboxSession(
  auth: Auth,
  userId: string,
  secret: string,
): Promise<SandboxSession> {
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);

  const cookie = ctx.authCookies.sessionToken;
  const signed = await signCookieValue(session.token, secret);
  const attributes = cookie.attributes;

  return {
    token: session.token,
    expiresAt: session.expiresAt,
    setCookie: serializeCookie(cookie.name, signed, {
      maxAge: ctx.sessionConfig.expiresIn,
      path: attributes.path ?? '/',
      secure: attributes.secure === true,
      httpOnly: attributes.httpOnly !== false,
      sameSite: typeof attributes.sameSite === 'string' ? attributes.sameSite : 'lax',
      domain: attributes.domain,
    }),
  };
}
