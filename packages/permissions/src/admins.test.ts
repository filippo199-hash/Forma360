import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { countAdmins, wouldDropBelowMinAdmins } from './admins';
import { seedDefaultPermissionSets } from './seed';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');
const MIGRATION_FILES = [
  '0000_initial.sql',
  '0001_auth.sql',
  '0002_permissions.sql',
  '0003_phase1_org_backbone.sql',
  '0004_phase2_templates_inspections.sql',
  '0005_phase2_inspections.sql',
  '0006_phase2_schedules.sql',
  '0007_inspections_archived_at.sql',
  '0008_invitations.sql',
  '0009_signature_workflow.sql',
  '0010_issues.sql',
  '0011_observations_richer.sql',
  '0012_actions_phase4.sql',
  '0013_actions_phase4b.sql',
  '0014_phase5.sql',
  '0015_phase8_compliance.sql',
  '0016_headsup_share_reactions.sql',
  '0017_heads_up_enhancements.sql',
  '0018_documents_v2.sql',
  '0019_schedule_enhancements.sql',
  '0020_compliance_scope.sql',
  '0021_compliance_features.sql',
  '0022_action_type_labels.sql',
  '0023_inspections_source_link.sql',
  '0024_invite_group_site.sql',
  '0025_user_phone.sql',
  '0026_asset_description.sql',
  '0027_maintenance_notifications.sql',
  '0028_observation_notification_recipients.sql',
  '0029_asset_links.sql',
  '0030_drop_compliance.sql',
  '0031_ai_assistant.sql',
  '0032_user_first_last_name.sql',
  '0033_document_visibility.sql',
];

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of MIGRATION_FILES) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { client, db };
}

describe('countAdmins / wouldDropBelowMinAdmins (S-E02 last-admin guard)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminSetId: string;
  let managerSetId: string;
  let standardSetId: string;

  async function createUser(opts: {
    id?: string;
    email: string;
    permissionSetId: string;
    deactivated?: boolean;
  }): Promise<string> {
    const id = opts.id ?? `usr_${newId()}`;
    await db.insert(schema.user).values({
      id,
      name: 'U',
      email: opts.email,
      tenantId,
      permissionSetId: opts.permissionSetId,
      ...(opts.deactivated === true ? { deactivatedAt: new Date() } : {}),
    });
    return id;
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminSetId = seeded.administrator;
    managerSetId = seeded.manager;
    standardSetId = seeded.standard;
  });

  afterEach(async () => {
    await client.close();
  });

  it('returns 0 for a tenant with no users', async () => {
    expect(await countAdmins(db as unknown as Database, tenantId)).toBe(0);
  });

  it('counts only users whose permission set contains org.settings', async () => {
    await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    await createUser({ email: 'm@acme.test', permissionSetId: managerSetId });
    await createUser({ email: 's@acme.test', permissionSetId: standardSetId });
    expect(await countAdmins(db as unknown as Database, tenantId)).toBe(1);
  });

  it('ignores deactivated admins', async () => {
    await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    await createUser({
      email: 'old-admin@acme.test',
      permissionSetId: adminSetId,
      deactivated: true,
    });
    expect(await countAdmins(db as unknown as Database, tenantId)).toBe(1);
  });

  it('wouldDropBelowMinAdmins: true when the only admin tries to downgrade', async () => {
    const adminUserId = await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    const dropped = await wouldDropBelowMinAdmins(db as unknown as Database, {
      tenantId,
      targetUserId: adminUserId,
      afterPermissions: ['users.view'], // no org.settings
    });
    expect(dropped).toBe(true);
  });

  it('wouldDropBelowMinAdmins: false when another admin exists', async () => {
    const firstAdminId = await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    await createUser({ email: 'b@acme.test', permissionSetId: adminSetId });

    const dropped = await wouldDropBelowMinAdmins(db as unknown as Database, {
      tenantId,
      targetUserId: firstAdminId,
      afterPermissions: ['users.view'],
    });
    expect(dropped).toBe(false);
  });

  it('wouldDropBelowMinAdmins: true when the last admin is being deactivated (afterPermissions=null)', async () => {
    const adminUserId = await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    const dropped = await wouldDropBelowMinAdmins(db as unknown as Database, {
      tenantId,
      targetUserId: adminUserId,
      afterPermissions: null,
    });
    expect(dropped).toBe(true);
  });

  it('wouldDropBelowMinAdmins: false when a non-admin is being deactivated', async () => {
    await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    const standardUserId = await createUser({
      email: 's@acme.test',
      permissionSetId: standardSetId,
    });
    const dropped = await wouldDropBelowMinAdmins(db as unknown as Database, {
      tenantId,
      targetUserId: standardUserId,
      afterPermissions: null,
    });
    expect(dropped).toBe(false);
  });

  it('respects the min parameter — min: 2 flags a drop from 2 admins to 1', async () => {
    const firstAdminId = await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    await createUser({ email: 'b@acme.test', permissionSetId: adminSetId });

    const dropped = await wouldDropBelowMinAdmins(db as unknown as Database, {
      tenantId,
      targetUserId: firstAdminId,
      afterPermissions: null,
      min: 2,
    });
    expect(dropped).toBe(true);
  });
});
