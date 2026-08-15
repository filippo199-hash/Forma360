/**
 * tRPC request context.
 *
 * Built per-request by the route handler in apps/web. The context carries
 * everything a procedure might need that isn't part of its input: the db
 * client, logger, request id, (optionally) the authenticated user plus
 * the tenant they belong to, and an `enqueue` function for queueing
 * async work without reaching into the BullMQ connection directly.
 *
 * Construction is factored as `createContextFactory(staticDeps) → (perRequest) → Context`.
 * The static deps (db, logger, auth, enqueue) are built once at boot; the
 * per-request inputs (headers, resHeaders) are passed on each request.
 */
import type { Auth } from '@forma360/auth/server';
import type { Database } from '@forma360/db/client';
import type { Logger } from '@forma360/shared/logger';
import { newId, type Id } from '@forma360/shared/id';
import { resolveClientIp } from '@forma360/shared/client-ip';

/**
 * Session / user info as surfaced to a procedure. Null when the caller is
 * unauthenticated (public routes still get a context).
 */
export interface AuthedCtx {
  userId: string;
  email: string;
  tenantId: Id;
}

/**
 * Fire-and-forget enqueue used by mutations that trigger async work
 * (reconcile jobs, anonymisation fan-out). Callers do not await the
 * underlying BullMQ round-trip — we just log any enqueue error. The web
 * app wires this to `@forma360/jobs/enqueue`; tests pass a noop.
 */
export type Enqueue = (name: string, payload: unknown) => void;

/**
 * Fixed-window rate-limit check. Returns `ok: false` with a retry hint when
 * the subject `key` has exceeded `limit` within `windowSec`. Wired to a
 * Redis-backed limiter in the web app; a noop that always allows in tests.
 */
export type RateLimitFn = (
  key: string,
  opts: {
    limit: number;
    windowSec: number;
    /**
     * RL-F02: refuse rather than allow when the limiter's store is
     * unreachable. Off by default — the limiter fails OPEN for the
     * authenticated endpoints it was written for, where a Redis blip
     * should not take a feature down. An UNAUTHENTICATED write has no
     * second brake behind it, so "allow everything while Redis is down"
     * is an unbounded write path rather than graceful degradation.
     */
    failClosed?: boolean;
  },
) => Promise<{ ok: boolean; retryAfterSec: number }>;

export interface Context {
  db: Database;
  logger: Logger;
  requestId: Id;
  /** Null for public procedures; populated for authed ones. */
  auth: AuthedCtx | null;
  /** Enqueue helper for async work. Noop when not wired. */
  enqueue: Enqueue;
  /**
   * The caller's IP as seen by our own edge — the rightmost forwarded hop
   * (RL-K01). Used to key the abuse throttles on the public surface, so it
   * must be a value the caller cannot choose.
   */
  clientIp: string;
  /** Rate-limit check for public/abuse-prone procedures. */
  rateLimit: RateLimitFn;
  /**
   * The deployment's `APP_TIMEZONE` — the last resort in the document-clock
   * chain (site → tenant → deployment, BUG-14). Procedures must not read
   * env, so the factory hands it over; settings surfaces need it to NAME
   * what "use the default" will actually produce.
   */
  appTimezone: string;
}

export interface ContextStaticDeps {
  db: Database;
  auth: Auth;
  logger: Logger;
  enqueue?: Enqueue;
  rateLimit?: RateLimitFn;
  /** Defaults to `Europe/London`, matching the env schema's own default. */
  appTimezone?: string;
}

export interface ContextPerRequest {
  /** Raw request headers. better-auth reads cookies from here. */
  headers: Headers;
  /** Optional override for the request id; defaults to a fresh ULID. */
  requestId?: Id;
}

const noopEnqueue: Enqueue = () => undefined;
const allowAllRateLimit: RateLimitFn = () => Promise.resolve({ ok: true, retryAfterSec: 0 });

/**
 * Build a per-request context factory from static deps. Call once at app
 * boot; pass the returned function to the tRPC fetch adapter.
 */
export function createContextFactory(deps: ContextStaticDeps) {
  const enqueue = deps.enqueue ?? noopEnqueue;
  const rateLimit = deps.rateLimit ?? allowAllRateLimit;
  const appTimezone = deps.appTimezone ?? 'Europe/London';
  return async function createContext(input: ContextPerRequest): Promise<Context> {
    const requestId = input.requestId ?? newId();
    const requestLogger = deps.logger.child({ request_id: requestId });

    const session = await deps.auth.api.getSession({ headers: input.headers }).catch(() => null);

    const auth: AuthedCtx | null =
      session !== null && session.user.tenantId != null
        ? {
            userId: session.user.id,
            email: session.user.email,
            tenantId: session.user.tenantId as Id,
          }
        : null;

    // RL-K01: the RIGHTMOST forwarded hop, not the leftmost. See
    // `resolveClientIp` — the leftmost entry is whatever the caller sent,
    // and five rate limits are keyed on this value.
    const clientIp = resolveClientIp(input.headers);

    return {
      db: deps.db,
      logger: requestLogger,
      requestId,
      auth,
      enqueue,
      clientIp,
      rateLimit,
      appTimezone,
    };
  };
}

/**
 * Build a synthetic context for tests. Skips better-auth; authed callers
 * pass a pre-built AuthedCtx.
 */
export function createTestContext(
  overrides: Partial<Context> & Pick<Context, 'db' | 'logger'>,
): Context {
  return {
    requestId: overrides.requestId ?? newId(),
    auth: overrides.auth ?? null,
    enqueue: overrides.enqueue ?? noopEnqueue,
    clientIp: overrides.clientIp ?? 'test',
    rateLimit: overrides.rateLimit ?? allowAllRateLimit,
    appTimezone: overrides.appTimezone ?? 'Europe/London',
    ...overrides,
  };
}
