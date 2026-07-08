import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { seedDefaultPermissionSets } from './seed';
import { PERMISSION_KEYS } from './catalogue';

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
  '0034_maintenance_programs.sql',
  '0035_asset_owner.sql',
  '0036_site_projects.sql',
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

describe('seedDefaultPermissionSets', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
  });

  afterEach(async () => {
    await client.close();
  });

  it('creates three system permission sets on first call', async () => {
    const { administrator, manager, standard } = await seedDefaultPermissionSets(
      db as unknown as Database,
      tenantId,
    );

    expect(administrator).not.toBe(manager);
    expect(manager).not.toBe(standard);

    const all = await db
      .select()
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.tenantId, tenantId));
    expect(all).toHaveLength(3);
    expect(all.every((s) => s.isSystem)).toBe(true);
    expect(new Set(all.map((s) => s.name))).toEqual(
      new Set(['Administrator', 'Manager', 'Standard']),
    );
  });

  it('Administrator contains every permission in the catalogue', async () => {
    const { administrator } = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    const admin = await db
      .select()
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.id, administrator));
    expect(new Set(admin[0]?.permissions ?? [])).toEqual(new Set(PERMISSION_KEYS));
  });

  it('Manager excludes billing.manage / integrations.manage / org.settings / users.anonymise', async () => {
    const { manager } = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    const rows = await db
      .select()
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.id, manager));
    const perms = rows[0]?.permissions ?? [];
    expect(perms).not.toContain('billing.manage');
    expect(perms).not.toContain('integrations.manage');
    expect(perms).not.toContain('org.settings');
    expect(perms).not.toContain('users.anonymise');
  });

  it('Standard excludes org.settings and the *.manage keys', async () => {
    const { standard } = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    const rows = await db
      .select()
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.id, standard));
    const perms = rows[0]?.permissions ?? [];
    expect(perms).not.toContain('org.settings');
    expect(perms).not.toContain('users.manage');
    expect(perms).not.toContain('groups.manage');
    expect(perms).toContain('inspections.conduct');
    expect(perms).toContain('issues.report');
    expect(perms).toContain('training.take');
  });

  it('is idempotent — calling twice does not create duplicates', async () => {
    const first = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    const second = await seedDefaultPermissionSets(db as unknown as Database, tenantId);

    expect(second.administrator).toBe(first.administrator);
    expect(second.manager).toBe(first.manager);
    expect(second.standard).toBe(first.standard);

    const all = await db
      .select()
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.tenantId, tenantId));
    expect(all).toHaveLength(3);
  });

  it('per-tenant isolation: two tenants end up with six distinct rows', async () => {
    const otherTenantId = newId();
    await db.insert(schema.tenants).values({ id: otherTenantId, name: 'Other', slug: 'other' });

    await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    await seedDefaultPermissionSets(db as unknown as Database, otherTenantId);

    const all = await db.select().from(schema.permissionSets);
    expect(all).toHaveLength(6);
    expect(
      all
        .filter((s) => s.tenantId === tenantId)
        .map((s) => s.name)
        .sort(),
    ).toEqual(['Administrator', 'Manager', 'Standard']);
    expect(
      all
        .filter((s) => s.tenantId === otherTenantId)
        .map((s) => s.name)
        .sort(),
    ).toEqual(['Administrator', 'Manager', 'Standard']);
  });
});
