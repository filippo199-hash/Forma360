/**
 * Admin utility router — Phase 2 PR 33.
 *
 *   - previewDependents (tenantProcedure) — runs the `getDependents`
 *     registry (see `@forma360/permissions/dependents`) for a given
 *     entity + id and returns a sorted `[{module, count}]` list.
 *     Used by the reusable ArchiveDialog in the web UI to warn
 *     admins about cascading effects before they commit.
 *
 *     No additional permission gate is layered here: the caller must
 *     also hold the entity-specific archive/delete permission, which
 *     is enforced on the actual mutation (e.g. `templates.archive`,
 *     `groups.archive`). Previewing alone is cheap and leaks no data
 *     beyond counts-per-module within the caller's tenant.
 */
import {
  actionActivity,
  coshhEvents,
  contractorVisitEvents,
  fireEvents,
  issueActivity,
  permitEvents,
  riskAssessmentEvents,
  user,
} from '@forma360/db/schema';
import { getDependents } from '@forma360/permissions/dependents';
import { and, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import type { Column, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const dependentEntity = z.enum([
  'tenant',
  'group',
  'site',
  'user',
  'permissionSet',
  'customUserField',
  'accessRule',
  'template',
  'inspection',
  'action',
  // ADR 0018: dashboards register a delivery-schedule dependent resolver.
  'dashboard',
]);

const previewDependentsInput = z.object({
  entity: dependentEntity,
  id: z.string().min(1).max(64),
});

export const adminRouter = router({
  previewDependents: tenantProcedure.input(previewDependentsInput).query(async ({ ctx, input }) => {
    const counts = await getDependents(
      { db: ctx.db },
      { entity: input.entity, id: input.id, tenantId: ctx.tenantId },
    );
    return Object.entries(counts)
      .map(([module, count]) => ({ module, count }))
      .sort((a, b) => b.count - a.count || a.module.localeCompare(b.module));
  }),

  /**
   * PF-31: the tenant-wide audit feed. `org.audit.view` was in the
   * catalogue since Phase 1 with no consumer — this merges the per-module
   * append-only event tables into one reverse-chronological stream.
   * Read-only; each module keeps writing its own table (per-record pages
   * stay untouched).
   */
  auditLog: tenantProcedure
    .use(requirePermission('org.audit.view'))
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          /** Keyset: only events strictly older than this instant. */
          before: z.string().datetime().optional(),
          module: z
            .enum([
              'all',
              'actions',
              'observations',
              'permits',
              'coshh',
              'riskAssessments',
              'fireSafety',
              'contractors',
            ])
            .default('all'),
          /** Only events by this actor. */
          actorUserId: z.string().min(1).max(40).optional(),
          /** Event-kind contains (case-insensitive), e.g. "created". */
          eventType: z.string().min(1).max(100).optional(),
          /** Free text across event kind + detail (case-insensitive). */
          search: z.string().min(1).max(200).optional(),
        })
        .default({ limit: 50, module: 'all' }),
    )
    .query(async ({ ctx, input }) => {
      const cutoff = input.before !== undefined ? new Date(input.before) : null;
      const per = input.limit;
      const want = (m: string): boolean => input.module === 'all' || input.module === m;

      // Structured/search filters applied per source in SQL so keyset
      // pagination stays correct (each source returns up to `per` MATCHING
      // rows). `detail` is omitted for sources without a detail column, so
      // there search matches the event kind only.
      const searchLike = input.search !== undefined ? `%${input.search.trim()}%` : null;
      const eventLike = input.eventType !== undefined ? `%${input.eventType.trim()}%` : null;
      const extra = (cols: { actor: Column; kind: Column; detail?: Column }): SQL[] => {
        const c: SQL[] = [];
        if (input.actorUserId !== undefined) c.push(eq(cols.actor, input.actorUserId));
        if (eventLike !== null) c.push(ilike(sql`${cols.kind}::text`, eventLike));
        if (searchLike !== null) {
          const parts: SQL[] = [ilike(sql`${cols.kind}::text`, searchLike)];
          if (cols.detail !== undefined) parts.push(ilike(cols.detail, searchLike));
          const combined = or(...parts);
          if (combined !== undefined) c.push(combined);
        }
        return c;
      };

      interface AuditRow {
        module: string;
        entityId: string;
        kind: string;
        detail: string;
        actorUserId: string | null;
        createdAt: Date;
      }
      const sources: Array<Promise<AuditRow[]>> = [];
      if (want('actions')) {
        sources.push(
          ctx.db
            .select({
              entityId: actionActivity.actionId,
              kind: actionActivity.kind,
              actorUserId: actionActivity.actorUserId,
              createdAt: actionActivity.createdAt,
            })
            .from(actionActivity)
            .where(
              and(
                eq(actionActivity.tenantId, ctx.tenantId),
                ...(cutoff !== null ? [lt(actionActivity.createdAt, cutoff)] : []),
                ...extra({ actor: actionActivity.actorUserId, kind: actionActivity.kind }),
              ),
            )
            .orderBy(desc(actionActivity.createdAt))
            .limit(per)
            .then((rows) =>
              rows.map((r) => ({ ...r, module: 'actions', detail: '', kind: String(r.kind) })),
            ),
        );
      }
      if (want('observations')) {
        sources.push(
          ctx.db
            .select({
              entityId: issueActivity.issueId,
              kind: issueActivity.kind,
              actorUserId: issueActivity.actorUserId,
              createdAt: issueActivity.createdAt,
            })
            .from(issueActivity)
            .where(
              and(
                eq(issueActivity.tenantId, ctx.tenantId),
                ...(cutoff !== null ? [lt(issueActivity.createdAt, cutoff)] : []),
                ...extra({ actor: issueActivity.actorUserId, kind: issueActivity.kind }),
              ),
            )
            .orderBy(desc(issueActivity.createdAt))
            .limit(per)
            .then((rows) =>
              rows.map((r) => ({ ...r, module: 'observations', detail: '', kind: String(r.kind) })),
            ),
        );
      }
      if (want('permits')) {
        sources.push(
          ctx.db
            .select({
              entityId: permitEvents.permitId,
              kind: permitEvents.kind,
              detail: permitEvents.detail,
              actorUserId: permitEvents.actorUserId,
              createdAt: permitEvents.createdAt,
            })
            .from(permitEvents)
            .where(
              and(
                eq(permitEvents.tenantId, ctx.tenantId),
                ...(cutoff !== null ? [lt(permitEvents.createdAt, cutoff)] : []),
                ...extra({
                  actor: permitEvents.actorUserId,
                  kind: permitEvents.kind,
                  detail: permitEvents.detail,
                }),
              ),
            )
            .orderBy(desc(permitEvents.createdAt))
            .limit(per)
            .then((rows) => rows.map((r) => ({ ...r, module: 'permits', kind: String(r.kind) }))),
        );
      }
      if (want('coshh')) {
        sources.push(
          ctx.db
            .select({
              entityId: coshhEvents.entityId,
              kind: coshhEvents.kind,
              detail: coshhEvents.detail,
              actorUserId: coshhEvents.actorUserId,
              createdAt: coshhEvents.createdAt,
            })
            .from(coshhEvents)
            .where(
              and(
                eq(coshhEvents.tenantId, ctx.tenantId),
                ...(cutoff !== null ? [lt(coshhEvents.createdAt, cutoff)] : []),
                ...extra({
                  actor: coshhEvents.actorUserId,
                  kind: coshhEvents.kind,
                  detail: coshhEvents.detail,
                }),
              ),
            )
            .orderBy(desc(coshhEvents.createdAt))
            .limit(per)
            .then((rows) => rows.map((r) => ({ ...r, module: 'coshh', kind: String(r.kind) }))),
        );
      }
      if (want('riskAssessments')) {
        sources.push(
          ctx.db
            .select({
              entityId: riskAssessmentEvents.assessmentId,
              kind: riskAssessmentEvents.kind,
              detail: riskAssessmentEvents.detail,
              actorUserId: riskAssessmentEvents.actorUserId,
              createdAt: riskAssessmentEvents.createdAt,
            })
            .from(riskAssessmentEvents)
            .where(
              and(
                eq(riskAssessmentEvents.tenantId, ctx.tenantId),
                ...(cutoff !== null ? [lt(riskAssessmentEvents.createdAt, cutoff)] : []),
                ...extra({
                  actor: riskAssessmentEvents.actorUserId,
                  kind: riskAssessmentEvents.kind,
                  detail: riskAssessmentEvents.detail,
                }),
              ),
            )
            .orderBy(desc(riskAssessmentEvents.createdAt))
            .limit(per)
            .then((rows) =>
              rows.map((r) => ({ ...r, module: 'riskAssessments', kind: String(r.kind) })),
            ),
        );
      }
      if (want('fireSafety')) {
        sources.push(
          ctx.db
            .select({
              entityId: fireEvents.entityId,
              kind: fireEvents.kind,
              detail: fireEvents.detail,
              actorUserId: fireEvents.actorUserId,
              createdAt: fireEvents.createdAt,
            })
            .from(fireEvents)
            .where(
              and(
                eq(fireEvents.tenantId, ctx.tenantId),
                ...(cutoff !== null ? [lt(fireEvents.createdAt, cutoff)] : []),
                ...extra({
                  actor: fireEvents.actorUserId,
                  kind: fireEvents.kind,
                  detail: fireEvents.detail,
                }),
              ),
            )
            .orderBy(desc(fireEvents.createdAt))
            .limit(per)
            .then((rows) =>
              rows.map((r) => ({ ...r, module: 'fireSafety', kind: String(r.kind) })),
            ),
        );
      }
      if (want('contractors')) {
        sources.push(
          ctx.db
            .select({
              entityId: contractorVisitEvents.visitId,
              kind: contractorVisitEvents.eventType,
              actorUserId: contractorVisitEvents.actorUserId,
              createdAt: contractorVisitEvents.createdAt,
            })
            .from(contractorVisitEvents)
            .where(
              and(
                eq(contractorVisitEvents.tenantId, ctx.tenantId),
                ...(cutoff !== null ? [lt(contractorVisitEvents.createdAt, cutoff)] : []),
                ...extra({
                  actor: contractorVisitEvents.actorUserId,
                  kind: contractorVisitEvents.eventType,
                }),
              ),
            )
            .orderBy(desc(contractorVisitEvents.createdAt))
            .limit(per)
            .then((rows) =>
              rows.map((r) => ({ ...r, module: 'contractors', detail: '', kind: String(r.kind) })),
            ),
        );
      }

      const merged = (await Promise.all(sources))
        .flat()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, per);

      // Resolve actor names in one pass.
      const actorIds = [
        ...new Set(merged.flatMap((r) => (r.actorUserId === null ? [] : [r.actorUserId]))),
      ];
      const actors =
        actorIds.length > 0
          ? await ctx.db
              .select({ id: user.id, name: user.name })
              .from(user)
              .where(inArray(user.id, actorIds))
          : [];
      const nameById = new Map(actors.map((a) => [a.id, a.name]));
      return {
        rows: merged.map((r) => ({
          ...r,
          actorName: r.actorUserId === null ? null : (nameById.get(r.actorUserId) ?? null),
        })),
        hasMore: merged.length === per,
      };
    }),
});
