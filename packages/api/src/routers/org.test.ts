/**
 * Integration tests for groups / sites / accessRules routers.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { createLogger } from '@forma360/shared/logger';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { createTestContext, type Context } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');
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
  '0037_site_media.sql',
  '0038_site_plans.sql',
  '0039_site_geolocation.sql',
  '0040_site_groups.sql',
  '0041_heads_up_documents.sql',
  '0042_contractors.sql',
  '0043_contractors_phase1b.sql',
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

const createCaller = createCallerFactory(appRouter);

function silentLogger() {
  return createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
}

describe('Phase 1 org routers (groups / sites / accessRules)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminSetId: string;
  let adminUserId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: 'a@x', tenantId: tenantId as never },
    });
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminSetId = seeded.administrator;
    adminUserId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Alice',
      email: 'alice@acme.test',
      tenantId,
      permissionSetId: adminSetId,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  describe('groups router', () => {
    it('creates a manual group, lists it, adds and removes members', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: groupId } = await caller.groups.create({
        name: 'Auditors',
        membershipMode: 'manual',
      });

      const list = await caller.groups.list();
      expect(list.some((g) => g.id === groupId)).toBe(true);

      await caller.groups.addMember({ groupId, userId: adminUserId });
      const members = await caller.groups.members({ groupId });
      expect(members).toHaveLength(1);
      expect(members[0]?.userId).toBe(adminUserId);

      await caller.groups.removeMember({ groupId, userId: adminUserId });
      const after = await caller.groups.members({ groupId });
      expect(after).toHaveLength(0);
    });

    it('refuses manual edits on a rule_based group (mirrors G-E10)', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: groupId } = await caller.groups.create({
        name: 'RuleGroup',
        membershipMode: 'rule_based',
      });
      await expect(caller.groups.addMember({ groupId, userId: adminUserId })).rejects.toThrow(
        /rule_based/,
      );
    });

    it('rejects > 5 rules on a group', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: groupId } = await caller.groups.create({
        name: 'RG',
        membershipMode: 'rule_based',
      });
      const bigRuleSet = Array.from({ length: 6 }, () => ({
        order: 0,
        conditions: [{ fieldId: 'f', operator: '=', value: 'x' }],
      }));
      await expect(caller.groups.setRules({ groupId, rules: bigRuleSet })).rejects.toThrow();
    });

    it('rejects a rule with an unknown operator', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: groupId } = await caller.groups.create({
        name: 'RG',
        membershipMode: 'rule_based',
      });
      await expect(
        caller.groups.setRules({
          groupId,
          rules: [{ order: 0, conditions: [{ fieldId: 'f', operator: 'magic', value: 'x' }] }],
        }),
      ).rejects.toThrow(/operator/);
    });

    it('archive invalidates referencing access rules (G-E06)', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: groupId } = await caller.groups.create({ name: 'Auditors' });
      const { id: ruleId } = await caller.accessRules.create({
        name: 'Auditors rule',
        groupIds: [groupId],
        siteIds: [],
      });

      await caller.groups.archive({ id: groupId });

      const rows = await db
        .select()
        .from(schema.accessRules)
        .where(eq(schema.accessRules.id, ruleId));
      expect(rows[0]?.invalidatedAt).toBeInstanceOf(Date);
    });
  });

  describe('sites router', () => {
    it('creates a hierarchy, enforces depth, moves a subtree (G-17)', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: countryId } = await caller.sites.create({ name: 'UK' });
      const { id: regionId } = await caller.sites.create({
        name: 'North',
        parentId: countryId,
      });
      const { id: siteId } = await caller.sites.create({
        name: 'Manchester',
        parentId: regionId,
      });

      const all = await caller.sites.list();
      const mcr = all.find((s) => s.id === siteId);
      expect(mcr?.depth).toBe(2);
      expect(mcr?.path).toBe(`${countryId}.${regionId}`);

      // Move Manchester directly under UK.
      await caller.sites.move({ id: siteId, parentId: countryId });
      const after = (await caller.sites.list()).find((s) => s.id === siteId);
      expect(after?.depth).toBe(1);
      expect(after?.parentId).toBe(countryId);
      expect(after?.path).toBe(countryId);
    });

    it('refuses to move a site beneath its own descendant', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: parentId } = await caller.sites.create({ name: 'UK' });
      const { id: childId } = await caller.sites.create({ name: 'North', parentId });
      // Try to move UK beneath North — would create a cycle.
      await expect(caller.sites.move({ id: parentId, parentId: childId })).rejects.toThrow(
        /descendant|cycle/,
      );
    });

    it('refuses to exceed max depth (G-E07) on create', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const ids: string[] = [];
      let parent: string | null = null;
      for (let i = 0; i <= 5; i++) {
        const { id } = await caller.sites.create({
          name: `L${i}`,
          parentId: parent,
        });
        ids.push(id);
        parent = id;
      }
      // Adding a 7th level (depth 6) should fail.
      await expect(caller.sites.create({ name: 'Too deep', parentId: parent })).rejects.toThrow(
        /depth/,
      );
    });

    it('allows manual membership edits regardless of stored mode', async () => {
      // Rule-based membership was retired from the Sites UI, so the stored
      // mode no longer gates manual member edits (its reconcile is inert).
      const caller = createCaller(ctxFor(adminUserId));
      const { id: siteId } = await caller.sites.create({
        name: 'HQ',
        membershipMode: 'rule_based',
      });
      await caller.sites.addMember({ siteId, userId: adminUserId });
      const team = await caller.sites.team({ siteId });
      expect(team.memberIds).toContain(adminUserId);
    });

    it('matrix returns only the edges matching the requested filter', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: siteA } = await caller.sites.create({ name: 'A' });
      const { id: siteB } = await caller.sites.create({ name: 'B' });
      await caller.sites.addMember({ siteId: siteA, userId: adminUserId });
      await caller.sites.addMember({ siteId: siteB, userId: adminUserId });

      const all = await caller.sites.matrix({});
      expect(all.edges).toHaveLength(2);

      const onlyA = await caller.sites.matrix({ siteIds: [siteA] });
      expect(onlyA.edges).toHaveLength(1);
      expect(onlyA.edges[0]?.siteId).toBe(siteA);
    });

    it('archive invalidates referencing access rules (G-E06)', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: siteId } = await caller.sites.create({ name: 'HQ' });
      const { id: ruleId } = await caller.accessRules.create({
        name: 'HQ rule',
        groupIds: [],
        siteIds: [siteId],
      });
      await caller.sites.archive({ id: siteId });
      const rows = await db
        .select()
        .from(schema.accessRules)
        .where(eq(schema.accessRules.id, ruleId));
      expect(rows[0]?.invalidatedAt).toBeInstanceOf(Date);
    });
  });

  describe('accessRules router', () => {
    it('lists invalidated rules via listInvalid', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: siteId } = await caller.sites.create({ name: 'HQ' });
      const { id: ruleId } = await caller.accessRules.create({
        name: 'HQ',
        groupIds: [],
        siteIds: [siteId],
      });
      await caller.sites.archive({ id: siteId });

      const invalid = await caller.accessRules.listInvalid();
      expect(invalid.some((r) => r.id === ruleId)).toBe(true);

      const valid = await caller.accessRules.list();
      // The invalidated rule still appears in the main list — admins need
      // to see it there to fix it.
      expect(valid.some((r) => r.id === ruleId)).toBe(true);
    });

    it('update clears invalidatedAt (admin fix flow)', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: siteId } = await caller.sites.create({ name: 'HQ' });
      const { id: ruleId } = await caller.accessRules.create({
        name: 'HQ',
        groupIds: [],
        siteIds: [siteId],
      });
      await caller.sites.archive({ id: siteId });

      // Admin edits the rule to point at a new site.
      const { id: newSite } = await caller.sites.create({ name: 'HQ2' });
      await caller.accessRules.update({ id: ruleId, siteIds: [newSite] });

      const row = (
        await db.select().from(schema.accessRules).where(eq(schema.accessRules.id, ruleId))
      )[0];
      expect(row?.invalidatedAt).toBeNull();
    });
  });
});
