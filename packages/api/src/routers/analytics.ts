/**
 * Analytics router — the cross-module dashboard (platform HSE review
 * PF-5: "no dashboard, no analytics, no reports, anywhere").
 *
 * Three surfaces, all read-only, all gated by `analytics.view` (the
 * permission keys have existed in the catalogue since Phase 1 —
 * forward-declared; this router is the first consumer):
 *
 *   - `dashboard`  — needs-attention counts across every module the
 *     brand ships. One cheap aggregate per tile; the numbers mirror
 *     what each module's own needs-attention strip shows, so the two
 *     never disagree on semantics.
 *   - `trends`     — 8 weekly buckets of actions created/completed,
 *     inspections completed and observations raised, for the inline
 *     SVG charts (no chart library — ground rule 9).
 *   - `siteComparison` — per-site open actions / open observations /
 *     inspections completed (30 d), so "which site is slipping?" has
 *     an answer that isn't five CSV exports and a pivot table.
 *
 * Brand-gated modules (permits, COSHH, risk assessments — ADR 0010)
 * only contribute tiles when the module is enabled for the deployment;
 * the fire-safety tile is served by the existing `fireSafety.overview`
 * procedure client-side, so its needs-attention logic stays in exactly
 * one place.
 */
import {
  actions,
  coshhAssessments,
  coshhSubstances,
  headsUpRecipients,
  headsUps,
  inspections,
  issues,
  permits,
  ramsBriefings,
  ramsPacks,
  ramsReviews,
  riskAssessments,
  scheduledInspectionOccurrences,
  sites,
} from '@forma360/db/schema';
import { and, count, eq, gte, inArray, isNull, lt, lte, ne, notInArray, sql } from 'drizzle-orm';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** Number of weekly buckets the trends surface returns (oldest first). */
export const TREND_WEEKS = 8;

