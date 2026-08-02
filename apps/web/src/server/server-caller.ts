/**
 * Server-side tRPC caller for non-HTTP entrypoints (the AI assistant).
 *
 * The agent already knows the tenant + user it's acting for (resolved from the
 * WhatsApp sender's phone, or the web session), but it isn't inside a tRPC
 * request. This builds the real app router with production deps and exposes a
 * caller bound to a synthetic authed context — so when the assistant creates
 * an observation / action / comment it goes through the *exact* same
 * procedures the web app uses: `requirePermission` enforcement, reference
 * numbers, ADR-0007 access snapshots, and notification fan-out all happen
 * for free, with zero duplicated logic.
 */
import { buildAppRouter } from '@forma360/api';
import type { Context } from '@forma360/api/context';
import { user } from '@forma360/db/schema';
import { newId, type Id } from '@forma360/shared/id';
import { eq } from 'drizzle-orm';
import { authDeps } from './auth-deps';
import { db } from './db';
import { coshhDeps } from './coshh-deps';
import { exportsDeps } from './exports-deps';
import { headsUpsDeps } from './heads-up-deps';
import { inspectionsDeps } from './inspections-deps';
import { inspectionsExportDeps } from './inspections-export-deps';
import { issuesDeps } from './issues-deps';
import { logger } from './logger';
import { permitsDeps } from './permits-deps';
import { riskAssessmentsDeps } from './risk-assessments-deps';
import { enqueue } from './trpc';
// Side-effect import: wires the users router's invite email + appUrl deps,
// mirroring the HTTP entrypoint so a caller built here behaves identically.
import './users-deps';

// Built once with the same production deps as the HTTP tRPC route. Composing
// already-imported routers is cheap; module-level registrations (dependent
// resolvers, etc.) ran at import time and are not repeated here.
const appRouter = buildAppRouter({
  exports: exportsDeps,
  inspectionsExport: inspectionsExportDeps,
  auth: authDeps,
  inspections: inspectionsDeps,
  issues: issuesDeps,
  headsUps: headsUpsDeps,
  riskAssessments: riskAssessmentsDeps,
  coshh: coshhDeps,
  permits: permitsDeps,
});

export type ServerCaller = ReturnType<typeof appRouter.createCaller>;

/**
 * Build a caller authenticated as the given tenant user. `email` is looked up
 * when not supplied — the procedures the agent calls key off `userId` +
 * `tenantId`, but we populate it for correctness/audit.
 */
export async function createServerCaller(authInput: {
  tenantId: string;
  userId: string;
  email?: string;
}): Promise<ServerCaller> {
  let email = authInput.email;
  if (email === undefined) {
    const [row] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, authInput.userId))
      .limit(1);
    email = row?.email ?? '';
  }

  const ctx: Context = {
    db,
    logger: logger.child({ component: 'agent-caller', user_id: authInput.userId }),
    requestId: newId(),
    auth: {
      userId: authInput.userId,
      email,
      tenantId: authInput.tenantId as Id,
    },
    enqueue,
    // The agent runs server-side (no HTTP client) — no IP, and its own
    // routes are already rate-limited upstream, so allow all here.
    clientIp: 'agent',
    rateLimit: () => Promise.resolve({ ok: true, retryAfterSec: 0 }),
  };

  return appRouter.createCaller(ctx);
}
