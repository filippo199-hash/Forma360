/**
 * tRPC request context.
 *
 * Built per-request by the route handler in apps/web. The context carries
 * everything a procedure might need that isn't part of its input: the db
 * client, logger, request id, and (optionally) the authenticated user plus
 * the tenant they belong to.
 *
 * Construction is factored as `createContextFactory(staticDeps) → (perRequest) → Context`.
 * The static deps (db, logger, auth) are built once at boot; the per-request
 * inputs (headers, resHeaders) are passed on each request. This keeps the
 * heavy setup out of the hot path and lets tests construct contexts without
 * a Request object.
 */
import type { Auth } from '@forma360/auth/server';
import type { Database } from '@forma360/db/client';
import type { Logger } from '@forma360/shared/logger';
import { newId, type Id } from '@forma360/shared/id';

/**
 * Session / user info as surfaced to a procedure. Null when the caller is
 * unauthenticated (public routes still get a context).
 */
export interface AuthedCtx {
  userId: string;
  email: string;
  tenantId: Id;
}

export interface Context {
  db: Database;
  logger: Logger;
  requestId: Id;
  /** Null for public procedures; populated for authed ones. */
  auth: AuthedCtx | null;
}

export interface ContextStaticDeps {
  db: Database;
  auth: Auth;
  logger: Logger;
}

export interface ContextPerRequest {
  /** Raw request headers. better-auth reads cookies from here. */
  headers: Headers;
  /** Optional override for the request id; defaults to a fresh ULID. */
  requestId?: Id;
}

/**
 * Build a per-request context factory from static deps. Call once at app
 * boot; pass the returned function to the tRPC fetch adapter.
 */
export function createContextFactory(deps: ContextStaticDeps) {
  return async function createContext(input: ContextPerRequest): Promise<Context> {
    const requestId = input.requestId ?? newId();
    const requestLogger = deps.logger.child({ request_id: requestId });

    const session = await deps.auth.api.getSession({ headers: input.headers }).catch(() => null);

    const auth: AuthedCtx | null =
      session !== null && session.user.tenantId != null
        ? {
            userId: session.user.id,
            email: session.user.email,
            // better-auth returns our custom tenantId field via the Drizzle adapter.
            tenantId: session.user.tenantId as Id,
          }
        : null;

    return {
      db: deps.db,
      logger: requestLogger,
      requestId,
      auth,
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
    ...overrides,
  };
}
