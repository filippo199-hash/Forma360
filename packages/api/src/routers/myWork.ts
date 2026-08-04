/**
 * "My work" — the caller's own queue, and the counts the navigation puts
 * on it (ADR 0014).
 *
 * The dashboard (`analytics.*`) answers "how is the organisation doing"
 * and is gated on `analytics.view`, which most front-line users do not
 * hold. That left the majority of the user base with a menu full of
 * registers and no answer to the only question they open the product
 * with: *what is waiting for me?* This router is that answer.
 *
 * Two deliberate properties:
 *
 *   - **No permission gate.** Every row is keyed on `ctx.auth.userId` —
 *     you can only ever see work assigned to you. A permission check
 *     would be checking whether you are allowed to see your own name.
 *     The one exception is the approvals queue, which is a queue you own
 *     rather than a row you were assigned, so it is folded in only when
 *     the caller holds `inspections.manage`.
 *   - **Cheap.** `counts` is what the menu badge polls, so it is
 *     aggregates only — no row payloads, no joins beyond the one
 *     acknowledgement join that cannot be avoided.
 */
import {
  actions,
  headsUpRecipients,
  headsUps,
  inspections,
  inspectionWorkflowSigners,
} from '@forma360/db/schema';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { and, asc, count, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { tenantProcedure } from '../procedures';
import { router } from '../trpc';

/** Inspection statuses that mean "a reviewer still has to decide". */
const AWAITING_REVIEW = ['awaiting_approval', 'awaiting_signature_workflow'] as const;

/** The kinds of row the unified queue can contain. */
export const MY_WORK_KINDS = [
  'action',
  'acknowledgement',
  'signature',
  'inspection',
  'approval',
] as const;
export type MyWorkKind = (typeof MY_WORK_KINDS)[number];

export interface MyWorkRow {
  kind: MyWorkKind;
  id: string;
  title: string;
  /** Locale-less path; the client prefixes the active locale. */
  href: string;
  dueAt: Date | null;
  overdue: boolean;
}

export interface MyWorkRouterDeps {
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export function createMyWorkRouter(deps: MyWorkRouterDeps = {}) {
  const now = (): Date => deps.now?.() ?? new Date();

  /** Does the caller own the approvals queue? */
  async function ownsApprovals(
    db: Parameters<typeof loadUserPermissions>[0],
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    const perms = await loadUserPermissions(db, tenantId, userId);
    return perms.includes('inspections.manage') || grantsAdminAccess(perms);
  }

  const counts = tenantProcedure.query(async ({ ctx }) => {
    const at = now();
    const me = ctx.auth.userId;

    const [actionRows, ackRows, signatureRows, draftRows, canApprove] = await Promise.all([
      ctx.db
        .select({
          open: count(),
          overdue: count(
            sql`CASE WHEN ${actions.dueAt} IS NOT NULL AND ${actions.dueAt} < ${at} THEN 1 END`,
          ),
        })
        .from(actions)
        .where(
          and(
            eq(actions.tenantId, ctx.tenantId),
            eq(actions.assigneeUserId, me),
            notInArray(actions.status, ['completed', 'cancelled']),
            isNull(actions.archivedAt),
          ),
        ),
      ctx.db
        .select({ n: count() })
        .from(headsUpRecipients)
        .innerJoin(headsUps, eq(headsUps.id, headsUpRecipients.headsUpId))
        .where(
          and(
            eq(headsUps.tenantId, ctx.tenantId),
            eq(headsUps.status, 'published'),
            eq(headsUps.requireAcknowledgement, true),
            eq(headsUpRecipients.userId, me),
            isNull(headsUpRecipients.acknowledgedAt),
          ),
        ),
      ctx.db
        .select({ n: count() })
        .from(inspectionWorkflowSigners)
        .where(
          and(
            eq(inspectionWorkflowSigners.tenantId, ctx.tenantId),
            eq(inspectionWorkflowSigners.signerUserId, me),
            eq(inspectionWorkflowSigners.status, 'pending'),
          ),
        ),
      ctx.db
        .select({ n: count() })
        .from(inspections)
        .where(
          and(
            eq(inspections.tenantId, ctx.tenantId),
            eq(inspections.status, 'in_progress'),
            isNull(inspections.archivedAt),
            or(eq(inspections.conductedBy, me), eq(inspections.createdBy, me)),
          ),
        ),
      ownsApprovals(ctx.db, ctx.tenantId, me),
    ]);

    let awaitingApproval = 0;
    if (canApprove) {
      const rows = await ctx.db
        .select({ n: count() })
        .from(inspections)
        .where(
          and(
            eq(inspections.tenantId, ctx.tenantId),
            inArray(inspections.status, [...AWAITING_REVIEW]),
            isNull(inspections.archivedAt),
          ),
        );
      awaitingApproval = rows[0]?.n ?? 0;
    }

    const myOpenActions = actionRows[0]?.open ?? 0;
    const myPendingAcks = ackRows[0]?.n ?? 0;
    const mySignatures = signatureRows[0]?.n ?? 0;
    const myDraftInspections = draftRows[0]?.n ?? 0;

    return {
      myOpenActions,
      myOverdueActions: actionRows[0]?.overdue ?? 0,
      myPendingAcks,
      mySignatures,
      myDraftInspections,
      awaitingApproval,
      /** What the "My work" badge shows — the caller's own rows only. */
      total: myOpenActions + myPendingAcks + mySignatures + myDraftInspections,
    };
  });

  const list = tenantProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          kinds: z.array(z.enum(MY_WORK_KINDS)).optional(),
        })
        .default({ limit: 50 }),
    )
    .query(async ({ ctx, input }) => {
      const at = now();
      const me = ctx.auth.userId;
      const wants = (kind: MyWorkKind): boolean =>
        input.kinds === undefined || input.kinds.includes(kind);

      const rows: MyWorkRow[] = [];

      if (wants('action')) {
        const found = await ctx.db
          .select({
            id: actions.id,
            title: actions.title,
            dueAt: actions.dueAt,
            reference: actions.referenceNumber,
          })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, ctx.tenantId),
              eq(actions.assigneeUserId, me),
              notInArray(actions.status, ['completed', 'cancelled']),
              isNull(actions.archivedAt),
            ),
          )
          .orderBy(asc(actions.dueAt), desc(actions.id))
          .limit(input.limit);
        for (const r of found) {
          rows.push({
            kind: 'action',
            id: r.id,
            title: r.reference === null ? r.title : `${r.reference} — ${r.title}`,
            href: `/actions/${r.id}`,
            dueAt: r.dueAt,
            overdue: r.dueAt !== null && r.dueAt < at,
          });
        }
      }

      if (wants('acknowledgement')) {
        const found = await ctx.db
          .select({ id: headsUps.id, title: headsUps.title, expiresAt: headsUps.expiresAt })
          .from(headsUpRecipients)
          .innerJoin(headsUps, eq(headsUps.id, headsUpRecipients.headsUpId))
          .where(
            and(
              eq(headsUps.tenantId, ctx.tenantId),
              eq(headsUps.status, 'published'),
              eq(headsUps.requireAcknowledgement, true),
              eq(headsUpRecipients.userId, me),
              isNull(headsUpRecipients.acknowledgedAt),
            ),
          )
          .orderBy(asc(headsUps.expiresAt))
          .limit(input.limit);
        for (const r of found) {
          rows.push({
            kind: 'acknowledgement',
            id: r.id,
            title: r.title,
            href: `/heads-up/${r.id}/view`,
            dueAt: r.expiresAt,
            overdue: r.expiresAt !== null && r.expiresAt < at,
          });
        }
      }

      if (wants('signature')) {
        const found = await ctx.db
          .select({
            id: inspections.id,
            title: inspections.title,
            position: inspectionWorkflowSigners.position,
          })
          .from(inspectionWorkflowSigners)
          .innerJoin(inspections, eq(inspections.id, inspectionWorkflowSigners.inspectionId))
          .where(
            and(
              eq(inspectionWorkflowSigners.tenantId, ctx.tenantId),
              eq(inspectionWorkflowSigners.signerUserId, me),
              eq(inspectionWorkflowSigners.status, 'pending'),
            ),
          )
          .limit(input.limit);
        for (const r of found) {
          rows.push({
            kind: 'signature',
            id: r.id,
            title: r.title,
            href: `/inspections/${r.id}/status`,
            dueAt: null,
            overdue: false,
          });
        }
      }

      if (wants('inspection')) {
        const found = await ctx.db
          .select({ id: inspections.id, title: inspections.title, startedAt: inspections.startedAt })
          .from(inspections)
          .where(
            and(
              eq(inspections.tenantId, ctx.tenantId),
              eq(inspections.status, 'in_progress'),
              isNull(inspections.archivedAt),
              or(eq(inspections.conductedBy, me), eq(inspections.createdBy, me)),
            ),
          )
          .orderBy(desc(inspections.startedAt))
          .limit(input.limit);
        for (const r of found) {
          rows.push({
            kind: 'inspection',
            id: r.id,
            title: r.title,
            href: `/inspections/${r.id}`,
            dueAt: null,
            overdue: false,
          });
        }
      }

      if (wants('approval') && (await ownsApprovals(ctx.db, ctx.tenantId, me))) {
        const found = await ctx.db
          .select({ id: inspections.id, title: inspections.title })
          .from(inspections)
          .where(
            and(
              eq(inspections.tenantId, ctx.tenantId),
              inArray(inspections.status, [...AWAITING_REVIEW]),
              isNull(inspections.archivedAt),
            ),
          )
          .limit(input.limit);
        for (const r of found) {
          rows.push({
            kind: 'approval',
            id: r.id,
            title: r.title,
            href: `/approvals/${r.id}`,
            dueAt: null,
            overdue: false,
          });
        }
      }

      // Overdue first, then by due date, then undated. A single sort over
      // the merged set — the queue is "what is late", not "what is an
      // action"; grouping by module would bury the one overdue row under
      // thirty tidy ones.
      rows.sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.dueAt === null && b.dueAt === null) return 0;
        if (a.dueAt === null) return 1;
        if (b.dueAt === null) return -1;
        return a.dueAt.getTime() - b.dueAt.getTime();
      });

      return { rows: rows.slice(0, input.limit), truncated: rows.length > input.limit };
    });

  return router({ counts, list });
}
