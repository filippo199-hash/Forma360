/**
 * Try-it-now workspace creation (ADR 0017).
 *
 * The only unauthenticated endpoint that writes a tenant. A visitor
 * picks a job and a refinement on `/try`; this provisions a seeded
 * workspace, mints a real better-auth session, and hands back the route
 * to land on. No email, no password, no account.
 *
 * Guards, in order:
 *   - the brand must actually offer the chosen tile (resolved inside
 *     `provisionSandbox`, which refuses rather than substituting);
 *   - per-IP rate limiting, because this is anonymous tenant creation
 *     and therefore the most abuse-prone surface in the product;
 *   - Zod at the boundary on the request body.
 *
 * The session cookie is set on the response here rather than inside the
 * provisioning function so the DB work stays testable without a
 * request/response pair.
 */
import { provisionSandbox, SandboxChoiceError } from '@forma360/api/sandbox';
import { createSandboxSession } from '@forma360/auth/sandbox-session';
import { sandboxChoiceSchema, scenariosForBrand } from '@forma360/shared/sandbox-scenarios';
import { auth } from '../../../../src/server/auth';
import { db } from '../../../../src/server/db';
import { env } from '../../../../src/server/env';
import { logger } from '../../../../src/server/logger';
import { rateLimit, rateLimiterHealthy, tooManyRequests } from '../../../../src/server/rate-limit';

export async function POST(request: Request): Promise<Response> {
  // A brand with no tiles does not offer the sandbox at all.
  if (scenariosForBrand(env.BRAND).length === 0) {
    return Response.json({ error: 'Not available' }, { status: 404 });
  }

  // Already signed in? Provisioning a second workspace would strand the
  // first one. Send them to the app instead.
  const existing = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (existing !== null) {
    return Response.json({ error: 'Already signed in' }, { status: 409 });
  }

  // Only trust hops the platform controls. `x-forwarded-for` is
  // APPENDED to by the edge proxy, so its LEFTMOST entry is whatever
  // the client sent — keying the limiter on it lets one spoofed header
  // per request give an attacker a fresh counter every time, which on
  // the one endpoint that creates tenants anonymously means no cap at
  // all. `x-real-ip` is set by the proxy and cannot be forged; the
  // rightmost forwarded hop is the next best thing. An absent value
  // collapses to one shared bucket rather than a free pass.
  const forwarded = request.headers.get('x-forwarded-for');
  const rightmostHop = forwarded?.split(',').pop()?.trim();
  const clientIp =
    request.headers.get('x-real-ip')?.trim() ||
    (rightmostHop !== undefined && rightmostHop.length > 0 ? rightmostHop : '') ||
    'unknown';

  // Anonymous tenant creation — the tightest limit in the app.
  const rl = await rateLimit(`sandbox:create:${clientIp}`, { limit: 5, windowSec: 3600 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  // The shared limiter fails OPEN by design — availability beats a
  // brief Redis outage on endpoints that are already authenticated.
  // This one is not authenticated and writes a tenant, so a limiter
  // outage here means unbounded anonymous writes. Refuse instead.
  if (!(await rateLimiterHealthy())) {
    logger.warn({ clientIp }, '[sandbox] limiter unavailable — refusing anonymous creation');
    return Response.json({ error: 'Temporarily unavailable' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }

  const parsed = sandboxChoiceSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }

  let provisioned: { tenantId: string; userId: string; landingPath: string };
  try {
    provisioned = await provisionSandbox(db, logger, {
      brand: env.BRAND,
      choice: parsed.data,
    });
  } catch (err) {
    if (err instanceof SandboxChoiceError) {
      return Response.json({ error: 'Unknown scenario' }, { status: 400 });
    }
    // Provisioning is one transaction, so a failure here leaves nothing
    // behind.
    logger.error({ err }, '[sandbox] provisioning failed');
    return Response.json({ error: 'Could not create the workspace.' }, { status: 500 });
  }

  try {
    const session = await createSandboxSession(auth, provisioned.userId, env.BETTER_AUTH_SECRET);
    logger.info({ tenantId: provisioned.tenantId, clientIp }, '[sandbox] session issued');
    return Response.json(
      { landingPath: provisioned.landingPath },
      { status: 200, headers: { 'set-cookie': session.setCookie } },
    );
  } catch (err) {
    // The tenant committed but nobody can reach it — it has no session
    // and no email, so it is unreachable by construction. Logged with
    // the id so it is traceable, and left for the TTL sweep, which
    // collects any sandbox whose `claimedAt` never arrives.
    logger.error(
      { err, tenantId: provisioned.tenantId, orphaned: true },
      '[sandbox] session minting failed — workspace orphaned',
    );
    return Response.json({ error: 'Could not create the workspace.' }, { status: 500 });
  }
}
