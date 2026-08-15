/**
 * Sites admin router.
 *
 * Covers:
 *   - list (view)                         — tenant-scoped tree export.
 *   - create / update / archive (manage)  — with depth limits (G-E07).
 *   - move (manage, G-17)                 — change parent, recompute depth
 *                                           + path for the subtree
 *                                           (application-code hierarchy
 *                                           maintenance per sites.ts
 *                                           header note).
 *   - addMember / removeMember (manage)   — G-E10: refused in rule_based
 *                                           mode.
 *   - matrix (view)                       — sparse (userId, siteId) edge
 *                                           list; the UI virtualises.
 *   - setRules (manage)                   — same shape as groups.setRules.
 *
 * Limits:
 *   - depth ≤ 5 (6 levels total, 0–5). G-E07 enforced at router layer.
 *   - ≤ 50,000 sites per tenant — checked at create.
 */
import {
  actions,
  assets,
  contractorVisits,
  documents,
  groupMembers,
  groups,
  inspections,
  issues,
  siteGroups,
  siteMedia,
  siteMembers,
  siteMembershipRules,
  sitePlanPins,
  sitePlans,
  sites,
  templateSchedules,
  user,
} from '@forma360/db/schema';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { validateRuleConditions } from '@forma360/permissions/rules';
import { newId } from '@forma360/shared/id';
import { isValidTimeZone } from '@forma360/shared/timezone';
import { TRPCError } from '@trpc/server';
import { and, count, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { boundedRecord } from '../bounded-json';
import { requirePermission, tenantProcedure } from '../procedures';
import { assertUsersInTenant } from '../tenant-guards';
import { router } from '../trpc';
import { invalidateAccessRulesReferencing } from './accessRules';

const MAX_DEPTH = 5;
const MAX_SITES_PER_TENANT = 50_000;
const MAX_RULES_PER_SITE = 5;

// ─── Dependents resolver ───────────────────────────────────────────────────

const sitesResolver: DependentResolver = async (deps, input) => {
  if (input.entity !== 'site') return 0;
  const rows = await deps.db
    .select({ c: count() })
    .from(siteMembers)
    .where(and(eq(siteMembers.tenantId, input.tenantId), eq(siteMembers.siteId, input.id)));
  return Number(rows[0]?.c ?? 0);
};
registerDependentResolver('sites', sitesResolver);

// ─── Path helpers ──────────────────────────────────────────────────────────
// `path` is a dot-separated materialised list of ancestor ids. Root rows
// store "". A site at `A.B.C` stores `A.B` (root first, nearest ancestor
// last). The full `path || '.' || id` finds every descendant.

function buildPath(parentPath: string, parentId: string): string {
  return parentPath.length === 0 ? parentId : `${parentPath}.${parentId}`;
}

// ─── Zod schemas ───────────────────────────────────────────────────────────

const conditionSchema = z.object({
  fieldId: z.string().min(1),
  operator: z.string().min(1),
  value: z.unknown(),
});

const ruleSchema = z.object({
  order: z.number().int().min(0).max(999).default(0),
  conditions: z.array(conditionSchema).max(50),
});

// ─── Router ────────────────────────────────────────────────────────────────

export const sitesRouter = router({
  list: tenantProcedure.use(requirePermission('sites.view')).query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: sites.id,
        name: sites.name,
        parentId: sites.parentId,
        depth: sites.depth,
        path: sites.path,
        membershipMode: sites.membershipMode,
        archivedAt: sites.archivedAt,
        kind: sites.kind,
        status: sites.status,
        client: sites.client,
        startDate: sites.startDate,
        endDate: sites.endDate,
      })
      .from(sites)
      .where(and(eq(sites.tenantId, ctx.tenantId), isNull(sites.archivedAt)))
      .orderBy(sites.path, sites.name);
    return rows;
  }),

  /**
   * Lightweight site list for use inside inspection conduct.
   * Does NOT require `sites.view` — any authenticated tenant member conducting
   * an inspection can fetch the tenant's site tree so they can answer a
   * site-picker question. Returns only the fields needed to render the picker.
   */
  listForConductor: tenantProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: sites.id,
        name: sites.name,
        kind: sites.kind,
        parentId: sites.parentId,
        depth: sites.depth,
        path: sites.path,
      })
      .from(sites)
      .where(and(eq(sites.tenantId, ctx.tenantId), isNull(sites.archivedAt)))
      .orderBy(sites.path, sites.name);
    return rows;
  }),

  /**
   * Operational hub list: every site/project (active AND archived, so the
   * page can offer an "Archived" tab) with the roll-ups a project manager
   * scans at a glance — member count plus open-observation and open-action
   * counts for a quick health read. `archivedAt` lets the client split the
   * two tabs from a single fetch and offer restore.
   */
  hub: tenantProcedure.use(requirePermission('sites.view')).query(async ({ ctx }) => {
    const tid = ctx.tenantId;
    const siteRows = await ctx.db
      .select({
        id: sites.id,
        name: sites.name,
        parentId: sites.parentId,
        kind: sites.kind,
        status: sites.status,
        client: sites.client,
        startDate: sites.startDate,
        endDate: sites.endDate,
        archivedAt: sites.archivedAt,
        updatedAt: sites.updatedAt,
      })
      .from(sites)
      .where(eq(sites.tenantId, tid))
      .orderBy(sites.name);

    const memberRows = await ctx.db
      .select({ siteId: siteMembers.siteId, c: count() })
      .from(siteMembers)
      .where(eq(siteMembers.tenantId, tid))
      .groupBy(siteMembers.siteId);
    const memberMap = new Map(memberRows.map((r) => [r.siteId, Number(r.c)]));

    // Open observations (issues) per site — anything not yet closed.
    const obsRows = await ctx.db
      .select({ siteId: issues.siteId, c: count() })
      .from(issues)
      .where(and(eq(issues.tenantId, tid), isNull(issues.archivedAt), ne(issues.status, 'closed')))
      .groupBy(issues.siteId);
    const obsMap = new Map(obsRows.map((r) => [r.siteId, Number(r.c)]));

    // Open actions per site — anything not in a terminal state.
    const actRows = await ctx.db
      .select({ siteId: actions.siteId, c: count() })
      .from(actions)
      .where(
        and(
          eq(actions.tenantId, tid),
          isNull(actions.archivedAt),
          notInArray(actions.status, ['completed', 'cancelled']),
        ),
      )
      .groupBy(actions.siteId);
    const actMap = new Map(actRows.map((r) => [r.siteId, Number(r.c)]));

    // Resolve parent names in-memory — the hub already fetches every site,
    // so the hierarchy line on cards costs no extra query.
    const nameById = new Map(siteRows.map((s) => [s.id, s.name]));

    return siteRows.map((s) => ({
      ...s,
      parentName: s.parentId !== null ? (nameById.get(s.parentId) ?? null) : null,
      memberCount: memberMap.get(s.id) ?? 0,
      openObservations: obsMap.get(s.id) ?? 0,
      openActions: actMap.get(s.id) ?? 0,
    }));
  }),

  /**
   * Bring a site/project back from the archive. Un-archives the site row and,
   * for a `delete`-mode archive, precisely restores the records that were
   * archived in the same action (matched on the site's `archivedAt` stamp) so
   * things independently archived earlier stay archived. Dissociated records
   * were unlinked (not archived), so they are simply not re-attached.
   */
  restore: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.tenantId;
      const sid = input.id;
      const row = await ctx.db
        .select({ archivedAt: sites.archivedAt })
        .from(sites)
        .where(and(eq(sites.tenantId, tid), eq(sites.id, sid)))
        .limit(1);
      const existing = row[0];
      if (existing === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      const stamp = existing.archivedAt;
      if (stamp === null) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not archived' });

      const now = new Date();
      const restoreWhere = (
        table: typeof issues | typeof inspections | typeof actions | typeof assets,
      ) =>
        ctx.db
          .update(table)
          .set({ archivedAt: null })
          .where(and(eq(table.tenantId, tid), eq(table.siteId, sid), eq(table.archivedAt, stamp)));
      await restoreWhere(issues);
      await restoreWhere(inspections);
      await restoreWhere(actions);
      await restoreWhere(assets);
      await ctx.db
        .update(documents)
        .set({ archivedAt: null })
        .where(
          and(
            eq(documents.tenantId, tid),
            eq(documents.siteId, sid),
            eq(documents.archivedAt, stamp),
          ),
        );
      await ctx.db
        .update(siteMedia)
        .set({ archivedAt: null })
        .where(
          and(
            eq(siteMedia.tenantId, tid),
            eq(siteMedia.siteId, sid),
            eq(siteMedia.archivedAt, stamp),
          ),
        );
      await ctx.db
        .update(sitePlans)
        .set({ archivedAt: null })
        .where(
          and(
            eq(sitePlans.tenantId, tid),
            eq(sitePlans.siteId, sid),
            eq(sitePlans.archivedAt, stamp),
          ),
        );
      await ctx.db
        .update(sitePlanPins)
        .set({ archivedAt: null })
        .where(
          and(
            eq(sitePlanPins.tenantId, tid),
            eq(sitePlanPins.siteId, sid),
            eq(sitePlanPins.archivedAt, stamp),
          ),
        );

      await ctx.db
        .update(sites)
        .set({ archivedAt: null, updatedAt: now })
        .where(and(eq(sites.tenantId, tid), eq(sites.id, sid)));
      ctx.logger.info({ siteId: sid }, '[sites] restored from archive');
      return { ok: true as const };
    }),

  /**
   * Single site/project detail + rolled-up counts of everything attached to
   * it, for the hub detail (Overview tab).
   */
  getHub: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)))
        .limit(1);
      const site = rows[0];
      if (site === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

      const tid = ctx.tenantId;
      const [
        observations,
        actionCount,
        assetCount,
        documentCount,
        inspectionCount,
        members,
        mediaCount,
        planCount,
        scheduleCount,
        parentRow,
      ] = await Promise.all([
        ctx.db
          .select({ c: count() })
          .from(issues)
          .where(
            and(eq(issues.tenantId, tid), eq(issues.siteId, input.id), isNull(issues.archivedAt)),
          )
          .then((r) => Number(r[0]?.c ?? 0)),
        ctx.db
          .select({ c: count() })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, tid),
              eq(actions.siteId, input.id),
              isNull(actions.archivedAt),
            ),
          )
          .then((r) => Number(r[0]?.c ?? 0)),
        ctx.db
          .select({ c: count() })
          .from(assets)
          .where(
            and(eq(assets.tenantId, tid), eq(assets.siteId, input.id), isNull(assets.archivedAt)),
          )
          .then((r) => Number(r[0]?.c ?? 0)),
        ctx.db
          .select({ c: count() })
          .from(documents)
          .where(
            and(
              eq(documents.tenantId, tid),
              eq(documents.siteId, input.id),
              isNull(documents.archivedAt),
            ),
          )
          .then((r) => Number(r[0]?.c ?? 0)),
        ctx.db
          .select({ c: count() })
          .from(inspections)
          .where(
            and(
              eq(inspections.tenantId, tid),
              eq(inspections.siteId, input.id),
              isNull(inspections.archivedAt),
            ),
          )
          .then((r) => Number(r[0]?.c ?? 0)),
        ctx.db
          .select({ c: count() })
          .from(siteMembers)
          .where(and(eq(siteMembers.tenantId, tid), eq(siteMembers.siteId, input.id)))
          .then((r) => Number(r[0]?.c ?? 0)),
        ctx.db
          .select({ c: count() })
          .from(siteMedia)
          .where(
            and(
              eq(siteMedia.tenantId, tid),
              eq(siteMedia.siteId, input.id),
              isNull(siteMedia.archivedAt),
            ),
          )
          .then((r) => Number(r[0]?.c ?? 0)),
        ctx.db
          .select({ c: count() })
          .from(sitePlans)
          .where(
            and(
              eq(sitePlans.tenantId, tid),
              eq(sitePlans.siteId, input.id),
              isNull(sitePlans.archivedAt),
            ),
          )
          .then((r) => Number(r[0]?.c ?? 0)),
        // Schedules targeting this site — siteIds is a jsonb id array.
        ctx.db
          .select({ c: count() })
          .from(templateSchedules)
          .where(
            and(
              eq(templateSchedules.tenantId, tid),
              sql`${templateSchedules.siteIds} @> ${JSON.stringify([input.id])}::jsonb`,
            ),
          )
          .then((r) => Number(r[0]?.c ?? 0)),
        // Parent (for the detail breadcrumb) — null for root sites.
        site.parentId !== null
          ? ctx.db
              .select({ id: sites.id, name: sites.name })
              .from(sites)
              .where(and(eq(sites.tenantId, tid), eq(sites.id, site.parentId)))
              .limit(1)
              .then((r) => r[0] ?? null)
          : Promise.resolve(null),
      ]);

      return {
        site,
        parent: parentRow,
        counts: {
          observations,
          actions: actionCount,
          assets: assetCount,
          documents: documentCount,
          inspections: inspectionCount,
          members,
          media: mediaCount,
          plans: planCount,
          schedules: scheduleCount,
        },
      };
    }),

  create: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(
      z.object({
        name: z.string().min(1).max(120),
        parentId: z.string().length(26).nullable().optional(),
        membershipMode: z.enum(['manual', 'rule_based']).default('manual'),
        metadata: boundedRecord.optional(),
        // Sites/Projects lifecycle (projects only; sites leave these null).
        kind: z.enum(['site', 'project']).default('site'),
        status: z.enum(['planning', 'active', 'on_hold', 'completed']).nullable().optional(),
        client: z.string().max(200).nullable().optional(),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Tenant-scale cap (Module 9 spec).
      const tenantCount = await ctx.db
        .select({ c: count() })
        .from(sites)
        .where(eq(sites.tenantId, ctx.tenantId));
      if (Number(tenantCount[0]?.c ?? 0) >= MAX_SITES_PER_TENANT) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Site cap reached (${MAX_SITES_PER_TENANT}).`,
        });
      }

      let depth = 0;
      let path = '';
      if (input.parentId != null) {
        const parent = await ctx.db
          .select()
          .from(sites)
          .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.parentId)))
          .limit(1);
        if (parent[0] === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Parent site not found' });
        }
        depth = parent[0].depth + 1;
        if (depth > MAX_DEPTH) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Max hierarchy depth is ${MAX_DEPTH + 1} (6 levels, 0-indexed).`,
          });
        }
        path = buildPath(parent[0].path, parent[0].id);
      }

      const id = newId();
      await ctx.db.insert(sites).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        parentId: input.parentId ?? null,
        depth,
        path,
        membershipMode: input.membershipMode,
        metadata: input.metadata ?? {},
        kind: input.kind,
        status: input.status ?? (input.kind === 'project' ? 'active' : null),
        client: input.client ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
      });
      return { id };
    }),

  update: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(
      z.object({
        id: z.string().length(26),
        name: z.string().min(1).max(120).optional(),
        membershipMode: z.enum(['manual', 'rule_based']).optional(),
        metadata: boundedRecord.optional(),
        kind: z.enum(['site', 'project']).optional(),
        status: z.enum(['planning', 'active', 'on_hold', 'completed']).nullable().optional(),
        client: z.string().max(200).nullable().optional(),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        latitude: z.number().min(-90).max(90).nullable().optional(),
        longitude: z.number().min(-180).max(180).nullable().optional(),
        locationAddress: z.string().max(500).nullable().optional(),
        /**
         * BUG-14 (per-site): the clock this site's printed documents are
         * stamped in. Null / empty clears it back to the tenant default.
         *
         * Validated here, not just in the UI: ICU accepts bare
         * abbreviations and resolves them to something nobody means — `BST`
         * is Bangladesh Standard Time — so a permit stamped with an
         * unchecked string can print six hours out.
         */
        timezone: z
          .string()
          .max(64)
          .nullable()
          .optional()
          .refine((v) => v === null || v === undefined || v === '' || isValidTimeZone(v), {
            message: 'invalid-timezone',
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Partial<typeof sites.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.membershipMode !== undefined) updates.membershipMode = input.membershipMode;
      if (input.metadata !== undefined) updates.metadata = input.metadata;
      if (input.kind !== undefined) updates.kind = input.kind;
      if (input.status !== undefined) updates.status = input.status;
      if (input.client !== undefined) updates.client = input.client;
      if (input.startDate !== undefined) updates.startDate = input.startDate;
      if (input.endDate !== undefined) updates.endDate = input.endDate;
      if (input.latitude !== undefined) updates.latitude = input.latitude;
      if (input.longitude !== undefined) updates.longitude = input.longitude;
      if (input.locationAddress !== undefined) updates.locationAddress = input.locationAddress;
      if (input.timezone !== undefined) {
        updates.timezone = input.timezone === '' ? null : input.timezone;
      }
      await ctx.db
        .update(sites)
        .set(updates)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)));
      return { ok: true as const };
    }),

  archive: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(sites)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)));
      // G-E06: invalidate every access rule referencing this site.
      const invalidated = await invalidateAccessRulesReferencing(
        ctx.db,
        ctx.tenantId,
        'site',
        input.id,
      );
      ctx.logger.info(
        { siteId: input.id, invalidatedAccessRules: invalidated },
        '[sites] archived',
      );
      return { ok: true as const, invalidatedAccessRules: invalidated };
    }),

  /**
   * Archive a site/project, choosing what happens to attached records:
   *   - 'dissociate' — unlink cross-module records (observations, inspections,
   *     actions, assets, documents lose their site link but stay active in
   *     their own modules). Site-native content (media, plans, members) stays
   *     with the archived project. Nothing is destroyed.
   *   - 'delete' — also remove everything attached: cross-module records are
   *     archived, the project's media / plans / pins are archived, and
   *     memberships are dropped.
   * The site itself is soft-archived either way (sites are never hard-deleted).
   */
  archiveWithMode: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ id: z.string().length(26), mode: z.enum(['dissociate', 'delete']) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.tenantId;
      const sid = input.id;
      const now = new Date();
      const exists = await ctx.db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.tenantId, tid), eq(sites.id, sid)))
        .limit(1);
      if (exists[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

      // Refuse to archive a non-leaf: an active child would keep its
      // parentId/path pointing at a now-hidden ancestor (sites.list filters
      // out archived rows), leaving an orphaned active subtree. Make the user
      // archive or move the sub-sites first — mirrors the move (G-17) flow.
      const activeChild = await ctx.db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.tenantId, tid), eq(sites.parentId, sid), isNull(sites.archivedAt)))
        .limit(1);
      if (activeChild[0] !== undefined) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This site has active sub-sites. Archive or move its sub-sites first.',
        });
      }

      if (input.mode === 'dissociate') {
        await ctx.db
          .update(issues)
          .set({ siteId: null })
          .where(and(eq(issues.tenantId, tid), eq(issues.siteId, sid)));
        await ctx.db
          .update(inspections)
          .set({ siteId: null })
          .where(and(eq(inspections.tenantId, tid), eq(inspections.siteId, sid)));
        await ctx.db
          .update(actions)
          .set({ siteId: null })
          .where(and(eq(actions.tenantId, tid), eq(actions.siteId, sid)));
        await ctx.db
          .update(assets)
          .set({ siteId: null })
          .where(and(eq(assets.tenantId, tid), eq(assets.siteId, sid)));
        await ctx.db
          .update(documents)
          .set({ siteId: null })
          .where(and(eq(documents.tenantId, tid), eq(documents.siteId, sid)));
      } else {
        await ctx.db
          .update(issues)
          .set({ archivedAt: now })
          .where(and(eq(issues.tenantId, tid), eq(issues.siteId, sid), isNull(issues.archivedAt)));
        await ctx.db
          .update(inspections)
          .set({ archivedAt: now })
          .where(
            and(
              eq(inspections.tenantId, tid),
              eq(inspections.siteId, sid),
              isNull(inspections.archivedAt),
            ),
          );
        await ctx.db
          .update(actions)
          .set({ archivedAt: now })
          .where(
            and(eq(actions.tenantId, tid), eq(actions.siteId, sid), isNull(actions.archivedAt)),
          );
        await ctx.db
          .update(assets)
          .set({ archivedAt: now })
          .where(and(eq(assets.tenantId, tid), eq(assets.siteId, sid), isNull(assets.archivedAt)));
        await ctx.db
          .update(documents)
          .set({ archivedAt: now })
          .where(
            and(
              eq(documents.tenantId, tid),
              eq(documents.siteId, sid),
              isNull(documents.archivedAt),
            ),
          );
        await ctx.db
          .update(siteMedia)
          .set({ archivedAt: now })
          .where(
            and(
              eq(siteMedia.tenantId, tid),
              eq(siteMedia.siteId, sid),
              isNull(siteMedia.archivedAt),
            ),
          );
        await ctx.db
          .update(sitePlanPins)
          .set({ archivedAt: now })
          .where(
            and(
              eq(sitePlanPins.tenantId, tid),
              eq(sitePlanPins.siteId, sid),
              isNull(sitePlanPins.archivedAt),
            ),
          );
        await ctx.db
          .update(sitePlans)
          .set({ archivedAt: now })
          .where(
            and(
              eq(sitePlans.tenantId, tid),
              eq(sitePlans.siteId, sid),
              isNull(sitePlans.archivedAt),
            ),
          );
        await ctx.db
          .delete(siteMembers)
          .where(and(eq(siteMembers.tenantId, tid), eq(siteMembers.siteId, sid)));
      }

      // Both modes: stop schedules from targeting the archived site (drop the
      // id from the jsonb array) and unlink contractor visits (the visit log
      // belongs to the contractor, not the site).
      await ctx.db
        .update(templateSchedules)
        .set({ siteIds: sql`${templateSchedules.siteIds} - ${sid}`, updatedAt: now })
        .where(
          and(
            eq(templateSchedules.tenantId, tid),
            sql`${templateSchedules.siteIds} @> ${JSON.stringify([sid])}::jsonb`,
          ),
        );
      await ctx.db
        .update(contractorVisits)
        .set({ siteId: null })
        .where(and(eq(contractorVisits.tenantId, tid), eq(contractorVisits.siteId, sid)));

      await ctx.db
        .update(sites)
        .set({ archivedAt: now, updatedAt: now })
        .where(and(eq(sites.tenantId, tid), eq(sites.id, sid)));
      const invalidated = await invalidateAccessRulesReferencing(ctx.db, tid, 'site', sid);
      ctx.logger.info(
        { siteId: sid, mode: input.mode, invalidatedAccessRules: invalidated },
        '[sites] archived with mode',
      );
      return { ok: true as const, mode: input.mode };
    }),

  /**
   * G-17: move a site to a new parent. Re-computes `depth` + `path` for
   * the site AND every descendant. `parentId === null` promotes to root.
   */
  move: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(
      z.object({
        id: z.string().length(26),
        parentId: z.string().length(26).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [self] = await ctx.db
        .select()
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)))
        .limit(1);
      if (self === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (input.parentId === input.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot set a site as its own parent.',
        });
      }

      // Compute the new (depth, path) for the moved site.
      let newDepth = 0;
      let newPath = '';
      if (input.parentId !== null) {
        const [parent] = await ctx.db
          .select()
          .from(sites)
          .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.parentId)))
          .limit(1);
        if (parent === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'New parent site not found' });
        }
        // Reject moves that would make a site its own descendant.
        if (
          parent.path === self.id ||
          parent.path.startsWith(`${self.id}.`) ||
          parent.path.includes(`.${self.id}.`) ||
          parent.path.endsWith(`.${self.id}`)
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot move a site beneath its own descendant.',
          });
        }
        newDepth = parent.depth + 1;
        newPath = buildPath(parent.path, parent.id);
      }

      // Recompute for the subtree. Every descendant's new path is
      // newPath + self.id + descendant's path-suffix after the old subtree
      // root. Data stays linked by id (G-E09); only the hierarchy metadata
      // changes.
      const oldPrefix = buildPath(self.path, self.id); // old full path to self (inclusive)
      const newPrefix = buildPath(newPath, self.id);

      // Guard max depth for the deepest descendant.
      const deepest = await ctx.db
        .select({ d: sql<number>`max(${sites.depth})` })
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), sql`${sites.path} LIKE ${oldPrefix + '%'}`));
      const depthDelta = newDepth - self.depth;
      const deepestCurrent = Number(deepest[0]?.d ?? self.depth);
      if (deepestCurrent + depthDelta > MAX_DEPTH) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Move would exceed max depth (${MAX_DEPTH + 1} levels).`,
        });
      }

      await ctx.db.transaction(async (tx) => {
        // Update self.
        await tx
          .update(sites)
          .set({
            parentId: input.parentId,
            depth: newDepth,
            path: newPath,
            updatedAt: new Date(),
          })
          .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)));

        // Update descendants. Replace the prefix of their path + shift
        // depth by the delta. Cast the params to text so pglite's type
        // inference doesn't balk on the untyped bind parameters.
        await tx
          .update(sites)
          .set({
            depth: sql`${sites.depth} + ${depthDelta}`,
            path: sql`CONCAT(${newPrefix}::text, SUBSTR(${sites.path}, ${oldPrefix.length + 1}))`,
            updatedAt: new Date(),
          })
          .where(
            and(eq(sites.tenantId, ctx.tenantId), sql`${sites.path} LIKE ${oldPrefix + '.%'}`),
          );
      });

      return { ok: true as const };
    }),

  addMember: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ siteId: z.string().length(26), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.siteId)))
        .limit(1);
      if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      // Target user must belong to this tenant.
      await assertUsersInTenant(ctx.db, ctx.tenantId, [input.userId]);
      await ctx.db
        .insert(siteMembers)
        .values({
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          userId: input.userId,
          addedVia: 'manual',
        })
        .onConflictDoNothing();
      return { ok: true as const };
    }),

  removeMember: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ siteId: z.string().length(26), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.siteId)))
        .limit(1);
      if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db
        .delete(siteMembers)
        .where(
          and(
            eq(siteMembers.tenantId, ctx.tenantId),
            eq(siteMembers.siteId, input.siteId),
            eq(siteMembers.userId, input.userId),
          ),
        );
      return { ok: true as const };
    }),

  /** Bulk manual add — the Team & access multi-select. */
  addMembers: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(
      z.object({ siteId: z.string().length(26), userIds: z.array(z.string()).min(1).max(500) }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.siteId)))
        .limit(1);
      if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertUsersInTenant(ctx.db, ctx.tenantId, input.userIds);
      await ctx.db
        .insert(siteMembers)
        .values(
          input.userIds.map((userId) => ({
            tenantId: ctx.tenantId,
            siteId: input.siteId,
            userId,
            addedVia: 'manual',
          })),
        )
        .onConflictDoNothing();
      return { ok: true as const };
    }),

  /**
   * Assign a group to a site/project. The group's members become part of the
   * site's effective team (and gain its site-scoped access) via
   * `loadViewerMemberships`, kept in sync automatically as group membership
   * changes. Independent of the manual/rule_based direct-membership mode.
   */
  addGroup: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ siteId: z.string().length(26), groupId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const [s] = await ctx.db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.siteId)))
        .limit(1);
      if (s === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      const [g] = await ctx.db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.tenantId, ctx.tenantId), eq(groups.id, input.groupId)))
        .limit(1);
      if (g === undefined) throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });
      await ctx.db
        .insert(siteGroups)
        .values({ tenantId: ctx.tenantId, siteId: input.siteId, groupId: input.groupId })
        .onConflictDoNothing();
      return { ok: true as const };
    }),

  removeGroup: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ siteId: z.string().length(26), groupId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(siteGroups)
        .where(
          and(
            eq(siteGroups.tenantId, ctx.tenantId),
            eq(siteGroups.siteId, input.siteId),
            eq(siteGroups.groupId, input.groupId),
          ),
        );
      return { ok: true as const };
    }),

  /**
   * Everything the Team & access tab needs in one round-trip: the direct
   * members, the assigned groups (with member counts), and the deduped
   * effective roster (direct ∪ group members) with per-person provenance.
   */
  team: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(z.object({ siteId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const tid = ctx.tenantId;
      const sid = input.siteId;

      const directRows = await ctx.db
        .select({
          userId: siteMembers.userId,
          name: user.name,
          email: user.email,
          addedVia: siteMembers.addedVia,
        })
        .from(siteMembers)
        .innerJoin(user, and(eq(siteMembers.userId, user.id), eq(user.tenantId, tid)))
        .where(and(eq(siteMembers.tenantId, tid), eq(siteMembers.siteId, sid)))
        .orderBy(user.name);

      const groupRows = await ctx.db
        .select({ id: groups.id, name: groups.name })
        .from(siteGroups)
        .innerJoin(groups, and(eq(siteGroups.groupId, groups.id), isNull(groups.archivedAt)))
        .where(and(eq(siteGroups.tenantId, tid), eq(siteGroups.siteId, sid)))
        .orderBy(groups.name);
      const groupIds = groupRows.map((g) => g.id);

      const groupMemberRows =
        groupIds.length > 0
          ? await ctx.db
              .select({
                groupId: groupMembers.groupId,
                userId: groupMembers.userId,
                name: user.name,
                email: user.email,
              })
              .from(groupMembers)
              .innerJoin(user, and(eq(groupMembers.userId, user.id), eq(user.tenantId, tid)))
              .where(and(eq(groupMembers.tenantId, tid), inArray(groupMembers.groupId, groupIds)))
          : [];

      const countByGroup = new Map<string, number>();
      for (const r of groupMemberRows) {
        countByGroup.set(r.groupId, (countByGroup.get(r.groupId) ?? 0) + 1);
      }

      // Deduped effective roster with provenance.
      const eff = new Map<
        string,
        { userId: string; name: string; email: string; direct: boolean; viaGroupIds: string[] }
      >();
      for (const r of directRows) {
        eff.set(r.userId, {
          userId: r.userId,
          name: r.name,
          email: r.email,
          direct: true,
          viaGroupIds: [],
        });
      }
      for (const r of groupMemberRows) {
        const existing = eff.get(r.userId);
        if (existing !== undefined) {
          if (!existing.viaGroupIds.includes(r.groupId)) existing.viaGroupIds.push(r.groupId);
        } else {
          eff.set(r.userId, {
            userId: r.userId,
            name: r.name,
            email: r.email,
            direct: false,
            viaGroupIds: [r.groupId],
          });
        }
      }
      const effective = [...eff.values()].sort((a, b) => a.name.localeCompare(b.name));

      return {
        members: directRows,
        memberIds: directRows.map((r) => r.userId),
        groups: groupRows.map((g) => ({ ...g, memberCount: countByGroup.get(g.id) ?? 0 })),
        groupIds,
        effective,
      };
    }),

  /**
   * Sparse user × site edge list. The UI is responsible for virtualising;
   * this endpoint does NOT produce a dense matrix.
   */
  matrix: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(
      z.object({
        userIds: z.array(z.string()).max(500).optional(),
        siteIds: z.array(z.string().length(26)).max(500).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const whereParts = [eq(siteMembers.tenantId, ctx.tenantId)];
      if (input.userIds && input.userIds.length > 0) {
        whereParts.push(inArray(siteMembers.userId, input.userIds));
      }
      if (input.siteIds && input.siteIds.length > 0) {
        whereParts.push(inArray(siteMembers.siteId, input.siteIds));
      }
      const edges = await ctx.db
        .select({
          userId: siteMembers.userId,
          siteId: siteMembers.siteId,
          addedVia: siteMembers.addedVia,
        })
        .from(siteMembers)
        .where(and(...whereParts));
      return { edges };
    }),

  setRules: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(
      z.object({
        siteId: z.string().length(26),
        rules: z.array(ruleSchema).max(MAX_RULES_PER_SITE),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      for (const [i, rule] of input.rules.entries()) {
        const result = validateRuleConditions(rule.conditions as never);
        if (!result.ok) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Rule ${i + 1}: ${result.issues.map((x) => x.message).join(', ')}`,
          });
        }
      }

      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(siteMembershipRules)
          .where(
            and(
              eq(siteMembershipRules.tenantId, ctx.tenantId),
              eq(siteMembershipRules.siteId, input.siteId),
            ),
          );
        if (input.rules.length === 0) return;
        await tx.insert(siteMembershipRules).values(
          input.rules.map((rule, i) => ({
            id: newId(),
            tenantId: ctx.tenantId,
            siteId: input.siteId,
            order: rule.order !== undefined ? rule.order : i,
            conditions: rule.conditions as readonly {
              fieldId: string;
              operator: string;
              value: unknown;
            }[],
          })),
        );
      });
      // Enqueue site-membership-reconcile — mirrors group-reconcile.
      ctx.enqueue('forma360:site-membership-reconcile', {
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        actorId: ctx.auth.userId,
      });
      return { ok: true as const };
    }),
});

export { buildPath };
