/**
 * Assets router — Phase 5B.
 *
 * Full CRUD on the asset register, plus readings.
 * Key edge cases:
 *   - AS-E01: can't archive a parent asset that has active sub-assets.
 *   - AS-E11: parentId must not itself have a parent (one-level depth only).
 *   - QR token: generated on create, unique across the tenant.
 */
import {
  actionAssets,
  actions,
  assetReadings,
  assetTypes,
  assets,
  inspectionAssetSelections,
  inspections,
  issueAssets,
  issues,
  sites,
  type Asset,
} from '@forma360/db/schema';
import { user } from '@forma360/db/schema';
import { randomBytes } from 'node:crypto';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import {
  assertAssetTypesInTenant,
  assertSitesInTenant,
  assertUsersInTenant,
} from '../tenant-guards';
import { router } from '../trpc';

type Db = Parameters<Parameters<typeof tenantProcedure.query>[0]>[0]['ctx']['db'];

const assetIdInput = z.object({ assetId: z.string().length(26) });

async function loadAssetOrThrow(db: Db, tenantId: string, assetId: string): Promise<Asset> {
  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.tenantId, tenantId), eq(assets.id, assetId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'asset-not-found' });
  }
  return row;
}

/** Generates a short random QR token (12 uppercase alphanumeric chars). */
function generateQrToken(): string {
  // CSPRNG, not Math.random — QR tokens are printed on physical assets and
  // must stay unguessable if a public "resolve by QR" endpoint is ever added.
  // Rejection sampling (bytes < 252 = 36*7) keeps the 36-char alphabet
  // perfectly uniform (no modulo bias).
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const out: string[] = [];
  while (out.length < 12) {
    for (const b of randomBytes(16)) {
      if (b < 252) {
        out.push(chars[b % 36] ?? 'A');
        if (out.length === 12) break;
      }
    }
  }
  return out.join('');
}

const createInput = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(2000).default(''),
  typeId: z.string().length(26).optional(),
  siteId: z.string().length(26).optional(),
  parentId: z.string().length(26).optional(),
  ownerUserId: z.string().length(26).optional(),
  photoKey: z.string().optional(),
  customFieldValues: z.record(z.string(), z.unknown()).default({}),
});

const updateInput = z.object({
  assetId: z.string().length(26),
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  typeId: z.string().length(26).nullable().optional(),
  siteId: z.string().length(26).nullable().optional(),
  parentId: z.string().length(26).nullable().optional(),
  ownerUserId: z.string().length(26).nullable().optional(),
  photoKey: z.string().nullable().optional(),
  customFieldValues: z.record(z.string(), z.unknown()).optional(),
});

