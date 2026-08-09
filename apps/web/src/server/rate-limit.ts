/**
 * Fixed-window rate limiter backed by the shared Redis connection.
 *
 * Used to cap abuse of expensive or sensitive endpoints (AI token spend,
 * inbound WhatsApp processing). Keyed by a caller-supplied subject string —
 * e.g. `ai:chat:<userId>` or `wa:<phone>`.
 *
 * Fails OPEN by default: if Redis is unreachable the request is allowed.
 * Availability of the feature outweighs a brief limiter outage.
 *
 * RL-F02 — the framing matters more than the default. That trade was
 * justified in this comment on the premise that "every gated endpoint is
 * already authenticated/signature-checked, so this is a spend/DoS control,
 * not an authorization control". True when it was written; not true now.
 * `issues.createFromShareToken`, `auth.signUpWithTenant` and
 * `POST /api/sandbox/create` are unauthenticated writes with this limiter
 * as their ONLY brake, so for them "allow everything while Redis is down"
 * is an unbounded write path.
 *
 * The premise expired and nothing re-examined it when the unauthenticated
 * surface appeared. So the fix is per-call rather than global: pass
 * `failClosed: true` where the limiter is the only thing standing there,
 * and let the session-backed endpoints keep degrading gracefully.
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
  opts: { limit: number; windowSec: number; failClosed?: boolean },
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
    // RL-F02. Fail closed only where the caller asked for it.
    if (opts.failClosed === true) {
      return { ok: false, remaining: 0, retryAfterSec: opts.windowSec };
    }
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

/**
 * Is the limiter actually able to count right now?
 *
 * {@link rateLimit} fails OPEN — the right trade for endpoints that are
 * already authenticated, where a Redis blip should not take the feature
 * down. Anonymous tenant creation is the exception: it is unauthenticated
 * and it writes, so "allow everything while Redis is down" is an
 * unbounded write path rather than a graceful degradation. That endpoint
 * calls this and refuses when the answer is no.
 */
export async function rateLimiterHealthy(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
