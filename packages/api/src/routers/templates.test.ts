/**
 * Integration tests for the templates router. Covers:
 *   - T-01: create a template, publish, verify current version
 *   - T-22 / T-E04: editing a published template creates a new draft;
 *     old version still readable (pinned)
 *   - T-E17: draft version can snapshot a custom response set
 *   - T-E18: optimistic concurrency on draft save rejects stale updates
 *   - T-E05: archive sets archivedAt + blocks edits
 *   - duplication produces a new draft named "Copy of …"
 *   - exportJson / importJson round-trip
 *   - A published version's content is NOT updated by saveDraft — a new
 *     draft row is created instead (the publish-immutability contract)
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
import { TEMPLATE_SCHEMA_VERSION, type TemplateContent } from '@forma360/shared/template-schema';
import { desc, eq } from 'drizzle-orm';
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
  '0044_contractor_visits.sql',
  '0045_contractor_gate.sql',
  '0046_contractor_assets.sql',
  '0047_contractor_users.sql',
  '0048_contractor_visit_visitor.sql',
  '0049_contractor_compliance_override.sql',
  '0050_contractor_visit_overstay.sql',
  '0051_site_fk_integrity.sql',
  '0052_reference_counters.sql',
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
const silent = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

function validContent(title: string): TemplateContent {
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    title,
    pages: [
      {
        id: newId(),
        type: 'title',
        title: 'Title',
        sections: [
          {
            id: newId(),
            title: 's',
            items: [{ id: newId(), type: 'conductedBy', prompt: 'Conducted by', required: false }],
          },
        ],
      },
      {
        id: newId(),
        type: 'inspection',
        title: 'Inspection',
        sections: [
          {
            id: newId(),
            title: 's',
            items: [
              {
                id: newId(),
                type: 'text',
                prompt: 'Notes?',
                required: false,
                multiline: false,
                maxLength: 2000,
              },
            ],
          },
        ],
      },
    ],
    settings: {
      titleFormat: '{date}',
      documentNumberFormat: '{counter:6}',
      documentNumberStart: 1,
    },
    customResponseSets: [],
  };
}

describe('templates router (Phase 2)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let standardSetId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
      auth: { userId, email: 'a@x', tenantId: tenantId as never },
    });
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    standardSetId = seeded.standard;
    adminUserId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Alice',
      email: 'alice@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  describe('access-rule enforcement on reads (B3 — IDOR regression)', () => {
    it('non-member cannot get/getVersion a restricted template by id; member can; manager bypasses', async () => {
      // Admin builds a published template restricted to the "North" group.
      const admin = createCaller(ctxFor(adminUserId));
      const { templateId } = await admin.templates.create({ name: 'North Only' });
      await admin.templates.saveDraft({ templateId, content: validContent('North Only') });
      const { versionId } = await admin.templates.publish({ templateId });

      const northGroupId = newId();
      await db.insert(schema.groups).values({ id: northGroupId, tenantId, name: 'North' });
      await admin.templates.updateAccess({
        templateId,
        access: { mode: 'specific', groupIds: [northGroupId], siteIds: [] },
      });

      // A Standard user (holds templates.view, NOT templates.manage) who is
      // NOT in the North group.
      const outsiderId = `usr_${newId()}`;
      await db.insert(schema.user).values({
        id: outsiderId,
        name: 'Sam Outsider',
        email: 'sam@acme.test',
        tenantId,
        permissionSetId: standardSetId,
      });
      const outsider = createCaller(ctxFor(outsiderId));

      // Both per-id reads must be FORBIDDEN for the non-member.
      await expect(outsider.templates.get({ templateId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(outsider.templates.getVersion({ versionId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });

      // A manager/admin bypasses the rule (mirrors list).
      await expect(admin.templates.get({ templateId })).resolves.toBeDefined();

      // Once the outsider joins North, the same reads succeed.
      await db
        .insert(schema.groupMembers)
        .values({ tenantId, groupId: northGroupId, userId: outsiderId });
      await expect(outsider.templates.get({ templateId })).resolves.toBeDefined();
      await expect(outsider.templates.getVersion({ versionId })).resolves.toBeDefined();
    });

    it('an open template (no access rule) is readable by any templates.view holder', async () => {
      const admin = createCaller(ctxFor(adminUserId));
      const { templateId } = await admin.templates.create({ name: 'Open' });
      await admin.templates.saveDraft({ templateId, content: validContent('Open') });
      await admin.templates.publish({ templateId });

      const someoneId = `usr_${newId()}`;
      await db.insert(schema.user).values({
        id: someoneId,
        name: 'Any User',
        email: 'any@acme.test',
        tenantId,
        permissionSetId: standardSetId,
      });
      const someone = createCaller(ctxFor(someoneId));
      await expect(someone.templates.get({ templateId })).resolves.toBeDefined();
    });
  });

  describe('create + publish (T-01)', () => {
    it('creates a draft template with one version', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId, draftVersionId } = await caller.templates.create({
        name: 'Daily Inspection',
      });
      expect(templateId).toHaveLength(26);
      expect(draftVersionId).toHaveLength(26);

      const { template, versions } = await caller.templates.get({ templateId });
      expect(template.status).toBe('draft');
      expect(template.currentVersionId).toBeNull();
      expect(versions).toHaveLength(1);
      expect(versions[0]?.publishedAt).toBeNull();
      expect(versions[0]?.isCurrent).toBe(false);
    });

    it('publishes the draft and points currentVersionId at it', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'X' });
      await caller.templates.saveDraft({ templateId, content: validContent('X') });
      const { versionId } = await caller.templates.publish({ templateId });

      const { template } = await caller.templates.get({ templateId });
      expect(template.status).toBe('published');
      expect(template.currentVersionId).toBe(versionId);

      const rows = await db
        .select()
        .from(schema.templateVersions)
        .where(eq(schema.templateVersions.id, versionId));
      expect(rows[0]?.publishedAt).toBeInstanceOf(Date);
      expect(rows[0]?.isCurrent).toBe(true);
    });
  });

  describe('editing a published template (T-22 / T-E04)', () => {
    it('creates a new draft version; previous published version stays frozen', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'V1' });
      await caller.templates.saveDraft({ templateId, content: validContent('V1') });
      const first = await caller.templates.publish({ templateId });

      // Save a new draft after publish.
      const v2content = validContent('V1'); // same title, new content
      await caller.templates.saveDraft({ templateId, content: v2content });

      // The first version's content is unchanged.
      const firstRow = (
        await db
          .select()
          .from(schema.templateVersions)
          .where(eq(schema.templateVersions.id, first.versionId))
      )[0];
      expect(firstRow?.isCurrent).toBe(true);
      expect(firstRow?.publishedAt).toBeInstanceOf(Date);

      // A new version row exists in draft state.
      const allVersions = await db
        .select()
        .from(schema.templateVersions)
        .where(eq(schema.templateVersions.templateId, templateId))
        .orderBy(desc(schema.templateVersions.versionNumber));
      expect(allVersions).toHaveLength(2);
      expect(allVersions[0]?.publishedAt).toBeNull(); // newest is draft
      expect(allVersions[0]?.versionNumber).toBe(2);
      expect(allVersions[1]?.publishedAt).toBeInstanceOf(Date); // v1 still published
      expect(allVersions[1]?.versionNumber).toBe(1);
    });

    it('publishing a second version flips isCurrent atomically', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'Two-publish' });
      await caller.templates.saveDraft({ templateId, content: validContent('Two-publish') });
      const first = await caller.templates.publish({ templateId });
      await caller.templates.saveDraft({ templateId, content: validContent('Two-publish') });
      const second = await caller.templates.publish({ templateId });

      const v1 = (
        await db
          .select()
          .from(schema.templateVersions)
          .where(eq(schema.templateVersions.id, first.versionId))
      )[0];
      const v2 = (
        await db
          .select()
          .from(schema.templateVersions)
          .where(eq(schema.templateVersions.id, second.versionId))
      )[0];
      expect(v1?.isCurrent).toBe(false);
      expect(v2?.isCurrent).toBe(true);
    });
  });

  describe('T-E18 optimistic concurrency on saveDraft', () => {
    it('rejects a save that references a stale updatedAt', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'T' });

      // Save once to stamp updatedAt.
      await caller.templates.saveDraft({ templateId, content: validContent('T') });

      // Pretend the client saw a very old timestamp.
      const stale = new Date(Date.now() - 60_000).toISOString();
      await expect(
        caller.templates.saveDraft({
          templateId,
          content: validContent('T'),
          expectedUpdatedAt: stale,
        }),
      ).rejects.toThrow(/modified by another editor|CONFLICT/);
    });
  });

  describe('T-E05 archive', () => {
    it('sets archivedAt and blocks subsequent edits', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'A' });
      await caller.templates.archive({ templateId });

      const { template } = await caller.templates.get({ templateId });
      expect(template.archivedAt).toBeInstanceOf(Date);
      expect(template.status).toBe('archived');

      await expect(
        caller.templates.saveDraft({ templateId, content: validContent('A') }),
      ).rejects.toThrow(/archived/);
    });
  });

  describe('duplicate', () => {
    it('creates a new draft named "Copy of …"', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'Original' });
      const { templateId: newId1 } = await caller.templates.duplicate({ templateId });
      expect(newId1).not.toBe(templateId);
      const { template } = await caller.templates.get({ templateId: newId1 });
      expect(template.name).toBe('Copy of Original');
      expect(template.status).toBe('draft');
    });
  });

  describe('exportJson / importJson', () => {
    it('exports the current version and re-imports into a new draft', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'Exportable' });
      await caller.templates.saveDraft({ templateId, content: validContent('Exportable') });
      await caller.templates.publish({ templateId });

      const { content } = await caller.templates.exportJson({ templateId });
      expect(content.schemaVersion).toBe('1');

      const { templateId: newTemplateId } = await caller.templates.importJson({
        name: 'Imported',
        content,
      });
      const { template, versions } = await caller.templates.get({ templateId: newTemplateId });
      expect(template.name).toBe('Imported');
      expect(template.status).toBe('draft');
      expect(versions).toHaveLength(1);
      expect(versions[0]?.content.title).toBe('Imported');
    });

    it('rejects a malformed JSON import', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      await expect(
        caller.templates.importJson({ name: 'Bad', content: { schemaVersion: '99' } }),
      ).rejects.toThrow(/schema/i);
    });
  });

  describe('publish immutability contract', () => {
    it('saveDraft after publish never updates the published version row', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'Immutable' });
      await caller.templates.saveDraft({ templateId, content: validContent('Immutable') });
      const first = await caller.templates.publish({ templateId });

      const before = (
        await db
          .select()
          .from(schema.templateVersions)
          .where(eq(schema.templateVersions.id, first.versionId))
      )[0];

      // Kick saveDraft — creates a new version, must NOT touch the published
      // version's content.
      await caller.templates.saveDraft({ templateId, content: validContent('Immutable') });

      const after = (
        await db
          .select()
          .from(schema.templateVersions)
          .where(eq(schema.templateVersions.id, first.versionId))
      )[0];
      expect(after?.content).toEqual(before?.content);
      expect(after?.publishedAt?.getTime()).toBe(before?.publishedAt?.getTime());
    });
  });

  describe('exportAllCsv (PR 33)', () => {
    it('returns header + one row per template with usage_count reflecting inspections', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId: t1 } = await caller.templates.create({ name: 'Busy' });
      await caller.templates.saveDraft({ templateId: t1, content: validContent('Busy') });
      await caller.templates.publish({ templateId: t1 });
      const { templateId: t2 } = await caller.templates.create({ name: 'Empty' });
      await caller.templates.saveDraft({ templateId: t2, content: validContent('Empty') });
      await caller.templates.publish({ templateId: t2 });

      // Two inspections on t1, zero on t2.
      await caller.inspections.create({ templateId: t1 });
      await caller.inspections.create({ templateId: t1 });

      const { csv, rowCount } = await caller.templates.exportAllCsv();
      expect(rowCount).toBe(2);
      const lines = csv.split('\r\n').filter((l) => l.length > 0);
      // Header + 2 rows
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe(
        '"template_id","name","status","version_count","current_version_number","published_at","archived_at","usage_count"',
      );
      // Rows are sorted asc by name: Busy comes first.
      const busyLine = lines.find((l) => l.includes('"Busy"'));
      const emptyLine = lines.find((l) => l.includes('"Empty"'));
      expect(busyLine).toBeDefined();
      expect(emptyLine).toBeDefined();
      // Last cell is usage_count.
      expect(busyLine).toMatch(/,"2"\r?$/);
      expect(emptyLine).toMatch(/,"0"\r?$/);
    });

    it('is tenant-scoped', async () => {
      const otherTenantId = newId();
      await db.insert(schema.tenants).values({ id: otherTenantId, name: 'Other', slug: 'other' });
      const otherSeeded = await seedDefaultPermissionSets(db as unknown as Database, otherTenantId);
      const otherAdminId = `usr_${newId()}`;
      await db.insert(schema.user).values({
        id: otherAdminId,
        name: 'Other',
        email: 'other@x.test',
        tenantId: otherTenantId,
        permissionSetId: otherSeeded.administrator,
      });
      const otherCaller = createCaller(
        createTestContext({
          db: db as unknown as Database,
          logger: silent(),
          auth: { userId: otherAdminId, email: 'other@x.test', tenantId: otherTenantId as never },
        }),
      );
      // Create a template in tenantId
      const caller = createCaller(ctxFor(adminUserId));
      await caller.templates.create({ name: 'MyTenantOnly' });

      const { csv, rowCount } = await otherCaller.templates.exportAllCsv();
      expect(rowCount).toBe(0);
      expect(csv).not.toContain('MyTenantOnly');
    });
  });

  describe('publish with audience scoping (Publish tab)', () => {
    it('clears the rule when access.mode === "everyone"', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'Audience' });
      await caller.templates.saveDraft({ templateId, content: validContent('Audience') });

      // Pre-seed an existing access rule on the template so we can verify
      // that publishing with "everyone" actually clears it.
      const ruleId = newId();
      await db.insert(schema.accessRules).values({
        id: ruleId,
        tenantId,
        name: '[auto] Template: Audience',
        groupIds: [],
        siteIds: [],
      });
      await db
        .update(schema.templates)
        .set({ accessRuleId: ruleId })
        .where(eq(schema.templates.id, templateId));

      await caller.templates.publish({
        templateId,
        access: { mode: 'everyone', groupIds: [], siteIds: [] },
      });

      const tpl = (
        await db.select().from(schema.templates).where(eq(schema.templates.id, templateId))
      )[0];
      expect(tpl?.accessRuleId).toBeNull();
    });

    it('creates a new auto-rule on first publish with access.mode === "specific"', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const groupId = newId();
      const siteId = newId();
      await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'Auditors' });
      await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'HQ' });

      const { templateId } = await caller.templates.create({ name: 'Scoped' });
      await caller.templates.saveDraft({ templateId, content: validContent('Scoped') });

      await caller.templates.publish({
        templateId,
        access: { mode: 'specific', groupIds: [groupId], siteIds: [siteId] },
      });

      const tpl = (
        await db.select().from(schema.templates).where(eq(schema.templates.id, templateId))
      )[0];
      expect(tpl?.accessRuleId).not.toBeNull();
      const rule = (
        await db
          .select()
          .from(schema.accessRules)
          .where(eq(schema.accessRules.id, tpl?.accessRuleId ?? ''))
      )[0];
      expect(rule?.name).toBe('[auto] Template: Scoped');
      expect(rule?.groupIds).toEqual([groupId]);
      expect(rule?.siteIds).toEqual([siteId]);
    });

    it('updates the existing auto-rule on re-publish (does not create a new one)', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const g1 = newId();
      const g2 = newId();
      const s1 = newId();
      await db.insert(schema.groups).values([
        { id: g1, tenantId, name: 'Auditors' },
        { id: g2, tenantId, name: 'Managers' },
      ]);
      await db.insert(schema.sites).values({ id: s1, tenantId, name: 'HQ' });

      const { templateId } = await caller.templates.create({ name: 'Reuse' });
      await caller.templates.saveDraft({ templateId, content: validContent('Reuse') });
      await caller.templates.publish({
        templateId,
        access: { mode: 'specific', groupIds: [g1], siteIds: [s1] },
      });

      const firstRuleId = (
        await db.select().from(schema.templates).where(eq(schema.templates.id, templateId))
      )[0]?.accessRuleId;

      // Save another draft + re-publish with a different audience.
      await caller.templates.saveDraft({ templateId, content: validContent('Reuse') });
      await caller.templates.publish({
        templateId,
        access: { mode: 'specific', groupIds: [g2], siteIds: [s1] },
      });

      const secondRuleId = (
        await db.select().from(schema.templates).where(eq(schema.templates.id, templateId))
      )[0]?.accessRuleId;
      expect(secondRuleId).toBe(firstRuleId);

      const rules = await db
        .select()
        .from(schema.accessRules)
        .where(eq(schema.accessRules.tenantId, tenantId));
      // Exactly one auto-rule for this template.
      expect(rules).toHaveLength(1);
      expect(rules[0]?.groupIds).toEqual([g2]);
    });

    it('getAccess returns mode "everyone" for a template with accessRuleId: null', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'NoRule' });
      const access = await caller.templates.getAccess({ templateId });
      expect(access.mode).toBe('everyone');
      expect(access.groupIds).toEqual([]);
      expect(access.siteIds).toEqual([]);
    });
  });

  describe('updateAccess (Visibility tab)', () => {
    it('updates visibility on a published template without requiring a draft', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const groupId = newId();
      await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'Auditors' });

      // Create + publish so there's NO draft left.
      const { templateId } = await caller.templates.create({ name: 'CleanPub' });
      await caller.templates.saveDraft({ templateId, content: validContent('CleanPub') });
      await caller.templates.publish({ templateId });

      // Confirm a follow-up publish would now fail — no draft exists.
      await expect(caller.templates.publish({ templateId })).rejects.toThrow(/No draft to publish/);

      // updateAccess must succeed on this same clean published template.
      const result = await caller.templates.updateAccess({
        templateId,
        access: { mode: 'specific', groupIds: [groupId], siteIds: [] },
      });
      expect(result.accessRuleId).not.toBeNull();

      const tpl = (
        await db.select().from(schema.templates).where(eq(schema.templates.id, templateId))
      )[0];
      expect(tpl?.accessRuleId).toBe(result.accessRuleId);
      const rule = (
        await db
          .select()
          .from(schema.accessRules)
          .where(eq(schema.accessRules.id, result.accessRuleId ?? ''))
      )[0];
      expect(rule?.name).toBe('[auto] Template: CleanPub');
      expect(rule?.groupIds).toEqual([groupId]);
    });

    it('flips back to mode "everyone" and clears accessRuleId', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const groupId = newId();
      await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'Auditors' });

      const { templateId } = await caller.templates.create({ name: 'FlipBack' });
      await caller.templates.saveDraft({ templateId, content: validContent('FlipBack') });
      await caller.templates.publish({ templateId });

      // First scope to specific groups.
      await caller.templates.updateAccess({
        templateId,
        access: { mode: 'specific', groupIds: [groupId], siteIds: [] },
      });
      const before = (
        await db.select().from(schema.templates).where(eq(schema.templates.id, templateId))
      )[0];
      expect(before?.accessRuleId).not.toBeNull();

      // Now flip back to everyone.
      const result = await caller.templates.updateAccess({
        templateId,
        access: { mode: 'everyone', groupIds: [], siteIds: [] },
      });
      expect(result.accessRuleId).toBeNull();

      const after = (
        await db.select().from(schema.templates).where(eq(schema.templates.id, templateId))
      )[0];
      expect(after?.accessRuleId).toBeNull();
    });

    it('refuses on archived templates', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'ArchivedVis' });
      await caller.templates.archive({ templateId });

      await expect(
        caller.templates.updateAccess({
          templateId,
          access: { mode: 'everyone', groupIds: [], siteIds: [] },
        }),
      ).rejects.toThrow(/Cannot edit an archived template|BAD_REQUEST/);
    });
  });

  describe('templates.list filters by access rule', () => {
    /** Build a Standard user (no `templates.manage`) attached to the given group/site. */
    async function createStandardUser(input: {
      groupIds: readonly string[];
      siteIds: readonly string[];
    }): Promise<string> {
      const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
      const userId = `usr_${newId()}`;
      await db.insert(schema.user).values({
        id: userId,
        name: 'Std',
        email: `std-${userId}@x.test`,
        tenantId,
        permissionSetId: seeded.standard,
      });
      for (const gid of input.groupIds) {
        await db.insert(schema.groupMembers).values({ tenantId, groupId: gid, userId });
      }
      for (const sid of input.siteIds) {
        await db.insert(schema.siteMembers).values({ tenantId, siteId: sid, userId });
      }
      return userId;
    }

    it('returns every template (including gated ones) to users with templates.manage', async () => {
      const admin = createCaller(ctxFor(adminUserId));
      const groupId = newId();
      const siteId = newId();
      await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'Auditors' });
      await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'HQ' });

      const { templateId: gatedId } = await admin.templates.create({ name: 'Gated' });
      await admin.templates.saveDraft({ templateId: gatedId, content: validContent('Gated') });
      await admin.templates.publish({
        templateId: gatedId,
        access: { mode: 'specific', groupIds: [groupId], siteIds: [siteId] },
      });

      const { templateId: openId } = await admin.templates.create({ name: 'Open' });
      await admin.templates.saveDraft({ templateId: openId, content: validContent('Open') });
      await admin.templates.publish({ templateId: openId });

      const list = await admin.templates.list();
      const ids = list.map((t) => t.id);
      expect(ids).toContain(gatedId);
      expect(ids).toContain(openId);
    });

    it('filters out templates whose access rule excludes the caller', async () => {
      const admin = createCaller(ctxFor(adminUserId));
      const auditorsGroup = newId();
      const managersGroup = newId();
      const hqSite = newId();
      await db.insert(schema.groups).values([
        { id: auditorsGroup, tenantId, name: 'Auditors' },
        { id: managersGroup, tenantId, name: 'Managers' },
      ]);
      await db.insert(schema.sites).values({ id: hqSite, tenantId, name: 'HQ' });

      // Two gated templates.
      const { templateId: auditorTplId } = await admin.templates.create({ name: 'AuditorOnly' });
      await admin.templates.saveDraft({
        templateId: auditorTplId,
        content: validContent('AuditorOnly'),
      });
      await admin.templates.publish({
        templateId: auditorTplId,
        access: { mode: 'specific', groupIds: [auditorsGroup], siteIds: [hqSite] },
      });

      const { templateId: managerTplId } = await admin.templates.create({ name: 'ManagerOnly' });
      await admin.templates.saveDraft({
        templateId: managerTplId,
        content: validContent('ManagerOnly'),
      });
      await admin.templates.publish({
        templateId: managerTplId,
        access: { mode: 'specific', groupIds: [managersGroup], siteIds: [hqSite] },
      });

      // Auditor-group standard user should see the Auditor template, not the
      // Manager template.
      const auditorUserId = await createStandardUser({
        groupIds: [auditorsGroup],
        siteIds: [hqSite],
      });
      const stdCaller = createCaller(ctxFor(auditorUserId));
      const visible = await stdCaller.templates.list();
      const visibleIds = visible.map((t) => t.id);
      expect(visibleIds).toContain(auditorTplId);
      expect(visibleIds).not.toContain(managerTplId);
    });

    it('returns null-rule templates to every user, gated or not', async () => {
      const admin = createCaller(ctxFor(adminUserId));
      const { templateId: openId } = await admin.templates.create({ name: 'Open2' });
      await admin.templates.saveDraft({ templateId: openId, content: validContent('Open2') });
      await admin.templates.publish({
        templateId: openId,
        access: { mode: 'everyone', groupIds: [], siteIds: [] },
      });

      // User with no group/site memberships.
      const userId = await createStandardUser({ groupIds: [], siteIds: [] });
      const stdCaller = createCaller(ctxFor(userId));
      const visible = await stdCaller.templates.list();
      expect(visible.map((t) => t.id)).toContain(openId);
    });
  });

  describe('unarchive', () => {
    it('clears archivedAt and sets status to draft for an archived template', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'ToRestore' });
      await caller.templates.archive({ templateId });

      // Confirm archived state first.
      const before = await caller.templates.get({ templateId });
      expect(before.template.archivedAt).toBeInstanceOf(Date);
      expect(before.template.status).toBe('archived');

      await caller.templates.unarchive({ templateId });

      const after = await caller.templates.get({ templateId });
      expect(after.template.archivedAt).toBeNull();
      expect(after.template.status).toBe('draft');
    });
  });

  describe('unpublish', () => {
    it('flips status to draft but leaves currentVersionId unchanged', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'PubThenDraft' });
      await caller.templates.saveDraft({ templateId, content: validContent('PubThenDraft') });
      const { versionId } = await caller.templates.publish({ templateId });

      const before = await caller.templates.get({ templateId });
      expect(before.template.status).toBe('published');
      expect(before.template.currentVersionId).toBe(versionId);

      await caller.templates.unpublish({ templateId });

      const after = await caller.templates.get({ templateId });
      expect(after.template.status).toBe('draft');
      // Crucially the pinned current version stays — in-progress inspections
      // that referenced this version can still resolve their content.
      expect(after.template.currentVersionId).toBe(versionId);
    });

    it('is a no-op on a draft template', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'AlreadyDraft' });

      const before = await caller.templates.get({ templateId });
      expect(before.template.status).toBe('draft');

      // Should not throw; should not change anything.
      await caller.templates.unpublish({ templateId });

      const after = await caller.templates.get({ templateId });
      expect(after.template.status).toBe('draft');
      expect(after.template.currentVersionId).toBe(before.template.currentVersionId);
    });

    it('throws BAD_REQUEST on an archived template', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await caller.templates.create({ name: 'Archived' });
      await caller.templates.archive({ templateId });

      await expect(caller.templates.unpublish({ templateId })).rejects.toThrow(
        /cannot-unpublish-archived|BAD_REQUEST/,
      );
    });
  });

  describe('accessRules.list hides [auto] rules', () => {
    it('omits rules whose name starts with "[auto] "', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      // One user-facing rule, one auto-rule.
      const userRuleId = newId();
      const autoRuleId = newId();
      await db.insert(schema.accessRules).values([
        { id: userRuleId, tenantId, name: 'User-facing rule', groupIds: [], siteIds: [] },
        {
          id: autoRuleId,
          tenantId,
          name: '[auto] Template: Something',
          groupIds: [],
          siteIds: [],
        },
      ]);

      const list = await caller.accessRules.list();
      const ids = list.map((r) => r.id);
      expect(ids).toContain(userRuleId);
      expect(ids).not.toContain(autoRuleId);
    });
  });

  // The AI generation / import paths emit a small TemplateSpec; createFromSpec
  // expands it deterministically and lands a draft. (The agents themselves are
  // exercised end-to-end against the live model, not here.)
  describe('createFromSpec (AI generation seam)', () => {
    it('expands a spec into a schema-valid draft template with one version', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId, draftVersionId } = await caller.templates.createFromSpec({
        spec: {
          title: 'Forklift Pre-Use Inspection',
          description: 'Daily forklift checks',
          pages: [
            {
              title: 'Pre-use',
              sections: [
                {
                  title: 'Visual',
                  questions: [
                    {
                      key: 'q_tyres',
                      prompt: 'Tyres in good condition?',
                      type: 'multipleChoice',
                      options: [
                        { label: 'Pass', color: 'green' },
                        {
                          label: 'Fail',
                          color: 'red',
                          flag: true,
                          requireEvidence: true,
                          jumpTo: 'finish',
                        },
                      ],
                    },
                    { key: 'q_hours', prompt: 'Engine hours', type: 'number', unit: 'h' },
                    { prompt: 'Sign off', type: 'signature' },
                  ],
                },
              ],
            },
          ],
        },
      });
      expect(templateId).toHaveLength(26);
      expect(draftVersionId).toHaveLength(26);

      const { template, versions } = await caller.templates.get({ templateId });
      expect(template.status).toBe('draft');
      expect(template.name).toBe('Forklift Pre-Use Inspection');
      expect(template.currentVersionId).toBeNull();
      expect(versions).toHaveLength(1);

      const content = versions[0]?.content as TemplateContent;
      // Title page is prepended; one inspection page added.
      expect(content.pages[0]?.type).toBe('title');
      expect(content.pages.filter((p) => p.type === 'inspection')).toHaveLength(1);
      // The MC question carries the snapshotted response set + a flag + a forward jump.
      const items = content.pages
        .flatMap((p) => p.sections)
        .flatMap((s) => s.items)
        .filter((i) => 'prompt' in i && i.prompt === 'Tyres in good condition?');
      const mc = items[0];
      expect(mc?.type).toBe('multipleChoice');
      if (mc?.type === 'multipleChoice') {
        expect(mc.flaggedOptionIds?.length).toBe(1);
        expect(mc.jumps?.[0]?.target).toEqual({ type: 'end' });
        expect(content.customResponseSets.some((s) => s.id === mc.responseSetId)).toBe(true);
      }
    });

    it('rejects an empty spec (no pages)', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      await expect(
        caller.templates.createFromSpec({ spec: { title: 'X', pages: [] } }),
      ).rejects.toThrow();
    });
  });
});
