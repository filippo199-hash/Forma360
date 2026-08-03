/**
 * Handler for `forma360-maintenance-notify` (Phase 5B).
 *
 * For one plan-asset notification:
 *   1. Load plan + asset details.
 *   2. Check the notificationsLog dedup field — skip if already sent.
 *   3. Send a maintenance reminder email to all tenant admin users.
 *   4. Stamp the notificationsLog to prevent re-sending on retries.
 */
import type { Database } from '@forma360/db/client';
import { assets, maintenancePlanAssets, maintenancePlans } from '@forma360/db/schema';
import { usersHoldingPermission } from '@forma360/permissions/holders';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { MaintenanceNotifyPayload } from '../queues';

export interface MaintenanceNotifyDeps {
  db: Database;
  logger: Logger;
  sendTemplatedEmail: SendTemplatedEmail;
  appUrl: string;
}

export function createMaintenanceNotifyHandler(deps: MaintenanceNotifyDeps) {
  return async function handleMaintenanceNotify(
    job: Job<MaintenanceNotifyPayload>,
  ): Promise<{ sent: boolean }> {
    const { tenantId, planId, assetId, dueDate, daysBefore } = job.data;
    const log = deps.logger.child({
      job_id: job.id,
      queue: job.queueName,
      tenantId,
      planId,
      assetId,
      dueDate,
      daysBefore,
    });

    // Load the plan-asset link with dedup log.
    const linkRows = await deps.db
      .select({
        id: maintenancePlanAssets.id,
        notificationsLog: maintenancePlanAssets.notificationsLog,
      })
      .from(maintenancePlanAssets)
      .where(
        and(eq(maintenancePlanAssets.planId, planId), eq(maintenancePlanAssets.assetId, assetId)),
      )
      .limit(1);

    const link = linkRows[0];
    if (link === undefined) {
      log.warn('[maintenance-notify] link not found — skipping');
      return { sent: false };
    }

    // Dedup check.
    const rawLog = link.notificationsLog as Record<string, number[]> | null;
    const sentForDueRaw = rawLog !== null ? rawLog[dueDate] : undefined;
    const sentForDue: number[] = Array.isArray(sentForDueRaw) ? (sentForDueRaw as number[]) : [];
    if (sentForDue.includes(daysBefore)) {
      log.info('[maintenance-notify] already sent — skipping');
      return { sent: false };
    }

    // Load plan and asset names.
    const planRows = await deps.db
      .select({ name: maintenancePlans.name })
      .from(maintenancePlans)
      .where(eq(maintenancePlans.id, planId))
      .limit(1);
    const assetRows = await deps.db
      .select({ name: assets.name })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);

    const planName = planRows[0]?.name ?? planId;
    const assetName = assetRows[0]?.name ?? assetId;

    // PF-18: recipients are the people who can act — holders of
    // assets.maintenance.manage (admins included via org.settings) — not
    // every user in the tenant.
    const adminRows = await usersHoldingPermission(
      deps.db,
      tenantId,
      'assets.maintenance.manage',
    );

    const status =
      job.data.statusLabel ??
      (daysBefore === 0 ? 'overdue' : `due in ${daysBefore} day${daysBefore !== 1 ? 's' : ''}`);
    const dueDateLabel = job.data.dueLabel ?? dueDate;
    const viewUrl = `${deps.appUrl.replace(/\/+$/, '')}/en/maintenance/${planId}`;

    // Send email to each admin (swallow per-recipient errors).
    let sent = false;
    for (const admin of adminRows) {
      try {
        await deps.sendTemplatedEmail({
          to: admin.email,
          templateKey: 'maintenance-reminder',
          variables: {
            assetName,
            planName,
            dueDate: dueDateLabel,
            status,
            viewUrl,
          },
        });
        sent = true;
      } catch (err) {
        log.warn({ err, recipient: admin.email }, '[maintenance-notify] email send failed');
      }
    }

    // Only stamp the dedup marker once we've actually delivered (or there was
    // nobody to notify). If every send failed, leave this due-date window
    // unstamped and throw so BullMQ retries — otherwise the marker suppresses
    // every future attempt and the reminder is silently lost forever (an asset
    // goes un-serviced with no alert).
    if (!sent && adminRows.length > 0) {
      throw new Error('[maintenance-notify] all reminder emails failed — will retry');
    }
    // Stamp dedup log.
    const newSentForDue = [...sentForDue, daysBefore];
    await deps.db
      .update(maintenancePlanAssets)
      .set({
        notificationsLog: sql`jsonb_set(
          COALESCE(notifications_log, '{}'),
          ${sql.raw(`'{${dueDate}}'`)},
          ${JSON.stringify(newSentForDue)}::jsonb
        )`,
      })
      .where(eq(maintenancePlanAssets.id, link.id));

    log.info({ sent, recipientCount: adminRows.length }, '[maintenance-notify] done');
    return { sent };
  };
}
