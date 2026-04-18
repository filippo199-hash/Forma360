/**
 * HMAC-SHA256 render-token sign/verify for the internal Puppeteer path.
 *
 * The `/render/inspection/[inspectionId]` route is a server-side page
 * that renders the print layout. Puppeteer is the only legitimate
 * visitor — public share traffic hits `/s/[token]` instead. To keep the
 * print route crawler-invisible without a session cookie, every render
 * request carries a signed token:
 *
 *     token = base64url(expSeconds).base64url(hmacSha256(secret, payload))
 *
 * where `payload` is `${inspectionId}.${expSeconds}`. The route checks:
 *   - the HMAC matches (constant-time compare)
 *   - the expiry is in the future
 *   - the inspectionId in the URL matches the signed payload
 *
 * The shared secret is {@link process.env.RENDER_SHARED_SECRET} — 32+
 * random bytes, validated via the env schema.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Default render-token lifetime: 5 minutes. Puppeteer is fast. */
export const DEFAULT_RENDER_TOKEN_TTL_SECONDS = 60 * 5;

/**
 * Sign an inspection id for the render route.
 *
 * Returns `"<exp>.<sig>"` where both parts are base64url-encoded. The
 * exp is ASCII-decimal-seconds-since-epoch inside a base64url wrapper
 * so the token stays URL-safe without percent-encoding.
 */
export function signRenderToken(input: {
  secret: string;
  inspectionId: string;
  ttlSeconds?: number;
  now?: Date;
}): string {
  const ttl = input.ttlSeconds ?? DEFAULT_RENDER_TOKEN_TTL_SECONDS;
  const now = input.now ?? new Date();
  const exp = Math.floor(now.getTime() / 1000) + ttl;
  const payload = `${input.inspectionId}.${exp}`;
  const sig = createHmac('sha256', input.secret).update(payload).digest();
  return `${encodeSegment(String(exp))}.${sig.toString('base64url')}`;
}

/**
 * Verify a signed render token. Returns `true` if the signature is
 * valid, the expiry is in the future, and the inspection id matches.
 */
export function verifyRenderToken(input: {
  secret: string;
  inspectionId: string;
  token: string;
  now?: Date;
}): boolean {
  const { secret, inspectionId, token } = input;
  const now = input.now ?? new Date();
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expPart, sigPart] = parts as [string, string];

  let expSeconds: number;
  try {
    expSeconds = Number.parseInt(decodeSegment(expPart), 10);
  } catch {
    return false;
  }
  if (!Number.isFinite(expSeconds)) return false;
  if (expSeconds * 1000 <= now.getTime()) return false;

  const expectedPayload = `${inspectionId}.${expSeconds}`;
  const expectedSig = createHmac('sha256', secret).update(expectedPayload).digest();

  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sigPart, 'base64url');
  } catch {
    return false;
  }
  if (providedSig.length !== expectedSig.length) return false;
  return timingSafeEqual(expectedSig, providedSig);
}

/** base64url-encode an arbitrary ASCII string. */
function encodeSegment(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

/** base64url-decode back to an ASCII string. */
function decodeSegment(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}
