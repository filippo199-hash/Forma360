/**
 * Handler for `forma360-retention-sweep` (platform HSE review PF-31,
 * retention v1). Daily, per tenant with a `retentionMonths` policy set:
 * deletes notification-centre rows older than the cutoff.
 *
 * Deliberately narrow: the notification inbox is the only surface v1
 * covers. Statutory safety records (inspections, permits, fire logbook,
 * COSHH, RAs) are NEVER touched by retention — that would need per-module
 * legal review, not a sweep.
 */
import type { Database } from '@forma360/db/client';
import { notifications, tenants } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, isNotNull, lt } from 'drizzle-orm';

export const RETENTION_SWEEP_CRON = '40 5 * * *'; // daily 05:40 UTC

export interface RetentionSweepDeps {
  db: Database;
  logger: Logger;
  now?: () => Date;
}

export async function runRetentionSweep(
  deps: RetentionSweepDeps,
): Promise<{ tenants: number; notificationsDeleted: number }> {
  const now = deps.now?.() ?? new Date();
  const policied = await deps.db
    .select({ id: tenants.id, retentionMonths: tenants.retentionMonths })
    .from(tenants)
    .where(isNotNull(tenants.retentionMonths));

  let deleted = 0;
  for (const t of policied) {
    if (t.retentionMonths === null || t.retentionMonths <= 0) continue;
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - t.retentionMonths);
    const rows = await deps.db
      .delete(notifications)
      .where(and(eq(notifications.tenantId, t.id), lt(notifications.createdAt, cutoff)))
      .returning({ id: notifications.id });
    deleted += rows.length;
  }
  deps.logger.info(
    { tenants: policied.length, deleted },
    '[retention-sweep] run complete',
  );
  return { tenants: policied.length, notificationsDeleted: deleted };
}

export function createRetentionSweepHandler(deps: RetentionSweepDeps) {
  return async (_job: Job): Promise<{ tenants: number; notificationsDeleted: number }> =>
    runRetentionSweep(deps);
}
