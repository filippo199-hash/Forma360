/**
 * Handler for `forma360-sandbox-ttl-sweep` (ADR 0017; security review
 * — the last open sandbox item). Daily: neutralises try-it-now
 * workspaces that were never claimed.
 *
 * A sandbox hands a real Administrator session to an anonymous visitor.
 * `claimedAt` is the marker that a human attached an email; a workspace
 * still unclaimed after {@link SANDBOX_TTL_DAYS} days is abandoned, and
 * leaving it live means its 90-day sessions and its data accumulate
 * forever — which is exactly how an anonymous POST once bought a
 * permanent mailer (see `sandboxPermissionKeys`).
 *
 * What sweeping means here — three levers, weakest to strongest:
 *   1. `tenants.archivedAt` — the bookkeeping marker (nothing gates on
 *      it at request time today).
 *   2. delete `session` rows — cleanup, NOT the control: better-auth's
 *      5-minute cookie cache can outlive the row (SEC-D01..D05).
 *   3. `user.deactivatedAt` — the control. `isUserActive` is a live
 *      per-request check in createContext, so a deactivated sandbox
 *      user is out on their next request regardless of cookies.
 *
 * HARD deletion of the tenant subgraph is deliberately not done here —
 * that is M14 (tenant deletion), a feature with its own FK-order and
 * legal questions. A swept sandbox is inert and cheap; reclaiming its
 * rows can come later without changing this worker's contract.
 *
 * Idempotent: a swept tenant no longer matches the WHERE (archivedAt is
 * stamped), so re-runs skip it.
 */
import type { Database } from '@forma360/db/client';
import { session, tenants, user } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

export const SANDBOX_TTL_SWEEP_CRON = '10 4 * * *'; // daily 04:10 UTC

/** Days an unclaimed sandbox survives before the sweep takes it. */
export const SANDBOX_TTL_DAYS = 7;

export interface SandboxTtlSweepDeps {
  db: Database;
  logger: Logger;
  now?: () => Date;
}

export interface SandboxTtlSweepResult {
  sweptTenants: number;
  deactivatedUsers: number;
  deletedSessions: number;
}

export async function runSandboxTtlSweep(
  deps: SandboxTtlSweepDeps,
): Promise<SandboxTtlSweepResult> {
  const now = deps.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - SANDBOX_TTL_DAYS * 86_400_000);

  const stale = await deps.db
    .select({ id: tenants.id, createdAt: tenants.createdAt })
    .from(tenants)
    .where(
      and(
        sql`${tenants.settings} -> 'sandbox' IS NOT NULL`,
        sql`${tenants.settings} -> 'sandbox' ->> 'claimedAt' IS NULL`,
        isNull(tenants.archivedAt),
        lt(tenants.createdAt, cutoff),
      ),
    );

  let deactivatedUsers = 0;
  let deletedSessions = 0;
  for (const t of stale) {
    // Per-tenant transaction: a failure on one abandoned workspace must
    // not stop the sweep from taking the rest.
    await deps.db.transaction(async (tx) => {
      const tenantUsers = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.tenantId, t.id));
      const userIds = tenantUsers.map((u) => u.id);

      if (userIds.length > 0) {
        const deactivated = await tx
          .update(user)
          .set({ deactivatedAt: now })
          .where(and(eq(user.tenantId, t.id), isNull(user.deactivatedAt)))
          .returning({ id: user.id });
        deactivatedUsers += deactivated.length;

        const sessions = await tx
          .delete(session)
          .where(inArray(session.userId, userIds))
          .returning({ id: session.id });
        deletedSessions += sessions.length;
      }

      await tx
        .update(tenants)
        .set({
          archivedAt: now,
          settings: sql`jsonb_set(${tenants.settings}, '{sandbox,sweptAt}', to_jsonb(${now.toISOString()}::text))`,
        })
        .where(eq(tenants.id, t.id));
    });
  }

  deps.logger.info(
    { sweptTenants: stale.length, deactivatedUsers, deletedSessions },
    '[sandbox-ttl-sweep] run complete',
  );
  return { sweptTenants: stale.length, deactivatedUsers, deletedSessions };
}

export function createSandboxTtlSweepHandler(deps: SandboxTtlSweepDeps) {
  return async (_job: Job): Promise<SandboxTtlSweepResult> => runSandboxTtlSweep(deps);
}
