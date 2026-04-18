/**
 * Permission catalogue.
 *
 * Every feature a user might access maps to one key in this file. A user's
 * `permissionSets.permissions` JSON is a subset of this catalogue; the
 * `requirePermission(perm)` tRPC middleware checks membership.
 *
 * **Shape**: `module.action`. Flat constants — not hierarchical — so a
 * permission set's stored value is a plain `string[]` that round-trips
 * through JSON without transforms. See ADR 0001 rationale.
 *
 * **Keys for modules that Phase 1 cannot yet enforce** (Templates,
 * Inspections, Issues, Actions, Heads Up, Assets, Documents, Analytics,
 * Compliance, Training) are catalogued now so the UI can render the full
 * permission grid and admins can provision forward-compatible permission
 * sets. Each future phase's procedures will start using the keys that
 * already exist here.
 *
 * **Adding a new key**: append to the const array below. If it belongs to
 * a new module, also extend `PERMISSION_MODULES`. The catalogue tests will
 * fail if `PERMISSION_MODULES` drifts from the keys or if two keys collide.
 */

export const PERMISSION_MODULES = [
  'users',
  'groups',
  'sites',
  'permissions',
  'templates',
  'inspections',
  'issues',
  'actions',
  'headsUp',
  'assets',
  'documents',
  'analytics',
  'compliance',
  'training',
  'integrations',
  'billing',
  'org',
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

/**
 * The full key list. Keep it alphabetised within each module block for
 * reviewer sanity; tests don't care about ordering but humans do.
 */
export const PERMISSION_KEYS = [
  // ─── Users ───────────────────────────────────────────────────────────────
  'users.view',
  'users.invite',
  'users.manage',
  'users.deactivate',
  'users.anonymise',
  'users.customFields.view',
  'users.customFields.manage',

  // ─── Groups ──────────────────────────────────────────────────────────────
  'groups.view',
  'groups.manage',

  // ─── Sites ───────────────────────────────────────────────────────────────
  'sites.view',
  'sites.manage',
  'sites.labels.manage',

  // ─── Permission sets ─────────────────────────────────────────────────────
  'permissions.view',
  'permissions.manage',

  // ─── Templates (Phase 2) ─────────────────────────────────────────────────
  'templates.view',
  'templates.create',
  'templates.manage',
  'templates.archive',
  'templates.responseSets.manage',
  'templates.schedules.manage',

  // ─── Inspections (Phase 2) ───────────────────────────────────────────────
  'inspections.view',
  'inspections.conduct',
  'inspections.manage',
  'inspections.export',
  'inspections.sign',

  // ─── Issues (Phase 3) ────────────────────────────────────────────────────
  'issues.view',
  'issues.report',
  'issues.manage',
  'issues.settings',
  'issues.investigations.manage',

  // ─── Actions (Phase 4) ───────────────────────────────────────────────────
  'actions.view',
  'actions.create',
  'actions.manage',
  'actions.settings',

  // ─── Heads Up (Phase 5A) ─────────────────────────────────────────────────
  'headsUp.view',
  'headsUp.publish',
  'headsUp.manage',
  'headsUp.analytics.view',

  // ─── Assets & Maintenance (Phase 5B) ─────────────────────────────────────
  'assets.view',
  'assets.manage',
  'assets.readings.record',
  'assets.maintenance.manage',

  // ─── Documents (Phase 5C) ────────────────────────────────────────────────
  'documents.view',
  'documents.manage',
  'documents.folders.manage',

  // ─── Analytics (Phase 7) ─────────────────────────────────────────────────
  'analytics.view',
  'analytics.create',
  'analytics.manage',
  'analytics.schedules.manage',

  // ─── Compliance (Phase 8) ────────────────────────────────────────────────
  'compliance.view',
  'compliance.manage',
  'compliance.frameworks.manage',
  'compliance.evidence.view',

  // ─── Training (Phase 10) ─────────────────────────────────────────────────
  'training.view',
  'training.take',
  'training.manage',
  'training.courses.manage',

  // ─── Integrations & billing (admin-only) ─────────────────────────────────
  'integrations.manage',
  'billing.manage',

  // ─── Organisation settings ───────────────────────────────────────────────
  // `org.settings` is what the S-E02 last-admin check counts: any user whose
  // permission set contains this key is considered an administrator.
  'org.settings',
  'org.audit.view',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

/**
 * Type guard. Use at every boundary where a string-shaped permission crosses
 * from an external source (permission_sets.permissions JSON, CSV imports,
 * API inputs).
 */
export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && PERMISSION_KEY_SET.has(value);
}

/**
 * Return the catalogue grouped by module. Used by the Settings → Permissions
 * grid UI to render one column per module.
 */
export function permissionsByModule(): Record<PermissionModule, PermissionKey[]> {
  const out = {} as Record<PermissionModule, PermissionKey[]>;
  for (const mod of PERMISSION_MODULES) {
    out[mod] = [];
  }
  for (const key of PERMISSION_KEYS) {
    const mod = key.split('.', 1)[0] as PermissionModule;
    out[mod].push(key);
  }
  return out;
}

/**
 * Predicate: does this set of permissions grant administrator-level access?
 * A user is an administrator iff their permission set contains
 * `org.settings`. See ADR 0002 and the S-E02 last-admin check.
 */
export function grantsAdminAccess(permissions: readonly string[]): boolean {
  return permissions.includes('org.settings');
}
