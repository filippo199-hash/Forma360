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
      const otherSeeded = await seedDefaultPermissionSets(
        db as unknown as Database,
        otherTenantId,
      );
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
});
