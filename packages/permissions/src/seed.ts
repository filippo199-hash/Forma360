/**
 * Default-permission-set seeding for a new tenant.
 *
 * Phase 1 seeds three system permission sets per tenant on creation:
 *   - Administrator — every key in the catalogue
 *   - Manager — everything except the tenant-admin trio
 *     (`billing.manage`, `integrations.manage`, `org.settings`,
 *     `users.anonymise`)
 *   - Standard — view-level access + the end-user verbs
 *     (inspections.conduct, issues.report, actions.create, headsUp.view,
 *     training.take, etc.)
 *
 * All three are `isSystem: true` so the UI blocks renaming / deletion.
 */
import { permissionSets, type NewPermissionSet } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import type { Database } from '@forma360/db/client';
import { PERMISSION_KEYS, type PermissionKey } from './catalogue';

const ADMIN_ONLY_KEYS: ReadonlyArray<PermissionKey> = [
  'billing.manage',
  'integrations.manage',
  'org.settings',
  'users.anonymise',
];

/** Standard-user verbs: the minimum set that lets a field worker work. */
const STANDARD_KEYS: ReadonlyArray<PermissionKey> = [
  'users.view',
  'groups.view',
  'sites.view',
  'permissions.view',
  'templates.view',
  'inspections.view',
  'inspections.conduct',
  'inspections.sign',
  'issues.view',
  'issues.report',
  'actions.view',
  'actions.create',
  'headsUp.view',
  'assets.view',
  'assets.readings.record',
  'documents.view',
  'analytics.view',
  'compliance.view',
  'training.view',
  'training.take',
];

export interface SeededSetIds {
  administrator: string;
  manager: string;
  standard: string;
}

/**
 * Insert the three default permission sets for a tenant. Idempotent: if the
 * tenant already has system sets, this is a no-op (the caller gets the
 * existing ids). Returns the ids in a typed struct for convenience when
 * provisioning the first admin user.
 */
export async function seedDefaultPermissionSets(
  db: Database,
  tenantId: string,
): Promise<SeededSetIds> {
  const existing = await db.query.permissionSets.findMany({
    where: (ps, { and, eq }) => and(eq(ps.tenantId, tenantId), eq(ps.isSystem, true)),
  });
  if (existing.length === 3) {
    // Already seeded — map by name and return.
    const byName = new Map(existing.map((s) => [s.name, s.id]));
    const admin = byName.get('Administrator');
    const manager = byName.get('Manager');
    const standard = byName.get('Standard');
    if (admin !== undefined && manager !== undefined && standard !== undefined) {
      return { administrator: admin, manager, standard };
    }
  }

  const adminKeys = [...PERMISSION_KEYS];
  const managerKeys = PERMISSION_KEYS.filter(
    (k) => !(ADMIN_ONLY_KEYS as readonly string[]).includes(k),
  );
  const standardKeys = [...STANDARD_KEYS];

  const adminId = newId();
  const managerId = newId();
  const standardId = newId();

  const rows: NewPermissionSet[] = [
    {
      id: adminId,
      tenantId,
      name: 'Administrator',
      description: 'Full control: users, groups, sites, billing, every feature.',
      permissions: adminKeys,
      isSystem: true,
    },
    {
      id: managerId,
      tenantId,
      name: 'Manager',
      description: 'Create templates, manage training, manage feature settings.',
      permissions: managerKeys,
      isSystem: true,
    },
    {
      id: standardId,
      tenantId,
      name: 'Standard',
      description: 'Conduct inspections, report issues, complete actions and training.',
      permissions: standardKeys,
      isSystem: true,
    },
  ];

  await db.insert(permissionSets).values(rows);
  return { administrator: adminId, manager: managerId, standard: standardId };
}