const listInput = z
  .object({
    typeId: z.string().length(26).optional(),
    siteId: z.string().length(26).optional(),
    parentId: z.string().length(26).nullable().optional(),
    includeArchived: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .default({ includeArchived: false, limit: 200 });

const addReadingInput = z.object({
  assetId: z.string().length(26),
  fieldName: z.string().min(1).max(200),
  value: z.number(),
  unit: z.string().max(50).default(''),
  source: z.enum(['manual', 'telematics']).default('manual'),
  capturedAt: z.string().datetime().optional(),
});

const listReadingsInput = z.object({
  assetId: z.string().length(26),
  fieldName: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const assetsRouter = router({
  list: tenantProcedure
    .use(requirePermission('assets.view'))
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const where = [eq(assets.tenantId, ctx.tenantId)];
      if (input.typeId !== undefined) where.push(eq(assets.typeId, input.typeId));
      if (input.siteId !== undefined) where.push(eq(assets.siteId, input.siteId));
      if (input.parentId !== undefined) {
        if (input.parentId === null) where.push(isNull(assets.parentId));
        else where.push(eq(assets.parentId, input.parentId));
      }
      if (!input.includeArchived) where.push(isNull(assets.archivedAt));

      const rows = await ctx.db
        .select({
          id: assets.id,
          name: assets.name,
          typeId: assets.typeId,
          typeName: assetTypes.name,
          siteId: assets.siteId,
          siteName: sites.name,
          parentId: assets.parentId,
          qrToken: assets.qrToken,
          customFieldValues: assets.customFieldValues,
          photoKey: assets.photoKey,
          createdAt: assets.createdAt,
          updatedAt: assets.updatedAt,
          archivedAt: assets.archivedAt,
        })
        .from(assets)
        .leftJoin(assetTypes, eq(assetTypes.id, assets.typeId))
        .leftJoin(sites, eq(sites.id, assets.siteId))
        .where(and(...where))
        .orderBy(assets.name)
        .limit(input.limit);

      return rows;
    }),

  get: tenantProcedure
    .use(requirePermission('assets.view'))
    .input(assetIdInput)
    .query(async ({ ctx, input }) => {
      const asset = await loadAssetOrThrow(ctx.db, ctx.tenantId, input.assetId);

      const [typeRows, childrenCountRows, latestReadingsRows, siteRows, ownerRows] =
        await Promise.all([
          asset.typeId !== null
            ? ctx.db.select().from(assetTypes).where(eq(assetTypes.id, asset.typeId)).limit(1)
            : Promise.resolve([]),
          ctx.db
            .select({ c: count() })
            .from(assets)
            .where(
              and(
                eq(assets.tenantId, ctx.tenantId),
                eq(assets.parentId, asset.id),
                isNull(assets.archivedAt),
              ),
            ),
          ctx.db
            .select()
            .from(assetReadings)
            .where(eq(assetReadings.assetId, asset.id))
            .orderBy(desc(assetReadings.capturedAt))
            .limit(5),
          asset.siteId !== null
            ? ctx.db
                .select({ name: sites.name })
                .from(sites)
                .where(eq(sites.id, asset.siteId))
                .limit(1)
            : Promise.resolve([]),
          asset.ownerUserId !== null
            ? ctx.db
                .select({ name: user.name })
                .from(user)
                .where(eq(user.id, asset.ownerUserId))
                .limit(1)
            : Promise.resolve([]),
        ]);

      return {
        asset,
        assetType: typeRows[0] ?? null,
        siteName: siteRows[0]?.name ?? null,
        ownerName: ownerRows[0]?.name ?? null,
        childrenCount: Number(childrenCountRows[0]?.c ?? 0),
        latestReadings: latestReadingsRows,
      };
    }),

  create: tenantProcedure
    .use(requirePermission('assets.manage'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      // AS-E11: parentId must not itself have a parent (depth ≤ 1).
      if (input.parentId !== undefined) {
        const parent = await loadAssetOrThrow(ctx.db, ctx.tenantId, input.parentId);
        if (parent.parentId !== null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'asset-parent-depth-exceeded',
          });
        }
      }

      await assertAssetTypesInTenant(ctx.db, ctx.tenantId, [input.typeId]);
      await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
      await assertUsersInTenant(ctx.db, ctx.tenantId, [input.ownerUserId]);

      const id = newId();
      const now = new Date();
      // Generate a unique QR token — retry on collision (extremely unlikely).
      let qrToken = generateQrToken();
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await ctx.db
          .select({ id: assets.id })
          .from(assets)
          .where(eq(assets.qrToken, qrToken))
          .limit(1);
        if (existing.length === 0) break;
        qrToken = generateQrToken();
      }

      await ctx.db.insert(assets).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        typeId: input.typeId ?? null,
        siteId: input.siteId ?? null,
        parentId: input.parentId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        photoKey: input.photoKey ?? null,
        customFieldValues: input.customFieldValues,
        qrToken,
        createdAt: now,
        updatedAt: now,
      });
      return { assetId: id, qrToken };
    }),

  update: tenantProcedure
    .use(requirePermission('assets.manage'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetOrThrow(ctx.db, ctx.tenantId, input.assetId);
      if (asset.archivedAt !== null) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'asset-archived' });
      }

      // AS-E11: validate parentId depth.
      if (input.parentId !== undefined && input.parentId !== null) {
        if (input.parentId === input.assetId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'asset-self-parent' });
        }
        const parent = await loadAssetOrThrow(ctx.db, ctx.tenantId, input.parentId);
        if (parent.parentId !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'asset-parent-depth-exceeded' });
        }
      }

      await assertAssetTypesInTenant(ctx.db, ctx.tenantId, [input.typeId]);
      await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
      await assertUsersInTenant(ctx.db, ctx.tenantId, [input.ownerUserId]);

      const updates: Partial<typeof assets.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.typeId !== undefined) updates.typeId = input.typeId;
      if (input.siteId !== undefined) updates.siteId = input.siteId;
      if (input.parentId !== undefined) updates.parentId = input.parentId;
      if (input.ownerUserId !== undefined) updates.ownerUserId = input.ownerUserId;
      if (input.photoKey !== undefined) updates.photoKey = input.photoKey;
      if (input.customFieldValues !== undefined)
        updates.customFieldValues = input.customFieldValues;

      await ctx.db.update(assets).set(updates).where(eq(assets.id, asset.id));
      return { ok: true as const };
    }),

  /** AS-E01: refuse if the asset has active sub-assets. */
  archive: tenantProcedure
    .use(requirePermission('assets.manage'))
    .input(assetIdInput)
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetOrThrow(ctx.db, ctx.tenantId, input.assetId);
      if (asset.archivedAt !== null) return { ok: true as const };

      const childCount = await ctx.db
        .select({ c: count() })
        .from(assets)
        .where(
          and(
            eq(assets.tenantId, ctx.tenantId),
            eq(assets.parentId, asset.id),
            isNull(assets.archivedAt),
          ),
        );
      const children = Number(childCount[0]?.c ?? 0);
      if (children > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `asset-has-sub-assets:${children}`,
        });
      }

      await ctx.db
        .update(assets)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(assets.id, asset.id));
      return { ok: true as const };
    }),

  restore: tenantProcedure
    .use(requirePermission('assets.manage'))
    .input(assetIdInput)
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetOrThrow(ctx.db, ctx.tenantId, input.assetId);
      if (asset.archivedAt === null) return { ok: true as const };
      await ctx.db
        .update(assets)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(assets.id, asset.id));
      return { ok: true as const };
    }),

  listWithChildren: tenantProcedure.use(requirePermission('assets.view')).query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: assets.id,
        name: assets.name,
        parentId: assets.parentId,
        typeId: assets.typeId,
        typeName: assetTypes.name,
      })
      .from(assets)
      .leftJoin(assetTypes, eq(assetTypes.id, assets.typeId))
      .where(and(eq(assets.tenantId, ctx.tenantId), isNull(assets.archivedAt)))
      .orderBy(assets.name);

    const parents = rows.filter((r) => r.parentId === null);
    const childMap = new Map<string, typeof rows>();
    for (const r of rows) {
      if (r.parentId !== null) {
        const bucket = childMap.get(r.parentId) ?? [];
        bucket.push(r);
        childMap.set(r.parentId, bucket);
      }
    }
    return parents.map((p) => ({ ...p, children: childMap.get(p.id) ?? [] }));
  }),

  listLinkedInspections: tenantProcedure
    .use(requirePermission('assets.view'))
    .input(assetIdInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: inspections.id,
          title: inspections.title,
          status: inspections.status,
          documentNumber: inspections.documentNumber,
          startedAt: inspections.startedAt,
          completedAt: inspections.completedAt,
          questionId: inspectionAssetSelections.questionId,
        })
        .from(inspectionAssetSelections)
        .innerJoin(inspections, eq(inspections.id, inspectionAssetSelections.inspectionId))
        .where(
          and(
            eq(inspectionAssetSelections.tenantId, ctx.tenantId),
            eq(inspectionAssetSelections.assetId, input.assetId),
            isNull(inspections.archivedAt),
          ),
        )
        .orderBy(desc(inspections.startedAt))
        .limit(100);
      return rows;
    }),

  listLinkedActions: tenantProcedure
    .use(requirePermission('assets.view'))
    .input(assetIdInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: actions.id,
          title: actions.title,
          status: actions.status,
          priority: actions.priority,
          dueAt: actions.dueAt,
          createdAt: actions.createdAt,
          referenceNumber: actions.referenceNumber,
        })
        .from(actionAssets)
        .innerJoin(actions, eq(actions.id, actionAssets.actionId))
        .where(
          and(
            eq(actionAssets.tenantId, ctx.tenantId),
            eq(actionAssets.assetId, input.assetId),
            isNull(actions.archivedAt),
          ),
        )
        .orderBy(desc(actions.createdAt))
        .limit(100);
      return rows;
    }),

  listLinkedObservations: tenantProcedure
    .use(requirePermission('assets.view'))
    .input(assetIdInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: issues.id,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
          createdAt: issues.createdAt,
          referenceNumber: issues.referenceNumber,
        })
        .from(issueAssets)
        .innerJoin(issues, eq(issues.id, issueAssets.issueId))
        .where(
          and(
            eq(issueAssets.tenantId, ctx.tenantId),
            eq(issueAssets.assetId, input.assetId),
            isNull(issues.archivedAt),
          ),
        )
        .orderBy(desc(issues.createdAt))
        .limit(100);
      return rows;
    }),

  readings: router({
    add: tenantProcedure
      .use(requirePermission('assets.readings.record'))
      .input(addReadingInput)
      .mutation(async ({ ctx, input }) => {
        await loadAssetOrThrow(ctx.db, ctx.tenantId, input.assetId);
        const id = newId();
        await ctx.db.insert(assetReadings).values({
          id,
          tenantId: ctx.tenantId,
          assetId: input.assetId,
          fieldName: input.fieldName,
          value: String(input.value),
          unit: input.unit,
          source: input.source,
          capturedAt: input.capturedAt !== undefined ? new Date(input.capturedAt) : new Date(),
          capturedByUserId: ctx.auth.userId,
        });
        return { readingId: id };
      }),

    list: tenantProcedure
      .use(requirePermission('assets.view'))
      .input(listReadingsInput)
      .query(async ({ ctx, input }) => {
        await loadAssetOrThrow(ctx.db, ctx.tenantId, input.assetId);
        const where = [eq(assetReadings.assetId, input.assetId)];
        if (input.fieldName !== undefined) where.push(eq(assetReadings.fieldName, input.fieldName));

        const rows = await ctx.db
          .select({
            id: assetReadings.id,
            fieldName: assetReadings.fieldName,
            value: assetReadings.value,
            unit: assetReadings.unit,
            source: assetReadings.source,
            capturedAt: assetReadings.capturedAt,
            capturedByUserId: assetReadings.capturedByUserId,
            capturedByName: user.name,
          })
          .from(assetReadings)
          .leftJoin(user, eq(user.id, assetReadings.capturedByUserId))
          .where(and(...where))
          .orderBy(desc(assetReadings.capturedAt))
          .limit(input.limit);
        return rows;
      }),
  }),
});
