/**
 * Tenant-reference guards.
 *
 * `tenantProcedure` guarantees the *caller* is bound to a tenant, but it does
 * NOT validate the reference ids a mutation accepts in its input. Historically
 * several mutations stored a client-supplied `userId` / `siteId` / `groupId` /
 * `assetId` verbatim without confirming it belongs to `ctx.tenantId`. On its
 * own that's a data-integrity problem; combined with a display join that reads
 * the referenced (global) table without a tenant filter, it becomes a
 * cross-tenant data leak (a foreign user's name + email, a foreign site's
 * name, …).
 *
 * These helpers close the write side: call them before persisting any inbound
 * reference id so a foreign-tenant id is rejected with NOT_FOUND. The read side
 * is hardened separately by adding `eq(<table>.tenantId, ctx.tenantId)` to the
 * display joins (defense in depth — belt and suspenders).
 *
 * All helpers are no-ops for an empty/absent list, dedupe, and ignore empty
 * strings, so callers can pass optional inputs directly.
 */
import {
  assetTypes,
  assets,
  documentFolders,
  groups,
  maintenancePrograms,
  sites,
  user,
} from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';

type Db = Database;

function clean(ids: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

async function assertAll(
  ids: ReadonlyArray<string | null | undefined>,
  loadFoundIds: (unique: string[]) => Promise<Set<string>>,
  label: string,
): Promise<void> {
  const unique = clean(ids);
  if (unique.length === 0) return;
  const found = await loadFoundIds(unique);
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `${label} not found in this tenant`,
    });
  }
}

/** Reject any id that is not an active-or-inactive user in `tenantId`. */
export function assertUsersInTenant(
  db: Db,
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  return assertAll(
    ids,
    async (unique) => {
      const rows = await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.tenantId, tenantId), inArray(user.id, unique)));
      return new Set(rows.map((r) => r.id));
    },
    'user',
  );
}

/** Reject any id that is not a site in `tenantId`. */
export function assertSitesInTenant(
  db: Db,
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  return assertAll(
    ids,
    async (unique) => {
      const rows = await db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.tenantId, tenantId), inArray(sites.id, unique)));
      return new Set(rows.map((r) => r.id));
    },
    'site',
  );
}

/** Reject any id that is not a group in `tenantId`. */
export function assertGroupsInTenant(
  db: Db,
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  return assertAll(
    ids,
    async (unique) => {
      const rows = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.tenantId, tenantId), inArray(groups.id, unique)));
      return new Set(rows.map((r) => r.id));
    },
    'group',
  );
}

/** Reject any id that is not an asset in `tenantId`. */
export function assertAssetsInTenant(
  db: Db,
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  return assertAll(
    ids,
    async (unique) => {
      const rows = await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.tenantId, tenantId), inArray(assets.id, unique)));
      return new Set(rows.map((r) => r.id));
    },
    'asset',
  );
}

/** Reject any id that is not an asset type in `tenantId`. */
export function assertAssetTypesInTenant(
  db: Db,
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  return assertAll(
    ids,
    async (unique) => {
      const rows = await db
        .select({ id: assetTypes.id })
        .from(assetTypes)
        .where(and(eq(assetTypes.tenantId, tenantId), inArray(assetTypes.id, unique)));
      return new Set(rows.map((r) => r.id));
    },
    'asset type',
  );
}

/** Reject any id that is not a maintenance program in `tenantId`. */
export function assertMaintenanceProgramsInTenant(
  db: Db,
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  return assertAll(
    ids,
    async (unique) => {
      const rows = await db
        .select({ id: maintenancePrograms.id })
        .from(maintenancePrograms)
        .where(and(eq(maintenancePrograms.tenantId, tenantId), inArray(maintenancePrograms.id, unique)));
      return new Set(rows.map((r) => r.id));
    },
    'maintenance program',
  );
}

/** Reject any id that is not a document folder in `tenantId`. */
export function assertDocumentFoldersInTenant(
  db: Db,
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  return assertAll(
    ids,
    async (unique) => {
      const rows = await db
        .select({ id: documentFolders.id })
        .from(documentFolders)
        .where(and(eq(documentFolders.tenantId, tenantId), inArray(documentFolders.id, unique)));
      return new Set(rows.map((r) => r.id));
    },
    'document folder',
  );
}

/**
 * Reject an object-storage key that does not begin with `<tenantId>/`.
 *
 * R2 is a single bucket keyed `<tenantId>/<module>/<entityId>/<file>`
 * (see `@forma360/shared/storage`). Any tRPC mutation that accepts a raw
 * `storageKey` from the client (attachment records) must call this so a
 * caller cannot register a key pointing at another tenant's object and then
 * have a `list`/`get` mint a signed download URL for it.
 */
export function assertStorageKeyInTenant(tenantId: string, storageKey: string): void {
  if (!storageKey.startsWith(`${tenantId}/`)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'storage key does not belong to this tenant',
    });
  }
}
