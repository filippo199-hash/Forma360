/**
 * What a brand-new tenant is furnished with before anybody logs in.
 *
 * Two dropdowns decide whether a module is usable on day one, and both
 * of them used to start empty:
 *
 *   - **Observation categories.** A fresh tenant with no categories
 *     lands the reporter on a select with nothing in it and no way
 *     forward, so these have been seeded since sign-up existed.
 *   - **Action types.** These were never seeded at all. Every tenant
 *     opened the "Action type" dropdown to exactly one entry — "No
 *     type" — which is the `NULL` fallback, not a choice. The field that
 *     classifies an action as corrective could not be used to classify
 *     anything, in a module whose entire subject is corrective action.
 *
 * Seeded, not hardcoded: every row here is an ordinary tenant-scoped
 * record the admin can rename, recolour or archive under Settings. The
 * defaults are UK-practice conventions, not statute.
 *
 * Deliberately NOT i18n'd. These are database rows in the tenant's own
 * data — the same category of thing as a site name or a contractor —
 * rather than interface chrome, and an admin who renames "Corrective" to
 * "Put right" expects it to stay renamed in every locale. Ground rule 3
 * governs the chrome around them.
 */
import type { Database } from '@forma360/db/client';
import { actionTypes, issueCategories } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';

/**
 * Observation categories every new tenant starts with.
 *
 * "Good practice" is the one that is not a fault report. A register that
 * can only ever receive bad news is a register people stop filling in —
 * behavioural safety programmes run on positive observations, and
 * without a category for one there is nowhere to put it.
 */
export const DEFAULT_OBSERVATION_CATEGORIES = [
  'Hazard',
  'Near miss',
  'Good practice',
  'Quality',
  'Environmental',
] as const;

/**
 * Action types every new tenant starts with. `Corrective` is the
 * default, because an action raised from a failed inspection question or
 * an observation is a corrective action unless somebody says otherwise.
 */
export const DEFAULT_ACTION_TYPES: ReadonlyArray<{
  name: string;
  description: string;
  color: string;
  isDefault?: boolean;
}> = [
  {
    name: 'Corrective',
    description: 'Puts right something that has already gone wrong or been found non-compliant.',
    color: '#dc2626',
    isDefault: true,
  },
  {
    name: 'Preventive',
    description: 'Stops a problem that has been identified as possible but has not happened yet.',
    color: '#2563eb',
  },
  {
    name: 'Improvement',
    description: 'Makes something better than the standard requires. Not a compliance gap.',
    color: '#16a34a',
  },
  {
    name: 'Maintenance',
    description: 'Planned or reactive upkeep of plant, equipment or the building.',
    color: '#ca8a04',
  },
];

/**
 * Seed the default categories and action types for a tenant that has
 * just been created. Call inside the creating transaction — both
 * sign-up and sandbox provisioning do — so a tenant can never exist
 * without them.
 */
export async function seedTenantDefaults(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<{ categoryIds: Map<string, string> }> {
  const now = new Date();

  const categoryIds = new Map<string, string>();
  for (const name of DEFAULT_OBSERVATION_CATEGORIES) categoryIds.set(name, newId());

  await db.insert(issueCategories).values(
    DEFAULT_OBSERVATION_CATEGORIES.map((name) => ({
      id: categoryIds.get(name) as string,
      tenantId,
      name,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })),
  );

  await db.insert(actionTypes).values(
    DEFAULT_ACTION_TYPES.map((type) => ({
      id: newId(),
      tenantId,
      name: type.name,
      description: type.description,
      color: type.color,
      isDefault: type.isDefault ?? false,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })),
  );

  return { categoryIds };
}
