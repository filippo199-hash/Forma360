/**
 * Sentry wiring check.
 *
 * Proves, from production, that the whole chain works: the SDK is
 * initialised, the DSN resolves, an event reaches Sentry, and it arrives
 * with the tags we expect and none of the payload we do not.
 *
 * A "is it configured" endpoint that only reads env vars would prove
 * nothing — the failure mode is always a transport or an option, not a
 * missing string. So this actually captures an event and returns its id,
 * which you can look up in Sentry.
 *
 * Auth: session + `org.settings` (administrator). Not a public canary —
 * an unauthenticated error-injection endpoint is a free way to burn
 * someone's Sentry quota.
 */
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { resolveEnvironment, resolveRelease } from '@forma360/shared/sentry-options';
import * as Sentry from '@sentry/nextjs';
import { headers } from 'next/headers';
import { createContext } from '../../../../src/server/trpc';

class SentryWiringCheck extends Error {
  constructor(requestId: string) {
    super(`Sentry wiring check (deliberate, request ${requestId})`);
    this.name = 'SentryWiringCheck';
  }
}

export async function POST(): Promise<Response> {
  const ctx = await createContext({ headers: await headers() });
  if (ctx.auth === null) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!grantsAdminAccess(perms)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const configured = (process.env.SENTRY_DSN ?? '').length > 0;

  let eventId: string | undefined;
  Sentry.withScope((scope) => {
    scope.setTag('procedure', 'debug.sentryCheck');
    scope.setTag('tenantId', ctx.auth?.tenantId ?? 'unknown');
    scope.setTag('x-request-id', ctx.requestId);
    if (ctx.auth !== null) scope.setUser({ id: ctx.auth.userId });
    eventId = Sentry.captureException(new SentryWiringCheck(ctx.requestId));
  });

  // Force delivery before the serverless response returns, otherwise the
  // event can be lost when the runtime freezes the process.
  await Sentry.flush(3_000);

  return Response.json({
    configured,
    eventId: eventId ?? null,
    environment: resolveEnvironment(process.env),
    release: resolveRelease(process.env) ?? null,
    clientDsnConfigured: (process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').length > 0,
    requestId: ctx.requestId,
  });
}
