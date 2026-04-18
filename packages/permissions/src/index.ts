/**
 * @forma360/permissions — public entry point.
 *
 * Phase 1 exports:
 *   - ./catalogue         PERMISSION_KEYS, PermissionKey, isPermissionKey, ...
 *   - ./requirePermission loadUserPermissions, hasPermission
 *   - ./admins            countAdmins, wouldDropBelowMinAdmins (S-E02)
 *   - ./seed              seedDefaultPermissionSets
 *   - ./rules             evaluateRules, validateRuleConditions
 *   - ./access            resolveAccessRule
 *   - ./dependents        getDependents, registerDependentResolver
 */
export * from './catalogue';
export * from './requirePermission';
export * from './admins';
export * from './seed';
export * from './rules';
export * from './access';
export * from './dependents';