export interface AnalyticsRouterDeps {
  /** Which brand-gated modules contribute dashboard tiles (ADR 0010). */
  modules: {
    riskAssessments: boolean;
    coshh: boolean;
    permits: boolean;
    rams: boolean;
  };
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/** Bucket a timestamp into one of the trailing weekly windows. */
function weekIndex(at: Date, windowStart: Date): number {
  return Math.floor((at.getTime() - windowStart.getTime()) / WEEK_MS);
}

export function createAnalyticsRouter(deps: AnalyticsRouterDeps) {
  const now = (): Date => deps.now?.() ?? new Date();

  const dashboard = tenantProcedure
    .use(requirePermission('analytics.view'))
    .query(async ({ ctx }) => {
      const at = now();
      const in7d = new Date(at.getTime() + 7 * DAY_MS);
      const in48h = new Date(at.getTime() + 2 * DAY_MS);
      const ago30d = new Date(at.getTime() - 30 * DAY_MS);

      const [actionCounts, myOpenActions, issueCounts, inspectionCounts, occurrenceCounts, myAcks] =
        await Promise.all([
          ctx.db
            .select({
              open: count(),
              overdue: count(
                sql`CASE WHEN ${actions.dueAt} IS NOT NULL AND ${actions.dueAt} < ${at} THEN 1 END`,
              ),
              dueSoon: count(
                sql`CASE WHEN ${actions.dueAt} IS NOT NULL AND ${actions.dueAt} >= ${at} AND ${actions.dueAt} <= ${in7d} THEN 1 END`,
              ),
            })
            .from(actions)
            .where(
              and(
                eq(actions.tenantId, ctx.tenantId),
                notInArray(actions.status, ['completed', 'cancelled']),
                isNull(actions.archivedAt),
              ),
            ),
          ctx.db
            .select({ n: count() })
            .from(actions)
            .where(
              and(
                eq(actions.tenantId, ctx.tenantId),
                notInArray(actions.status, ['completed', 'cancelled']),
                isNull(actions.archivedAt),
                eq(actions.assigneeUserId, ctx.auth.userId),
              ),
            ),
          ctx.db
            .select({
              open: count(),
              highPriority: count(
                sql`CASE WHEN ${issues.priority} IN ('high', 'critical') THEN 1 END`,
              ),
            })
            .from(issues)
            .where(
              and(
                eq(issues.tenantId, ctx.tenantId),
                ne(issues.status, 'closed'),
                isNull(issues.archivedAt),
              ),
            ),
          ctx.db
            .select({
              inProgress: count(sql`CASE WHEN ${inspections.status} = 'in_progress' THEN 1 END`),
              awaitingApproval: count(
                sql`CASE WHEN ${inspections.status} IN ('awaiting_approval', 'awaiting_signature_workflow') THEN 1 END`,
              ),
              completedLast30: count(
                sql`CASE WHEN ${inspections.status} = 'completed' AND ${inspections.completedAt} >= ${ago30d} THEN 1 END`,
              ),
            })
            .from(inspections)
            .where(and(eq(inspections.tenantId, ctx.tenantId), isNull(inspections.archivedAt))),
          ctx.db
            .select({
              missedLast30: count(
                sql`CASE WHEN ${scheduledInspectionOccurrences.status} = 'missed' AND ${scheduledInspectionOccurrences.occurrenceAt} >= ${ago30d} THEN 1 END`,
              ),
              upcoming7d: count(
                sql`CASE WHEN ${scheduledInspectionOccurrences.status} = 'pending' AND ${scheduledInspectionOccurrences.occurrenceAt} >= ${at} AND ${scheduledInspectionOccurrences.occurrenceAt} <= ${in7d} THEN 1 END`,
              ),
            })
            .from(scheduledInspectionOccurrences)
            .where(eq(scheduledInspectionOccurrences.tenantId, ctx.tenantId)),
          ctx.db
            .select({ n: count() })
            .from(headsUpRecipients)
            .innerJoin(headsUps, eq(headsUps.id, headsUpRecipients.headsUpId))
            .where(
              and(
                eq(headsUps.tenantId, ctx.tenantId),
                eq(headsUps.status, 'published'),
                eq(headsUps.requireAcknowledgement, true),
                eq(headsUpRecipients.userId, ctx.auth.userId),
                isNull(headsUpRecipients.acknowledgedAt),
              ),
            ),
        ]);

      // Brand-gated tiles — one aggregate each, only when the module ships.
      const [permitCounts, raCounts, coshhCounts, ramsCounts] = await Promise.all([
        deps.modules.permits
          ? ctx.db
              .select({
                open: count(),
                expiring48h: count(sql`CASE WHEN ${permits.validTo} <= ${in48h} THEN 1 END`),
              })
              .from(permits)
              .where(
                and(
                  eq(permits.tenantId, ctx.tenantId),
                  inArray(permits.status, ['issued', 'active', 'suspended']),
                ),
              )
          : Promise.resolve(null),
        deps.modules.riskAssessments
          ? ctx.db
              .select({
                active: count(),
                reviewOverdue: count(
                  sql`CASE WHEN ${riskAssessments.nextReviewAt} IS NOT NULL AND ${riskAssessments.nextReviewAt} <= ${at} THEN 1 END`,
                ),
              })
              .from(riskAssessments)
              .where(
                and(
                  eq(riskAssessments.tenantId, ctx.tenantId),
                  eq(riskAssessments.status, 'active'),
                ),
              )
          : Promise.resolve(null),
        deps.modules.coshh
          ? Promise.all([
              ctx.db
                .select({ n: count() })
                .from(coshhSubstances)
                .where(
                  and(
                    eq(coshhSubstances.tenantId, ctx.tenantId),
                    eq(coshhSubstances.status, 'active'),
                  ),
                ),
              ctx.db
                .select({ n: count() })
                .from(coshhAssessments)
                .where(
                  and(
                    eq(coshhAssessments.tenantId, ctx.tenantId),
                    eq(coshhAssessments.status, 'active'),
                    lte(coshhAssessments.nextReviewAt, at),
                  ),
                ),
            ])
          : Promise.resolve(null),
        // RAMS: live packs, and how many of those nobody has been briefed
        // on at their CURRENT version — the number that means work may be
        // about to start without a briefing.
        deps.modules.rams
          ? Promise.all([
              ctx.db
                .select({ n: count() })
                .from(ramsPacks)
                .where(
                  and(
                    eq(ramsPacks.tenantId, ctx.tenantId),
                    eq(ramsPacks.status, 'issued'),
                    isNull(ramsPacks.archivedAt),
                  ),
                ),
              ctx.db
                .select({ n: count() })
                .from(ramsPacks)
                .where(
                  and(
                    eq(ramsPacks.tenantId, ctx.tenantId),
                    eq(ramsPacks.status, 'issued'),
                    isNull(ramsPacks.archivedAt),
                    sql`NOT EXISTS (
                      SELECT 1 FROM ${ramsBriefings}
                      WHERE ${ramsBriefings.packId} = ${ramsPacks.id}
                        AND ${ramsBriefings.versionNumber} = ${ramsPacks.currentVersion}
                    )`,
                  ),
                ),
              ctx.db
                .select({ n: count() })
                .from(ramsReviews)
                .where(
                  and(eq(ramsReviews.tenantId, ctx.tenantId), eq(ramsReviews.outcome, 'pending')),
                ),
            ])
          : Promise.resolve(null),
      ]);

      return {
        actions: {
          open: actionCounts[0]?.open ?? 0,
          overdue: actionCounts[0]?.overdue ?? 0,
          dueSoon: actionCounts[0]?.dueSoon ?? 0,
          myOpen: myOpenActions[0]?.n ?? 0,
        },
        observations: {
          open: issueCounts[0]?.open ?? 0,
          highPriority: issueCounts[0]?.highPriority ?? 0,
        },
        inspections: {
          inProgress: inspectionCounts[0]?.inProgress ?? 0,
          awaitingApproval: inspectionCounts[0]?.awaitingApproval ?? 0,
          completedLast30: inspectionCounts[0]?.completedLast30 ?? 0,
        },
        schedule: {
          missedLast30: occurrenceCounts[0]?.missedLast30 ?? 0,
          upcoming7d: occurrenceCounts[0]?.upcoming7d ?? 0,
        },
        headsUp: { myPendingAcks: myAcks[0]?.n ?? 0 },
        permits:
          permitCounts === null
            ? null
            : {
                open: permitCounts[0]?.open ?? 0,
                expiring48h: permitCounts[0]?.expiring48h ?? 0,
              },
        riskAssessments:
          raCounts === null
            ? null
            : {
                active: raCounts[0]?.active ?? 0,
                reviewOverdue: raCounts[0]?.reviewOverdue ?? 0,
              },
        coshh:
          coshhCounts === null
            ? null
            : {
                substancesActive: coshhCounts[0][0]?.n ?? 0,
                assessmentsReviewOverdue: coshhCounts[1][0]?.n ?? 0,
              },
        rams:
          ramsCounts === null
            ? null
            : {
                issued: ramsCounts[0][0]?.n ?? 0,
                awaitingBriefing: ramsCounts[1][0]?.n ?? 0,
                reviewsPending: ramsCounts[2][0]?.n ?? 0,
              },
      };
    });

  const trends = tenantProcedure.use(requirePermission('analytics.view')).query(async ({ ctx }) => {
    const at = now();
    // Window starts at the top of the week TREND_WEEKS-1 weeks back so the
    // newest bucket is the current (partial) week.
    const windowStart = new Date(at.getTime() - (TREND_WEEKS - 1) * WEEK_MS);

    const [actionRows, inspectionRows, issueRows] = await Promise.all([
      ctx.db
        .select({
          createdAt: actions.createdAt,
          status: actions.status,
          closedAt: actions.closedAt,
        })
        .from(actions)
        .where(
          and(
            eq(actions.tenantId, ctx.tenantId),
            isNull(actions.archivedAt),
            gte(actions.createdAt, windowStart),
          ),
        ),
      ctx.db
        .select({ completedAt: inspections.completedAt })
        .from(inspections)
        .where(
          and(
            eq(inspections.tenantId, ctx.tenantId),
            eq(inspections.status, 'completed'),
            isNull(inspections.archivedAt),
            gte(inspections.completedAt, windowStart),
          ),
        ),
      ctx.db
        .select({ createdAt: issues.createdAt })
        .from(issues)
        .where(
          and(
            eq(issues.tenantId, ctx.tenantId),
            isNull(issues.archivedAt),
            gte(issues.createdAt, windowStart),
          ),
        ),
    ]);

    // Completed actions can predate the window on createdAt — fetch those
    // separately so completions in-window are counted regardless of age.
    const completedInWindow = await ctx.db
      .select({ closedAt: actions.closedAt })
      .from(actions)
      .where(
        and(
          eq(actions.tenantId, ctx.tenantId),
          isNull(actions.archivedAt),
          eq(actions.status, 'completed'),
          gte(actions.closedAt, windowStart),
          lt(actions.createdAt, windowStart),
        ),
      );

    const empty = (): number[] => Array.from({ length: TREND_WEEKS }, () => 0);
    const actionsCreated = empty();
    const actionsCompleted = empty();
    const inspectionsCompleted = empty();
    const observationsRaised = empty();
    const bump = (arr: number[], atDate: Date | null): void => {
      if (atDate === null) return;
      const i = weekIndex(atDate, windowStart);
      if (i >= 0 && i < TREND_WEEKS) arr[i] = (arr[i] ?? 0) + 1;
    };
    for (const r of actionRows) {
      bump(actionsCreated, r.createdAt);
      if (r.status === 'completed') bump(actionsCompleted, r.closedAt);
    }
    for (const r of completedInWindow) bump(actionsCompleted, r.closedAt);
    for (const r of inspectionRows) bump(inspectionsCompleted, r.completedAt);
    for (const r of issueRows) bump(observationsRaised, r.createdAt);

    return {
      windowStart,
      weeks: TREND_WEEKS,
      actionsCreated,
      actionsCompleted,
      inspectionsCompleted,
      observationsRaised,
    };
  });

  const siteComparison = tenantProcedure
    .use(requirePermission('analytics.view'))
    .query(async ({ ctx }) => {
      const at = now();
      const ago30d = new Date(at.getTime() - 30 * DAY_MS);

      const [siteRows, actionRows, issueRows, inspectionRows] = await Promise.all([
        ctx.db
          .select({ id: sites.id, name: sites.name })
          .from(sites)
          .where(and(eq(sites.tenantId, ctx.tenantId), isNull(sites.archivedAt))),
        ctx.db
          .select({ siteId: actions.siteId, n: count() })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, ctx.tenantId),
              notInArray(actions.status, ['completed', 'cancelled']),
              isNull(actions.archivedAt),
            ),
          )
          .groupBy(actions.siteId),
        ctx.db
          .select({ siteId: issues.siteId, n: count() })
          .from(issues)
          .where(
            and(
              eq(issues.tenantId, ctx.tenantId),
              ne(issues.status, 'closed'),
              isNull(issues.archivedAt),
            ),
          )
          .groupBy(issues.siteId),
        ctx.db
          .select({ siteId: inspections.siteId, n: count() })
          .from(inspections)
          .where(
            and(
              eq(inspections.tenantId, ctx.tenantId),
              eq(inspections.status, 'completed'),
              isNull(inspections.archivedAt),
              gte(inspections.completedAt, ago30d),
            ),
          )
          .groupBy(inspections.siteId),
      ]);

      const openActionsBySite = new Map(actionRows.map((r) => [r.siteId, r.n]));
      const openIssuesBySite = new Map(issueRows.map((r) => [r.siteId, r.n]));
      const completedBySite = new Map(inspectionRows.map((r) => [r.siteId, r.n]));

      const rows = siteRows
        .map((s) => ({
          siteId: s.id,
          siteName: s.name,
          openActions: openActionsBySite.get(s.id) ?? 0,
          openObservations: openIssuesBySite.get(s.id) ?? 0,
          inspectionsCompleted30d: completedBySite.get(s.id) ?? 0,
        }))
        .sort(
          (a, b) =>
            b.openActions + b.openObservations - (a.openActions + a.openObservations) ||
            a.siteName.localeCompare(b.siteName),
        );

      // Anything not attributed to a site rolls into one "no site" row so the
      // table's totals reconcile with the tiles above it.
      const unattributed = {
        openActions: openActionsBySite.get(null) ?? 0,
        openObservations: openIssuesBySite.get(null) ?? 0,
        inspectionsCompleted30d: completedBySite.get(null) ?? 0,
      };

      return { rows, unattributed };
    });

  return router({ dashboard, trends, siteComparison });
}
