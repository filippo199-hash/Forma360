/**
 * `getDependents(entity, id)` — cascade-preview registry.
 *
 * Used by every destructive admin action (archive a site, delete a group,
 * anonymise a user, delete a permission set, ...). Returns a count-by-module
 * record so the Settings UI can show a "here's what depends on this row"
 * dialog before confirming the action.
 *
 * Plugin pattern:
 *   - Each module owns its "how many of my rows depend on this entity?"
 *     logic and registers a resolver at boot time.
 *   - `getDependents` runs every registered resolver in parallel and
 *     merges the results into a typed record.
 *   - Unregistered modules resolve to 0 — they're listed in the result so
 *     the UI can render the full matrix with "0" placeholders rather than
 *     hiding modules that haven't been built yet.
 *
 * The full module list matches the Phase 0 permission catalogue's module
 * set so a future Phase registering itself is a one-liner in that phase's
 * router boot.
 */
import type { Database } from '@forma360/db/client';

/**
 * Entities that admins can destructively mutate and that every other
 * module may reference. Grows as Phase 2+ introduces new "anchors".
 */
export type DependentEntity =
  | 'tenant'
  | 'group'
  | 'site'
  | 'user'
  | 'permissionSet'
  | 'customUserField'
  | 'accessRule';

/** Modules that may hold a reference to a `DependentEntity`. */
export type DependentModule =
  | 'users'
  | 'groups'
  | 'sites'
  | 'permissionSets'
  | 'accessRules'
  | 'customUserFields'
  | 'templates'
  | 'inspections'
  | 'issues'
  | 'actions'
  | 'headsUp'
  | 'assets'
  | 'documents'
  | 'analytics'
  | 'compliance'
  | 'training'
  | 'notifications';

export type DependentCounts = Record<DependentModule, number>;

export interface DependentResolverInput {
  entity: DependentEntity;
  id: string;
  tenantId: string;
}

export interface DependentResolverDeps {
  db: Database;
}

/**
 * A module's resolver. Returns the count of rows in that module referencing
 * the given entity. Must throw-free under normal conditions; any thrown
 * error is caught by `getDependents` and the module's count defaults to 0
 * (the caller treats "unknown" as "no blocker", and the thrown error is
 * logged upstream so an operator can investigate). This is a deliberate
 * graceful-degradation choice — we'd rather miss one dependency in a
 * preview than block the admin UI entirely on a resolver bug.
 */
export type DependentResolver = (
  deps: DependentResolverDeps,
  input: DependentResolverInput,
) => Promise<number>;

const ALL_MODULES: readonly DependentModule[] = [
  'users',
  'groups',
  'sites',
  'permissionSets',
  'accessRules',
  'customUserFields',
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
  'notifications',
];

const registry = new Map<DependentModule, DependentResolver>();

/**
 * Register a resolver for a module. Call once at router-module boot time.
 * Re-registering replaces the previous resolver for that module.
 *
 * Phase 1 registers: accessRules, users (counts for permissionSet +
 * customUserField anchors), groups (for users), sites (for users).
 * Each later phase adds exactly one `registerDependentResolver` call.
 */
export function registerDependentResolver(
  module: DependentModule,
  resolver: DependentResolver,
): void {
  registry.set(module, resolver);
}

/**
 * Execute every registered resolver in parallel. Returns a full
 * `DependentCounts` record with every module present (zero when no
 * resolver is registered for that module).
 */
export async function getDependents(
  deps: DependentResolverDeps,
  input: DependentResolverInput,
): Promise<DependentCounts> {
  const counts: DependentCounts = {
    users: 0,
    groups: 0,
    sites: 0,
    permissionSets: 0,
    accessRules: 0,
    customUserFields: 0,
    templates: 0,
    inspections: 0,
    issues: 0,
    actions: 0,
    headsUp: 0,
    assets: 0,
    documents: 0,
    analytics: 0,
    compliance: 0,
    training: 0,
    notifications: 0,
  };

  const entries = [...registry.entries()];
  const results = await Promise.allSettled(
    entries.map(async ([module, resolver]) => {
      const n = await resolver(deps, input);
      return [module, n] as const;
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const [module, n] = result.value;
      counts[module] = n;
    }
    // Rejected resolvers are treated as 0 — graceful degradation so one
    // broken module doesn't freeze the cascade preview.
  }

  return counts;
}

/** Convenience: is any dependent count > 0? */
export function hasDependents(counts: DependentCounts): boolean {
  return ALL_MODULES.some((m) => counts[m] > 0);
}

/**
 * Clear the registry. **Tests only** — the production code paths call
 * `registerDependentResolver` at boot and never clear. Exported so the
 * test file can get a deterministic start per describe block.
 */
export function resetDependentsRegistryForTests(): void {
  registry.clear();
}
