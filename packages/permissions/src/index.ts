/**
 * @forma360/permissions — public entry point.
 *
 * Phase 1 exports:
 *   - ./catalogue: PERMISSION_KEYS, PermissionKey, isPermissionKey, ...
 *   - ./requirePermission: loadUserPermissions, hasPermission
 *   - ./admins: countAdmins, wouldDropBelowMinAdmins (S-E02 guard)
 *   - ./seed: seedDefaultPermissionSets (per-tenant system sets)
 *
 * Future PRs add: rules (rule-based membership), access (advanced access
 * rules), dependents (cascade-preview registry).
 */
export * from './catalogue';
export * from './requirePermission';
export * from './admins';
export * from './seed';
