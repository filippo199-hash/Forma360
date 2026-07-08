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
  documents,
  inspections,
  issues,
  siteMedia,
  siteMembers,
  siteMembershipRules,
  sitePlanPins,
  sitePlans,
  sites,
} from '@forma360/db/schema';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { validateRuleConditions } from '@forma360/permissions/rules';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
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
   * Operational hub list: every non-archived site/project plus a member
   * count, for the top-level Sites/Projects page cards.
   */
  hub: tenantProcedure.use(requirePermission('sites.view')).query(async ({ ctx }) => {
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
      })
      .from(sites)
      .where(and(eq(sites.tenantId, ctx.tenantId), isNull(sites.archivedAt)))
      .orderBy(sites.name);

    const memberRows = await ctx.db
      .select({ siteId: siteMembers.siteId, c: count() })
      .from(siteMembers)
      .where(eq(siteMembers.tenantId, ctx.tenantId))
      .groupBy(siteMembers.siteId);
    const memberMap = new Map(memberRows.map((r) => [r.siteId, Number(r.c)]));

    return siteRows.map((s) => ({ ...s, memberCount: memberMap.get(s.id) ?? 0 }));
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
      ]);

      return {
        site,
        counts: {
          observations,
          actions: actionCount,
          assets: assetCount,
          documents: documentCount,
          inspections: inspectionCount,
          members,
          media: mediaCount,
          plans: planCount,
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
        metadata: z.record(z.unknown()).optional(),
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
        metadata: z.record(z.unknown()).optional(),
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
        .select()
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.siteId)))
        .limit(1);
      if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (row.membershipMode !== 'manual') {
        // G-E10
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Site is rule_based; manual membership edits are disabled.',
        });
      }
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
        .select()
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.siteId)))
        .limit(1);
      if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (row.membershipMode !== 'manual') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Site is rule_based; manual membership edits are disabled.',
        });
      }
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
