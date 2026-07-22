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
import { groupMembers, siteGroups, siteMembers } from '@forma360/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

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
