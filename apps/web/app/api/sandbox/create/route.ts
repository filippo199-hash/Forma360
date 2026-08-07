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
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';

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

  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip')?.trim() ??
    'unknown';

  // Anonymous tenant creation — the tightest limit in the app.
  const rl = await rateLimit(`sandbox:create:${clientIp}`, { limit: 5, windowSec: 3600 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

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

  try {
    const { tenantId, userId, landingPath } = await provisionSandbox(db, logger, {
      brand: env.BRAND,
      choice: parsed.data,
    });

    const session = await createSandboxSession(auth, userId, env.BETTER_AUTH_SECRET);

    logger.info({ tenantId, clientIp }, '[sandbox] session issued');

    return Response.json(
      { landingPath },
      { status: 200, headers: { 'set-cookie': session.setCookie } },
    );
  } catch (err) {
    if (err instanceof SandboxChoiceError) {
      return Response.json({ error: 'Unknown scenario' }, { status: 400 });
    }
    logger.error({ err }, '[sandbox] provisioning failed');
    return Response.json({ error: 'Could not create the workspace.' }, { status: 500 });
  }
}
