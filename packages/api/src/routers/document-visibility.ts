/**
 * Document & folder visibility helpers (To-Do #5 + #6).
 *
 * A folder or document is visible to a viewer when its OWN visibility
 * passes AND every ancestor folder's visibility passes — i.e. a parent
 * folder's restriction cascades down and overrides looser child settings.
 *
 * "Own visibility passes" means: the entity lists no groups and no sites
 * (public), OR the viewer belongs to at least one listed group or site.
 *
 * Callers with `documents.manage` bypass all of this and see everything.
 */
import {
  documentAccess,
  documentFolders,
  groupMembers,
  siteGroups,
  siteMembers,
} from '@forma360/db/schema';
import { and, eq, inArray, or } from 'drizzle-orm';

export interface ViewerMemberships {
  groupIds: Set<string>;
  siteIds: Set<string>;
}

export async function loadViewerMemberships(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
  userId: string,
): Promise<ViewerMemberships> {
  const [g, s] = await Promise.all([
    db
      .select({ id: groupMembers.groupId })
      .from(groupMembers)
      .where(and(eq(groupMembers.tenantId, tenantId), eq(groupMembers.userId, userId))),
    db
      .select({ id: siteMembers.siteId })
      .from(siteMembers)
      .where(and(eq(siteMembers.tenantId, tenantId), eq(siteMembers.userId, userId))),
  ]);
  const groupIds = new Set((g as { id: string }[]).map((r) => r.id));
  const siteIds = new Set((s as { id: string }[]).map((r) => r.id));

  // A group assigned to a site/project extends its members' site access:
  // any site that lists one of the viewer's groups counts as a membership.
  if (groupIds.size > 0) {
    const sg = await db
      .select({ id: siteGroups.siteId })
      .from(siteGroups)
      .where(and(eq(siteGroups.tenantId, tenantId), inArray(siteGroups.groupId, [...groupIds])));
    for (const r of sg as { id: string }[]) siteIds.add(r.id);
  }

  return { groupIds, siteIds };
}

/**
 * Explicit ACL grants for this viewer (platform review PF-26: the
 * document_access table was written by grant/revoke and consulted by no
 * read path). A grant on a document — or on a folder, covering its whole
 * subtree — ADDS visibility on top of the group/site rules.
 */
export interface ViewerAccessGrants {
  docIds: Set<string>;
  folderIds: Set<string>;
}

export async function loadViewerAccessGrants(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
  userId: string,
  viewerGroupIds: Set<string>,
): Promise<ViewerAccessGrants> {
  const subjectClauses = [
    and(eq(documentAccess.subjectType, 'user'), eq(documentAccess.subjectId, userId)),
  ];
  if (viewerGroupIds.size > 0) {
    subjectClauses.push(
      and(
        eq(documentAccess.subjectType, 'group'),
        inArray(documentAccess.subjectId, [...viewerGroupIds]),
      ),
    );
  }
  const rows = await db
    .select({ documentId: documentAccess.documentId, folderId: documentAccess.folderId })
    .from(documentAccess)
    .where(and(eq(documentAccess.tenantId, tenantId), or(...subjectClauses)));
  const docIds = new Set<string>();
  const folderIds = new Set<string>();
  for (const r of rows as Array<{ documentId: string | null; folderId: string | null }>) {
    if (r.documentId !== null) docIds.add(r.documentId);
    if (r.folderId !== null) folderIds.add(r.folderId);
  }
  return { docIds, folderIds };
}

/** True when the folder or any ancestor carries a grant for the viewer. */
export function makeFolderGrantChecker(
  folders: Array<{ id: string; parentId: string | null }>,
  grants: ViewerAccessGrants,
): (folderId: string | null) => boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const memo = new Map<string, boolean>();
  function granted(folderId: string | null): boolean {
    if (folderId === null) return false;
    const cached = memo.get(folderId);
    if (cached !== undefined) return cached;
    memo.set(folderId, false); // cycle guard
    const result = grants.folderIds.has(folderId) || granted(byId.get(folderId)?.parentId ?? null);
    memo.set(folderId, result);
    return result;
  }
  return granted;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

/** An entity's own visibility passes for this viewer. Empty arrays = public. */
export function ownVisibilityPasses(
  visibleToGroupIds: unknown,
  visibleToSiteIds: unknown,
  viewer: ViewerMemberships,
): boolean {
  const groups = asStringArray(visibleToGroupIds);
  const sites = asStringArray(visibleToSiteIds);
  if (groups.length === 0 && sites.length === 0) return true;
  return groups.some((id) => viewer.groupIds.has(id)) || sites.some((id) => viewer.siteIds.has(id));
}

