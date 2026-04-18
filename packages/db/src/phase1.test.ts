/**
 * Phase 1 schema integration tests — pglite-backed.
 *
 * Separate from client.test.ts (the Phase 0 tenant + auth suite) so each
 * file stays focused. Same bootDb helper, different test space.
 *
 * Covered:
 *   - Every new Phase 1 table is created by the 0003 migration.
 *   - user.custom_field FK RESTRICT on custom_user_fields (S-E04 DB floor).
 *   - group_members composite unique prevents duplicates.
 *   - Deleting a group cascades group_members + group_membership_rules.
 *   - Sites self-FK restricts deletion of a parent.
 *   - Site members composite unique + cascade from sites.
 *   - Access rules allow empty groupIds / siteIds.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { newId } from '@forma360/shared/id';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from './schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const MIGRATION_FILES = [
  '0000_initial.sql',
  '0001_auth.sql',
  '0002_permissions.sql',
  '0003_phase1_org_backbone.sql',
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

async function seedTenantWithAdmin(
  db: PgliteDatabase<typeof schema>,
): Promise<{ tenantId: string; userId: string; permissionSetId: string }> {
  const tenantId = newId();
  await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
  const permissionSetId = newId();
  await db.insert(schema.permissionSets).values({
    id: permissionSetId,
    tenantId,
    name: 'Administrator',
    permissions: ['org.settings'],
    isSystem: true,
  });
  const userId = `usr_${newId()}`;
  await db.insert(schema.user).values({
    id: userId,
    name: 'Alice',
    email: `alice-${newId()}@acme.test`,
    tenantId,
    permissionSetId,
  });
  return { tenantId, userId, permissionSetId };
}

describe('Phase 1 schemas (pglite integration)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
  });

  afterEach(async () => {
    await client.close();
  });

  it('creates every Phase 1 table via 0003', async () => {
    const result = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    const names = new Set(result.rows.map((r) => r.table_name));
    expect(names).toEqual(
      new Set([
        'access_rules',
        'account',
        'custom_user_fields',
        'group_members',
        'group_membership_rules',
        'groups',
        'permission_sets',
        'session',
        'site_members',
        'site_membership_rules',
        'sites',
        'tenants',
        'two_factor',
        'user',
        'user_custom_field_values',
        'verification',
      ]),
    );
  });

  describe('custom fields + values', () => {
    it('custom_user_fields name is unique per tenant', async () => {
      const { tenantId } = await seedTenantWithAdmin(db);
      await db
        .insert(schema.customUserFields)
        .values({ id: newId(), tenantId, name: 'Role', type: 'select' });
      await expect(
        db
          .insert(schema.customUserFields)
          .values({ id: newId(), tenantId, name: 'Role', type: 'text' }),
      ).rejects.toThrow();
    });

    it('user_custom_field_values enforces one value per (user, field)', async () => {
      const { tenantId, userId } = await seedTenantWithAdmin(db);
      const fieldId = newId();
      await db
        .insert(schema.customUserFields)
        .values({ id: fieldId, tenantId, name: 'Role', type: 'text' });
      await db
        .insert(schema.userCustomFieldValues)
        .values({ tenantId, userId, fieldId, value: 'Safety' });
      await expect(
        db.insert(schema.userCustomFieldValues).values({ tenantId, userId, fieldId, value: 'Ops' }),
      ).rejects.toThrow();
    });

    it('custom field delete is RESTRICTed when a value references it (S-E04 DB floor)', async () => {
      const { tenantId, userId } = await seedTenantWithAdmin(db);
      const fieldId = newId();
      await db
        .insert(schema.customUserFields)
        .values({ id: fieldId, tenantId, name: 'Shift', type: 'text' });
      await db
        .insert(schema.userCustomFieldValues)
        .values({ tenantId, userId, fieldId, value: 'Morning' });
      await expect(
        db.delete(schema.customUserFields).where(eq(schema.customUserFields.id, fieldId)),
      ).rejects.toThrow();
    });

    it('deleting a user cascades their custom-field values', async () => {
      const { tenantId, userId } = await seedTenantWithAdmin(db);
      const fieldId = newId();
      await db
        .insert(schema.customUserFields)
        .values({ id: fieldId, tenantId, name: 'Shift', type: 'text' });
      await db
        .insert(schema.userCustomFieldValues)
        .values({ tenantId, userId, fieldId, value: 'Morning' });

      await db.delete(schema.user).where(eq(schema.user.id, userId));
      const remaining = await db
        .select()
        .from(schema.userCustomFieldValues)
        .where(eq(schema.userCustomFieldValues.fieldId, fieldId));
      expect(remaining).toHaveLength(0);
    });
  });

  describe('groups + group_members + rules', () => {
    it('groups name is unique per tenant', async () => {
      const { tenantId } = await seedTenantWithAdmin(db);
      await db
        .insert(schema.groups)
        .values({ id: newId(), tenantId, name: 'Auditors', membershipMode: 'manual' });
      await expect(
        db
          .insert(schema.groups)
          .values({ id: newId(), tenantId, name: 'Auditors', membershipMode: 'rule_based' }),
      ).rejects.toThrow();
    });

    it('group_members composite unique prevents double-adding a user', async () => {
      const { tenantId, userId } = await seedTenantWithAdmin(db);
      const groupId = newId();
      await db
        .insert(schema.groups)
        .values({ id: groupId, tenantId, name: 'Auditors', membershipMode: 'manual' });
      await db.insert(schema.groupMembers).values({ tenantId, groupId, userId });
      await expect(
        db.insert(schema.groupMembers).values({ tenantId, groupId, userId }),
      ).rejects.toThrow();
    });

    it('deleting a group cascades members and rules', async () => {
      const { tenantId, userId } = await seedTenantWithAdmin(db);
      const groupId = newId();
      await db
        .insert(schema.groups)
        .values({ id: groupId, tenantId, name: 'Auditors', membershipMode: 'rule_based' });
      await db.insert(schema.groupMembers).values({ tenantId, groupId, userId });
      await db.insert(schema.groupMembershipRules).values({
        id: newId(),
        tenantId,
        groupId,
        order: 0,
        conditions: [{ fieldId: 'any', operator: '=', value: 'x' }],
      });

      await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
      expect(
        (
          await db
            .select()
            .from(schema.groupMembers)
            .where(eq(schema.groupMembers.groupId, groupId))
        ).length,
      ).toBe(0);
      expect(
        (
          await db
            .select()
            .from(schema.groupMembershipRules)
            .where(eq(schema.groupMembershipRules.groupId, groupId))
        ).length,
      ).toBe(0);
    });
  });

  describe('sites + hierarchy + members', () => {
    it('rejects sites with duplicate (tenantId, parentId, name)', async () => {
      const { tenantId } = await seedTenantWithAdmin(db);
      await db.insert(schema.sites).values({ id: newId(), tenantId, name: 'UK' });
      await expect(
        db.insert(schema.sites).values({ id: newId(), tenantId, name: 'UK' }),
      ).rejects.toThrow();
    });

    it('deleting a parent site is blocked while a child exists (RESTRICT)', async () => {
      const { tenantId } = await seedTenantWithAdmin(db);
      const parentId = newId();
      const childId = newId();
      await db.insert(schema.sites).values({ id: parentId, tenantId, name: 'UK', depth: 0 });
      await db.insert(schema.sites).values({
        id: childId,
        tenantId,
        name: 'Manchester',
        parentId,
        depth: 1,
        path: parentId,
      });
      await expect(db.delete(schema.sites).where(eq(schema.sites.id, parentId))).rejects.toThrow();
    });

    it('site_members cascades when a site is deleted', async () => {
      const { tenantId, userId } = await seedTenantWithAdmin(db);
      const siteId = newId();
      await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'HQ' });
      await db.insert(schema.siteMembers).values({ tenantId, siteId, userId });

      await db.delete(schema.sites).where(eq(schema.sites.id, siteId));
      expect(
        (await db.select().from(schema.siteMembers).where(eq(schema.siteMembers.siteId, siteId)))
          .length,
      ).toBe(0);
    });
  });

  describe('access rules', () => {
    it('accepts a rule with empty groupIds and siteIds', async () => {
      const { tenantId } = await seedTenantWithAdmin(db);
      const ruleId = newId();
      await db
        .insert(schema.accessRules)
        .values({ id: ruleId, tenantId, name: 'All users', groupIds: [], siteIds: [] });
      const rows = await db
        .select()
        .from(schema.accessRules)
        .where(eq(schema.accessRules.id, ruleId));
      expect(rows[0]?.groupIds).toEqual([]);
      expect(rows[0]?.invalidatedAt).toBeNull();
    });

    it('persists invalidatedAt when set', async () => {
      const { tenantId } = await seedTenantWithAdmin(db);
      const ruleId = newId();
      const now = new Date();
      await db.insert(schema.accessRules).values({
        id: ruleId,
        tenantId,
        name: 'Broken rule',
        groupIds: ['deleted-group'],
        siteIds: [],
        invalidatedAt: now,
      });
      const rows = await db
        .select()
        .from(schema.accessRules)
        .where(eq(schema.accessRules.id, ruleId));
      expect(rows[0]?.invalidatedAt).toBeInstanceOf(Date);
    });
  });
});
