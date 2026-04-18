/**
 * Exports router — Phase 2 PR 31.
 *
 * PDF / Word render triggers and public-share-link CRUD. The heavy
 * lifting lives in `@forma360/render`; this router is the
 * tenant-scoped permission boundary + DB layer.
 *
 *   - renderPdf (inspections.export)    — kicks a (cached) PDF render
 *     for an inspection, returns the R2 key.
 *   - renderDocx (inspections.export)   — same shape, Word output.
 *   - createShareLink (inspections.export) — mints a fresh opaque
 *     token + row in `public_inspection_links`, returns the public
 *     URL.
 *   - listShareLinks (inspections.view)  — list of live + revoked +
 *     expired links for the inspection.
 *   - revokeShareLink (inspections.export) — sets `revokedAt = now()`.
 */
import type { Database } from '@forma360/db/client';
import { inspections, publicInspectionLinks } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const inspectionIdInput = z.object({ inspectionId: z.string().length(26) });

const createShareLinkInput = z.object({
  inspectionId: z.string().length(26),
  /** Optional ISO datetime. When absent, the link never auto-expires. */
  expiresAt: z.string().datetime().optional(),
});

const revokeShareLinkInput = z.object({
  linkId: z.string().length(26),
});

/**
 * Shape of the injected render hooks. The web app wires these to the
 * real `@forma360/render` implementations + the shared Storage +
 * appUrl; tests hand in mocks that skip Puppeteer and in-memory
 * upload.
 */
export interface ExportsRouterDeps {
  renderPdf: (input: { tenantId: string; inspectionId: string }) => Promise<{
    key: string;
    bytes: number;
    stub: boolean;
  }>;
  renderDocx: (input: { tenantId: string; inspectionId: string }) => Promise<{
    key: string;
    bytes: number;
  }>;
  /** Mints a fresh base64url token. */
  generateShareToken: () => string;
  /** Builds the public URL from the APP_URL + token. */
  buildShareUrl: (token: string) => string;
}

/**
 * Build the router. Dependency injection keeps the tRPC handler
 * pure-ish — the tests pass deterministic mocks. The web app wires
 * real deps from `apps/web/src/server/exports-deps.ts`.
 */
export function createExportsRouter(deps: ExportsRouterDeps) {
  return router({
    renderPdf: tenantProcedure
      .use(requirePermission('inspections.export'))
      .input(inspectionIdInput)
      .mutation(async ({ ctx, input }) => {
        await requireInspection(ctx, input.inspectionId);
        const result = await deps.renderPdf({
          tenantId: ctx.tenantId,
          inspectionId: input.inspectionId,
        });
        return result;
      }),

    renderDocx: tenantProcedure
      .use(requirePermission('inspections.export'))
      .input(inspectionIdInput)
      .mutation(async ({ ctx, input }) => {
        await requireInspection(ctx, input.inspectionId);
        return deps.renderDocx({
          tenantId: ctx.tenantId,
          inspectionId: input.inspectionId,
        });
      }),

    createShareLink: tenantProcedure
      .use(requirePermission('inspections.export'))
      .input(createShareLinkInput)
      .mutation(async ({ ctx, input }) => {
        await requireInspection(ctx, input.inspectionId);
        const id = newId();
        const token = deps.generateShareToken();
        const expiresAt = input.expiresAt !== undefined ? new Date(input.expiresAt) : null;
        await ctx.db.insert(publicInspectionLinks).values({
          id,
          tenantId: ctx.tenantId,
          inspectionId: input.inspectionId,
          token,
          expiresAt,
          createdBy: ctx.auth.userId,
        });
        return {
          linkId: id,
          token,
          url: deps.buildShareUrl(token),
          expiresAt: expiresAt?.toISOString() ?? null,
        };
      }),

    listShareLinks: tenantProcedure
      .use(requirePermission('inspections.view'))
      .input(inspectionIdInput)
      .query(async ({ ctx, input }) => {
        await requireInspection(ctx, input.inspectionId);
        const rows = await ctx.db
          .select({
            linkId: publicInspectionLinks.id,
            token: publicInspectionLinks.token,
            expiresAt: publicInspectionLinks.expiresAt,
            revokedAt: publicInspectionLinks.revokedAt,
            createdBy: publicInspectionLinks.createdBy,
            createdAt: publicInspectionLinks.createdAt,
          })
          .from(publicInspectionLinks)
          .where(
            and(
              eq(publicInspectionLinks.tenantId, ctx.tenantId),
              eq(publicInspectionLinks.inspectionId, input.inspectionId),
            ),
          )
          .orderBy(desc(publicInspectionLinks.createdAt));
        return rows.map((r) => ({
          linkId: r.linkId,
          url: deps.buildShareUrl(r.token),
          expiresAt: r.expiresAt?.toISOString() ?? null,
          revokedAt: r.revokedAt?.toISOString() ?? null,
          createdBy: r.createdBy,
          createdAt: r.createdAt.toISOString(),
          revoked: r.revokedAt !== null,
          expired: r.expiresAt !== null && r.expiresAt.getTime() <= Date.now(),
        }));
      }),

    revokeShareLink: tenantProcedure
      .use(requirePermission('inspections.export'))
      .input(revokeShareLinkInput)
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        const updated = await ctx.db
          .update(publicInspectionLinks)
          .set({ revokedAt: now })
          .where(
            and(
              eq(publicInspectionLinks.tenantId, ctx.tenantId),
              eq(publicInspectionLinks.id, input.linkId),
            ),
          )
          .returning({ id: publicInspectionLinks.id });
        if (updated.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        return { linkId: input.linkId, revokedAt: now.toISOString() };
      }),
  });
}

/**
 * Narrow helper that throws `NOT_FOUND` unless the inspection exists
 * in the caller's tenant. Keeps every mutation's guard consistent.
 */
async function requireInspection(
  ctx: { db: Database; tenantId: string },
  inspectionId: string,
): Promise<void> {
  const rows = await ctx.db
    .select({ id: inspections.id })
    .from(inspections)
    .where(and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, inspectionId)))
    .limit(1);
  if (rows[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
}
