/**
 * Global search router.
 *
 * `search.global` runs parallel ILIKE queries across the seven major
 * content types and returns grouped results — at most 5 hits per
 * category. Only non-archived records within the caller's tenant are
 * returned.
 *
 * Each category is additionally gated by the caller's module `.view`
 * permission (server is the source of truth — the search box must not
 * surface entities the module itself would hide). Documents further honour
 * per-document / per-folder visibility for non-managers.
 */
import { and, desc, eq, ilike, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  actions,
  assets,
  documentFolders,
  documents,
  headsUps,
  incidents,
  inspections,
  issues,
} from '@forma360/db/schema';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import type { PermissionKey } from '@forma360/permissions/catalogue';
import { tenantProcedure } from '../procedures';
import { router } from '../trpc';
import {
  loadViewerMemberships,
  makeFolderVisibilityChecker,
  ownVisibilityPasses,
} from './document-visibility';

const MAX_PER_CATEGORY = 5;

export const searchRouter = router({
  global: tenantProcedure
    .input(z.object({ query: z.string().min(2).max(100).trim() }))
    .query(async ({ ctx, input }) => {
      const q = `%${input.query}%`;
      const tid = ctx.tenantId;

      const perms = await loadUserPermissions(ctx.db, tid, ctx.auth.userId);
      const has = (p: PermissionKey): boolean => perms.includes(p);
      const empty = <T>(): Promise<T[]> => Promise.resolve([]);

      const [assetRows, inspectionRows, issueRows, actionRows, headsUpRows, documentRows, incidentRows] =
        await Promise.all([
          // Assets — search name
          has('assets.view')
            ? ctx.db
                .select({ id: assets.id, name: assets.name, description: assets.description })
                .from(assets)
                .where(
                  and(eq(assets.tenantId, tid), isNull(assets.archivedAt), ilike(assets.name, q)),
                )
                .orderBy(desc(assets.updatedAt))
                .limit(MAX_PER_CATEGORY)
            : empty<{ id: string; name: string; description: string | null }>(),

          // Inspections — search title and document number
          has('inspections.view')
            ? ctx.db
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
                    or(ilike(inspections.title, q), ilike(inspections.documentNumber, q)),
                  ),
                )
                .orderBy(desc(inspections.createdAt))
                .limit(MAX_PER_CATEGORY)
            : empty<{
                id: string;
                title: string;
                documentNumber: string | null;
                status: string;
              }>(),

          // Observations (issues) — search title and reference number
          has('issues.view')
            ? ctx.db
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
                    or(ilike(issues.title, q), ilike(issues.referenceNumber, q)),
                  ),
                )
                .orderBy(desc(issues.createdAt))
                .limit(MAX_PER_CATEGORY)
            : empty<{ id: string; title: string; referenceNumber: string; status: string }>(),

          // Actions — search title and reference number
          has('actions.view')
            ? ctx.db
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
                    or(ilike(actions.title, q), ilike(actions.referenceNumber, q)),
                  ),
                )
                .orderBy(desc(actions.createdAt))
                .limit(MAX_PER_CATEGORY)
            : empty<{
                id: string;
                title: string;
                referenceNumber: string | null;
                status: string;
              }>(),

          // Heads Up — search title and description, exclude archived
          has('headsUp.view')
            ? ctx.db
                .select({ id: headsUps.id, title: headsUps.title, status: headsUps.status })
                .from(headsUps)
                .where(
                  and(
                    eq(headsUps.tenantId, tid),
                    ne(headsUps.status, 'archived'),
                    or(ilike(headsUps.title, q), ilike(headsUps.description, q)),
                  ),
                )
                .orderBy(desc(headsUps.createdAt))
                .limit(MAX_PER_CATEGORY)
            : empty<{ id: string; title: string; status: string }>(),

          // Documents — search name and filename. Fetch a wider slice so the
          // post-visibility filter below can still surface up to 5 visible hits.
          has('documents.view')
            ? ctx.db
                .select({
                  id: documents.id,
                  name: documents.name,
                  filename: documents.filename,
                  folderId: documents.folderId,
                  visibleToGroupIds: documents.visibleToGroupIds,
                  visibleToSiteIds: documents.visibleToSiteIds,
                })
                .from(documents)
                .where(
                  and(
                    eq(documents.tenantId, tid),
                    isNull(documents.archivedAt),
                    or(ilike(documents.name, q), ilike(documents.filename, q)),
                  ),
                )
                .orderBy(desc(documents.updatedAt))
                .limit(MAX_PER_CATEGORY * 5)
            : empty<{
                id: string;
                name: string;
                filename: string;
                folderId: string | null;
                visibleToGroupIds: unknown;
                visibleToSiteIds: unknown;
              }>(),

          // Incidents — search title and reference. Confidential records
          // are excluded entirely for callers without the key (IN-E14:
          // counted on the register, never surfaced by search).
          has('incidents.view')
            ? ctx.db
                .select({
                  id: incidents.id,
                  title: incidents.title,
                  referenceNumber: incidents.referenceNumber,
                  status: incidents.status,
                  confidential: incidents.confidential,
                })
                .from(incidents)
                .where(
                  and(
                    eq(incidents.tenantId, tid),
                    ne(incidents.status, 'cancelled'),
                    has('incidents.confidential.view')
                      ? or(ilike(incidents.title, q), ilike(incidents.referenceNumber, q))
                      : and(
                          eq(incidents.confidential, false),
                          or(ilike(incidents.title, q), ilike(incidents.referenceNumber, q)),
                        ),
                  ),
                )
                .orderBy(desc(incidents.occurredAt))
                .limit(MAX_PER_CATEGORY)
            : empty<{
                id: string;
                title: string;
                referenceNumber: string;
                status: string;
                confidential: boolean;
              }>(),
        ]);

      // Apply per-document / per-folder visibility for non-managers (managers
      // see everything, mirroring documents.list).
      let visibleDocs = documentRows;
      if (documentRows.length > 0 && !perms.includes('documents.manage')) {
        const [viewer, allFolders] = await Promise.all([
          loadViewerMemberships(ctx.db, tid, ctx.auth.userId),
          ctx.db
            .select({
              id: documentFolders.id,
              parentId: documentFolders.parentId,
              visibleToGroupIds: documentFolders.visibleToGroupIds,
              visibleToSiteIds: documentFolders.visibleToSiteIds,
            })
            .from(documentFolders)
            .where(eq(documentFolders.tenantId, tid)),
        ]);
        const folderVisible = makeFolderVisibilityChecker(allFolders, viewer);
        visibleDocs = documentRows.filter(
          (d) =>
            ownVisibilityPasses(d.visibleToGroupIds, d.visibleToSiteIds, viewer) &&
            folderVisible(d.folderId),
        );
      }

      return {
        assets: assetRows.map((r) => ({
          id: r.id,
          title: r.name,
          subtitle: r.description !== null && r.description !== '' ? r.description : null,
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
        documents: visibleDocs.slice(0, MAX_PER_CATEGORY).map((r) => ({
          id: r.id,
          title: r.name,
          subtitle: r.filename,
        })),
        incidents: incidentRows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: r.referenceNumber,
        })),
      };
    }),
});
