/**
 * Fixed-window rate limiter backed by the shared Redis connection.
 *
 * Used to cap abuse of expensive or sensitive endpoints (AI token spend,
 * inbound WhatsApp processing). Keyed by a caller-supplied subject string —
 * e.g. `ai:chat:<userId>` or `wa:<phone>`.
 *
 * Fails OPEN: if Redis is unreachable the request is allowed. Availability of
 * the feature outweighs a brief limiter outage, and every gated endpoint is
 * already authenticated/signature-checked, so this is a spend/DoS control, not
 * an authorization control.
 */
import { redis } from './redis';

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets (only meaningful when `ok` is false). */
  retryAfterSec: number;
}

export async function rateLimit(
  key: string,
  opts: { limit: number; windowSec: number },
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      // First hit in this window — set the expiry so the counter resets.
      await redis.expire(redisKey, opts.windowSec);
    }
    if (count > opts.limit) {
      const ttl = await redis.ttl(redisKey);
      return { ok: false, remaining: 0, retryAfterSec: ttl > 0 ? ttl : opts.windowSec };
    }
    return { ok: true, remaining: Math.max(0, opts.limit - count), retryAfterSec: 0 };
  } catch {
    return { ok: true, remaining: opts.limit, retryAfterSec: 0 };
  }
}

/** Standard 429 JSON response with a `Retry-After` header. */
export function tooManyRequests(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: 'RATE_LIMITED', retryAfterSec }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSec),
    },
  });
}
