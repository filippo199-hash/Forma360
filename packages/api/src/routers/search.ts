/**
 * Global search router.
 *
 * `search.global` runs parallel ILIKE queries across the seven major
 * content types and returns grouped results — at most 5 hits per
 * category. Only non-archived records within the caller's tenant are
 * returned.
 */
import { and, desc, eq, ilike, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  actions,
  assets,
  documents,
  headsUps,
  inspections,
  issues,
} from '@forma360/db/schema';
import { tenantProcedure } from '../procedures';
import { router } from '../trpc';

const MAX_PER_CATEGORY = 5;

export const searchRouter = router({
  global: tenantProcedure
    .input(z.object({ query: z.string().min(2).max(100).trim() }))
    .query(async ({ ctx, input }) => {
      const q = `%${input.query}%`;
      const tid = ctx.tenantId;

      const [
        assetRows,
        inspectionRows,
        issueRows,
        actionRows,
        headsUpRows,
        documentRows,
      ] = await Promise.all([
        // Assets — search name
        ctx.db
          .select({
            id: assets.id,
            name: assets.name,
            description: assets.description,
          })
          .from(assets)
          .where(
            and(
              eq(assets.tenantId, tid),
              isNull(assets.archivedAt),
              ilike(assets.name, q),
            ),
          )
          .orderBy(desc(assets.updatedAt))
          .limit(MAX_PER_CATEGORY),

        // Inspections — search title and document number
        ctx.db
          .select({
            id: inspections.id,
            title: inspections.title,
            documentNumber: inspections.documentNumber,
            status: inspections.status,
          })
          .from(inspections)
          .where(
            and(
              eq(inspections.tenantId, tid),
              isNull(inspections.archivedAt),
              or(
                ilike(inspections.title, q),
                ilike(inspections.documentNumber, q),
              ),
            ),
          )
          .orderBy(desc(inspections.createdAt))
          .limit(MAX_PER_CATEGORY),

        // Observations (issues) — search title and reference number
        ctx.db
          .select({
            id: issues.id,
            title: issues.title,
            referenceNumber: issues.referenceNumber,
            status: issues.status,
          })
          .from(issues)
          .where(
            and(
              eq(issues.tenantId, tid),
              isNull(issues.archivedAt),
              or(
                ilike(issues.title, q),
                ilike(issues.referenceNumber, q),
              ),
            ),
          )
          .orderBy(desc(issues.createdAt))
          .limit(MAX_PER_CATEGORY),

        // Actions — search title and reference number
        ctx.db
          .select({
            id: actions.id,
            title: actions.title,
            referenceNumber: actions.referenceNumber,
            status: actions.status,
          })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, tid),
              isNull(actions.archivedAt),
              or(
                ilike(actions.title, q),
                ilike(actions.referenceNumber, q),
              ),
            ),
          )
          .orderBy(desc(actions.createdAt))
          .limit(MAX_PER_CATEGORY),

        // Heads Up — search title and description, exclude archived
        ctx.db
          .select({
            id: headsUps.id,
            title: headsUps.title,
            status: headsUps.status,
          })
          .from(headsUps)
          .where(
            and(
              eq(headsUps.tenantId, tid),
              ne(headsUps.status, 'archived'),
              or(
                ilike(headsUps.title, q),
                ilike(headsUps.description, q),
              ),
            ),
          )
          .orderBy(desc(headsUps.createdAt))
          .limit(MAX_PER_CATEGORY),

        // Documents — search name and filename
        ctx.db
          .select({
            id: documents.id,
            name: documents.name,
            filename: documents.filename,
          })
          .from(documents)
          .where(
            and(
              eq(documents.tenantId, tid),
              isNull(documents.archivedAt),
              or(
                ilike(documents.name, q),
                ilike(documents.filename, q),
              ),
            ),
          )
          .orderBy(desc(documents.updatedAt))
          .limit(MAX_PER_CATEGORY),
      ]);

      return {
        assets: assetRows.map((r) => ({
          id: r.id,
          title: r.name,
          subtitle: r.description !== '' ? r.description : null,
        })),
        inspections: inspectionRows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: r.documentNumber ?? r.status,
        })),
        observations: issueRows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: r.referenceNumber,
        })),
        actions: actionRows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: r.referenceNumber ?? r.status,
        })),
        headsUp: headsUpRows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: r.status,
        })),
        documents: documentRows.map((r) => ({
          id: r.id,
          title: r.name,
          subtitle: r.filename,
        })),
      };
    }),
});
