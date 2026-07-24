/**
 * Contractor portal activities (Phase 4).
 *
 * An external contractor user is granted a set of *activities* — the things
 * the company lets them do in the portal. Each activity maps to the permission
 * keys that gate the corresponding feature (so enforcement flows through the
 * normal `requirePermission` path via a per-user permission set) and to the
 * route prefixes the portal shell lets them reach.
 *
 * Data-level scoping: these permission keys grant tenant-wide *feature* access,
 * but the primary read surfaces enforce a per-contractor filter so a portal
 * user only sees their own contractor's records. `inspections`/`issues`/
 * `actions` list + get resolve `loadContractorScope` (`packages/api/src/
 * contractor-scope.ts`) and constrain rows to those authored (or, for actions,
 * assigned) within the caller's contractor. Internal users are unaffected.
 */
import type { PermissionKey } from './catalogue';

export const CONTRACTOR_ACTIVITIES = [
  'inspections',
  'observations',
  'actions',
  'documents',
] as const;

export type ContractorActivity = (typeof CONTRACTOR_ACTIVITIES)[number];

const ACTIVITY_SET: ReadonlySet<string> = new Set(CONTRACTOR_ACTIVITIES);

export function isContractorActivity(value: unknown): value is ContractorActivity {
  return typeof value === 'string' && ACTIVITY_SET.has(value);
}

/** Permission keys granted by each activity. */
const ACTIVITY_PERMISSION_KEYS: Record<ContractorActivity, readonly PermissionKey[]> = {
  inspections: ['inspections.view', 'inspections.conduct', 'inspections.sign'],
  observations: ['issues.view', 'issues.report'],
  actions: ['actions.view', 'actions.create'],
  documents: ['documents.view'],
};

/** Route-prefix (locale-relative) allow-list the portal shell permits per activity. */
export const ACTIVITY_ROUTE_PREFIXES: Record<ContractorActivity, readonly string[]> = {
  inspections: ['/inspections'],
  observations: ['/observations'],
  actions: ['/actions'],
  documents: ['/documents'],
};

/** The de-duplicated permission-key set for a list of activities. */
export function activitiesToPermissionKeys(activities: readonly string[]): PermissionKey[] {
  const keys = new Set<PermissionKey>();
  for (const a of activities) {
    if (isContractorActivity(a)) {
      for (const k of ACTIVITY_PERMISSION_KEYS[a]) keys.add(k);
    }
  }
  return [...keys];
}

/** Locale-relative route prefixes an external user with these activities may open. */
export function activitiesToRoutePrefixes(activities: readonly string[]): string[] {
  const prefixes = new Set<string>(['/portal']);
  for (const a of activities) {
    if (isContractorActivity(a)) {
      for (const p of ACTIVITY_ROUTE_PREFIXES[a]) prefixes.add(p);
    }
  }
  return [...prefixes];
}
