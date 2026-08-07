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
  contractors,
  coshhSubstances,
  documentFolders,
  documents,
  fireBuildings,
  fireRiskAssessments,
  headsUps,
  incidents,
  inspections,
  issues,
  permits,
  ramsPacks,
  riskAssessments,
  sites,
  templates,
  trainingRecords,
  user,
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

      // PF-6 (platform review): the box used to cover six entities and
      // none of the four brand modules, contractors, sites or templates —
      // "Cmd-K for PTW-0123 or acetone: nothing". Every module the nav
      // shows is now searchable, same permission gates as its pages.
      const [
        assetRows,
        inspectionRows,
        issueRows,
        actionRows,
        headsUpRows,
        documentRows,
        permitRows,
        coshhRows,
        raRows,
        fireBuildingRows,
        fraRows,
        contractorRows,
        siteRows,
        templateRows,
        incidentRows,
        ramsRows,
        trainingRows,
      ] = await Promise.all([
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
        // Permits — reference or title (the PTW-0123 case).
        has('permits.view')
          ? ctx.db
              .select({
                id: permits.id,
                title: permits.title,
                referenceNumber: permits.referenceNumber,
                status: permits.status,
              })
              .from(permits)
              .where(
                and(
                  eq(permits.tenantId, tid),
                  or(ilike(permits.title, q), ilike(permits.referenceNumber, q)),
                ),
              )
              .orderBy(desc(permits.updatedAt))
              .limit(MAX_PER_CATEGORY)
          : empty<{
              id: string;
              title: string;
              referenceNumber: string | null;
              status: string;
            }>(),
        // COSHH — substance name (the "acetone" case).
        has('coshh.view')
          ? ctx.db
              .select({ id: coshhSubstances.id, name: coshhSubstances.name })
              .from(coshhSubstances)
              .where(
                and(
                  eq(coshhSubstances.tenantId, tid),
                  isNull(coshhSubstances.archivedAt),
                  ilike(coshhSubstances.name, q),
                ),
              )
              .orderBy(desc(coshhSubstances.updatedAt))
              .limit(MAX_PER_CATEGORY)
          : empty<{ id: string; name: string }>(),
        // Risk assessments — reference or title.
        has('riskAssessments.view')
          ? ctx.db
              .select({
                id: riskAssessments.id,
                title: riskAssessments.title,
                referenceNumber: riskAssessments.referenceNumber,
              })
              .from(riskAssessments)
              .where(
                and(
                  eq(riskAssessments.tenantId, tid),
                  isNull(riskAssessments.archivedAt),
                  or(ilike(riskAssessments.title, q), ilike(riskAssessments.referenceNumber, q)),
                ),
              )
              .orderBy(desc(riskAssessments.updatedAt))
              .limit(MAX_PER_CATEGORY)
          : empty<{ id: string; title: string; referenceNumber: string | null }>(),
        // Fire safety — buildings…
        has('fireSafety.view')
          ? ctx.db
              .select({ id: fireBuildings.id, name: fireBuildings.name })
              .from(fireBuildings)
              .where(and(eq(fireBuildings.tenantId, tid), ilike(fireBuildings.name, q)))
              .orderBy(desc(fireBuildings.updatedAt))
              .limit(MAX_PER_CATEGORY)
          : empty<{ id: string; name: string }>(),
        // …and FRAs by reference or title.
        has('fireSafety.view')
          ? ctx.db
              .select({
                id: fireRiskAssessments.id,
                title: fireRiskAssessments.title,
                referenceNumber: fireRiskAssessments.referenceNumber,
              })
              .from(fireRiskAssessments)
              .where(
                and(
                  eq(fireRiskAssessments.tenantId, tid),
                  or(
                    ilike(fireRiskAssessments.title, q),
                    ilike(fireRiskAssessments.referenceNumber, q),
                  ),
                ),
              )
              .orderBy(desc(fireRiskAssessments.updatedAt))
              .limit(MAX_PER_CATEGORY)
          : empty<{ id: string; title: string; referenceNumber: string | null }>(),
        // Contractors — company name.
        has('contractors.view')
          ? ctx.db
              .select({ id: contractors.id, name: contractors.name })
              .from(contractors)
              .where(and(eq(contractors.tenantId, tid), ilike(contractors.name, q)))
              .orderBy(desc(contractors.updatedAt))
              .limit(MAX_PER_CATEGORY)
          : empty<{ id: string; name: string }>(),
        // Sites / projects.
        has('sites.view')
          ? ctx.db
              .select({ id: sites.id, name: sites.name })
              .from(sites)
              .where(and(eq(sites.tenantId, tid), isNull(sites.archivedAt), ilike(sites.name, q)))
              .orderBy(desc(sites.updatedAt))
              .limit(MAX_PER_CATEGORY)
          : empty<{ id: string; name: string }>(),
        // Templates.
        has('templates.view')
          ? ctx.db
              .select({ id: templates.id, name: templates.name, status: templates.status })
              .from(templates)
              .where(
                and(
                  eq(templates.tenantId, tid),
                  ne(templates.status, 'archived'),
                  ilike(templates.name, q),
                ),
              )
              .orderBy(desc(templates.updatedAt))
              .limit(MAX_PER_CATEGORY)
          : empty<{ id: string; name: string; status: string }>(),
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
        // RAMS packs — search title, reference and client name.
        has('rams.view')
          ? ctx.db
              .select({
                id: ramsPacks.id,
                title: ramsPacks.title,
                referenceNumber: ramsPacks.referenceNumber,
                status: ramsPacks.status,
              })
              .from(ramsPacks)
              .where(
                and(
                  eq(ramsPacks.tenantId, tid),
                  isNull(ramsPacks.archivedAt),
                  or(
                    ilike(ramsPacks.title, q),
                    ilike(ramsPacks.referenceNumber, q),
                    ilike(ramsPacks.clientName, q),
                  ),
                ),
              )
              .orderBy(desc(ramsPacks.updatedAt))
              .limit(MAX_PER_CATEGORY)
          : empty<{
              id: string;
              title: string;
              referenceNumber: string | null;
              status: string;
            }>(),
        // Training — PEOPLE, not requirement definitions (TR-B3). A
        // searcher typing a name wants that person's cards; a requirement
        // definition is an admin object, and the id-based href it produced
        // pointed at a route that did not exist. Restricted to users who
        // actually hold a record, so the palette does not become a second
        // user directory.
        has('training.view')
          ? ctx.db
              .selectDistinct({
                id: user.id,
                name: user.name,
                email: user.email,
              })
              .from(trainingRecords)
              .innerJoin(user, eq(trainingRecords.userId, user.id))
              .where(
                and(
                  eq(trainingRecords.tenantId, tid),
                  isNull(trainingRecords.supersededAt),
                  isNull(user.deactivatedAt),
                  or(ilike(user.name, q), ilike(user.email, q)),
                ),
              )
              .limit(MAX_PER_CATEGORY)
          : empty<{ id: string; name: string; email: string }>(),
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
        permits: permitRows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: r.referenceNumber ?? r.status,
        })),
        coshh: coshhRows.map((r) => ({ id: r.id, title: r.name, subtitle: null })),
        riskAssessments: raRows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: r.referenceNumber,
        })),
        fireBuildings: fireBuildingRows.map((r) => ({ id: r.id, title: r.name, subtitle: null })),
        fireRiskAssessments: fraRows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: r.referenceNumber,
        })),
        contractors: contractorRows.map((r) => ({ id: r.id, title: r.name, subtitle: null })),
        sites: siteRows.map((r) => ({ id: r.id, title: r.name, subtitle: null })),
        templates: templateRows.map((r) => ({ id: r.id, title: r.name, subtitle: r.status })),
        incidents: incidentRows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: r.referenceNumber,
        })),
        rams: ramsRows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: r.referenceNumber,
        })),
        training: trainingRows.map((r) => ({
          id: r.id,
          title: r.name,
          subtitle: r.email,
        })),
      };
    }),
});