export interface FolderVis {
  id: string;
  parentId: string | null;
  visibleToGroupIds: unknown;
  visibleToSiteIds: unknown;
}

/**
 * Build a predicate that returns whether a folder is visible to the viewer,
 * walking the ancestor chain. Memoized; cycle-guarded.
 */
export function makeFolderVisibilityChecker(
  folders: FolderVis[],
  viewer: ViewerMemberships,
): (folderId: string | null) => boolean {
  const byId = new Map<string, FolderVis>(folders.map((f) => [f.id, f]));
  const memo = new Map<string, boolean>();

  function visible(folderId: string | null): boolean {
    if (folderId === null) return true; // root
    const cached = memo.get(folderId);
    if (cached !== undefined) return cached;
    // Guard against cycles by marking visited as we descend.
    memo.set(folderId, true);
    const f = byId.get(folderId);
    if (f === undefined) {
      // Unknown folder (e.g. cross-tenant or missing) — treat as not visible.
      memo.set(folderId, false);
      return false;
    }
    const own = ownVisibilityPasses(f.visibleToGroupIds, f.visibleToSiteIds, viewer);
    const result = own && visible(f.parentId);
    memo.set(folderId, result);
    return result;
  }

  return visible;
}

/** The visibility-relevant columns of a document. */
export interface DocumentVis {
  /**
   * DC-S03: REQUIRED, and it used to be optional. The download route simply
   * did not select it, so the `grants.docIds.has(doc.id)` branch below could
   * never fire and every document-level ACL grant produced a 404 on the file
   * — while folder-level grants worked, which made it read as a storage
   * fault rather than an authorisation bug. Making it required is what stops
   * the next caller omitting it.
   */
  id: string;
  folderId: string | null;
  visibleToGroupIds: unknown;
  visibleToSiteIds: unknown;
}

/**
 * Build a reusable "can this viewer see this document" predicate, loading
 * the viewer's memberships, the tenant's folder tree and the ACL grants
 * exactly once.
 *
 * {@link isDocumentVisibleToUser} answers the same question for a single
 * document and is the right call for a by-id read. Prefer this one whenever
 * a caller renders a *set* of documents — otherwise the per-document
 * helper re-runs three queries per row.
 *
 * `userId === null` is the anonymous viewer: in nobody's group, on nobody's
 * site, holding no grant. Only a genuinely unrestricted document passes,
 * which is exactly the rule a public share link needs — it has no viewer to
 * check against, so the honest question is not "may they see it" but "is
 * this document restricted at all" (HU-D04).
 */
export async function makeDocumentVisibilityFilter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
  userId: string | null,
): Promise<(doc: DocumentVis) => boolean> {
  const [viewer, allFolders] = await Promise.all([
    userId === null
      ? Promise.resolve<ViewerMemberships>({ groupIds: new Set(), siteIds: new Set() })
      : loadViewerMemberships(db, tenantId, userId),
    db
      .select({
        id: documentFolders.id,
        parentId: documentFolders.parentId,
        visibleToGroupIds: documentFolders.visibleToGroupIds,
        visibleToSiteIds: documentFolders.visibleToSiteIds,
      })
      .from(documentFolders)
      .where(eq(documentFolders.tenantId, tenantId)),
  ]);
  // PF-26: an explicit ACL grant (document- or folder-scoped) admits the
  // viewer even when the group/site visibility rules would not.
  const grants: ViewerAccessGrants =
    userId === null
      ? { docIds: new Set(), folderIds: new Set() }
      : await loadViewerAccessGrants(db, tenantId, userId, viewer.groupIds);

  const folders = allFolders as FolderVis[];
  const folderGranted = makeFolderGrantChecker(folders, grants);
  const folderVisible = makeFolderVisibilityChecker(folders, viewer);

  return (doc: DocumentVis): boolean => {
    if (grants.docIds.has(doc.id)) return true;
    if (folderGranted(doc.folderId)) return true;
    return (
      ownVisibilityPasses(doc.visibleToGroupIds, doc.visibleToSiteIds, viewer) &&
      folderVisible(doc.folderId)
    );
  };
}

/**
 * Whether a single document is visible to a viewer: its own group/site
 * visibility passes AND every ancestor folder's visibility passes. Reuses
 * the same predicates the `list` endpoint uses — so a by-id read (get,
 * download, versions) enforces exactly what the list already filters.
 * Callers that hold `documents.manage` (or admin) must bypass this
 * themselves; this function makes no permission assumptions.
 */
export async function isDocumentVisibleToUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
  userId: string,
  doc: DocumentVis,
): Promise<boolean> {
  const passes = await makeDocumentVisibilityFilter(db, tenantId, userId);
  return passes(doc);
}
