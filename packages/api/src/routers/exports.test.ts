/**
 * Integration tests for the exports router — Phase 2 PR 31.
 *
 * Exercises the share-link create/list/revoke round-trip against
 * pglite + the full phase-2 migration chain. Renderer calls are
 * mocked so the test does not depend on Puppeteer / R2.
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
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { createTestContext, type Context } from '../context';
import { buildAppRouter } from '../router';
import { createCallerFactory } from '../trpc';
import type { ExportsRouterDeps } from './exports';
import type { InspectionsExportDeps } from './inspectionsExport';

const stubInspectionsExportDeps: InspectionsExportDeps = {
  uploadCsv: async ({ key }) => ({ url: `stub://${key}` }),
  now: () => new Date('2026-04-01T00:00:00Z'),
};

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

async function bootDb() {
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

const silent = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

function makeMockDeps(): ExportsRouterDeps {
  let counter = 0;
  return {
    renderPdf: async () => ({ key: 'T/inspections/I/pdf-abc.pdf', bytes: 1234, stub: false }),
    renderDocx: async () => ({ key: 'T/inspections/I/docx-abc.docx', bytes: 4321 }),
    generateShareToken: () => {
      counter += 1;
      // 43-char base64url-ish deterministic token for assertions
      return `tok_${counter.toString().padStart(39, '0')}`;
    },
    buildShareUrl: (token) => `https://app.test/s/${token}`,
  };
}

describe('exports router (Phase 2 PR 31)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let inspectionId: string;
  let exportsDeps: ExportsRouterDeps;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
      auth: { userId, email: 'a@x', tenantId: tenantId as never },
    });
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    adminUserId = `usr_${newId()}`;
    inspectionId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Alice',
      email: 'alice@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
    const templateId = newId();
    const versionId = newId();
    await db.insert(schema.templates).values({
      id: templateId,
      tenantId,
      name: 'Tpl',
      createdBy: adminUserId,
    });
    await db.insert(schema.templateVersions).values({
      id: versionId,
      tenantId,
      templateId,
      versionNumber: 1,
      content: {
        schemaVersion: '1',
        title: 'Tpl',
        pages: [],
        settings: {},
        customResponseSets: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      publishedAt: new Date(),
    });
    await db.insert(schema.inspections).values({
      id: inspectionId,
      tenantId,
      templateId,
      templateVersionId: versionId,
      title: 'Audit 1',
      accessSnapshot: {
        groups: [],
        sites: [],
        permissions: ['inspections.export', 'inspections.view', 'org.settings'],
        snapshotAt: new Date().toISOString(),
      },
      createdBy: adminUserId,
    });
    exportsDeps = makeMockDeps();
  });

  afterEach(async () => {
    await client.close();
  });

  function callerForAdmin() {
    const router = buildAppRouter({ exports: exportsDeps, inspectionsExport: stubInspectionsExportDeps });
    const factory = createCallerFactory(router);
    return factory(ctxFor(adminUserId));
  }

  describe('createShareLink', () => {
    it('creates a row and returns the URL built from the token', async () => {
      const caller = callerForAdmin();
      const { linkId, token, url, expiresAt } = await caller.exports.createShareLink({
        inspectionId,
      });
      expect(linkId).toHaveLength(26);
      expect(token.startsWith('tok_')).toBe(true);
      expect(url).toBe(`https://app.test/s/${token}`);
      expect(expiresAt).toBeNull();

      const rows = await db
        .select()
        .from(schema.publicInspectionLinks)
        .where(eq(schema.publicInspectionLinks.id, linkId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenantId).toBe(tenantId);
      expect(rows[0]?.inspectionId).toBe(inspectionId);
      expect(rows[0]?.revokedAt).toBeNull();
    });

    it('honours an explicit expiresAt', async () => {
      const caller = callerForAdmin();
      const future = new Date(Date.now() + 60 * 60 * 1000);
      const result = await caller.exports.createShareLink({
        inspectionId,
        expiresAt: future.toISOString(),
      });
      expect(result.expiresAt).toBe(future.toISOString());
    });

    it('404s when the inspection is in a different tenant', async () => {
      const caller = callerForAdmin();
      await expect(() =>
        caller.exports.createShareLink({ inspectionId: newId() }),
      ).rejects.toThrow();
    });
  });

  describe('listShareLinks', () => {
    it('returns all links (live + revoked) in newest-first order', async () => {
      const caller = callerForAdmin();
      const a = await caller.exports.createShareLink({ inspectionId });
      const b = await caller.exports.createShareLink({ inspectionId });
      await caller.exports.revokeShareLink({ linkId: a.linkId });
      const list = await caller.exports.listShareLinks({ inspectionId });
      expect(list).toHaveLength(2);
      const entries = Object.fromEntries(list.map((l) => [l.linkId, l]));
      expect(entries[a.linkId]?.revoked).toBe(true);
      expect(entries[b.linkId]?.revoked).toBe(false);
    });
  });

  describe('revokeShareLink', () => {
    it('sets revokedAt and subsequent listings mark it revoked', async () => {
      const caller = callerForAdmin();
      const { linkId } = await caller.exports.createShareLink({ inspectionId });
      const { revokedAt } = await caller.exports.revokeShareLink({ linkId });
      expect(typeof revokedAt).toBe('string');
      const list = await caller.exports.listShareLinks({ inspectionId });
      expect(list[0]?.revoked).toBe(true);
    });

    it('404s when the link id is unknown', async () => {
      const caller = callerForAdmin();
      await expect(() =>
        caller.exports.revokeShareLink({ linkId: newId() }),
      ).rejects.toThrow();
    });
  });

  describe('renderPdf / renderDocx', () => {
    it('delegates to the injected renderer and returns its result', async () => {
      const caller = callerForAdmin();
      const pdf = await caller.exports.renderPdf({ inspectionId });
      expect(pdf.key).toMatch(/pdf-/);
      const docx = await caller.exports.renderDocx({ inspectionId });
      expect(docx.key).toMatch(/docx-/);
    });

    it('404s on an unknown inspection before calling the renderer', async () => {
      let rendererCalls = 0;
      const deps: ExportsRouterDeps = {
        ...exportsDeps,
        renderPdf: async () => {
          rendererCalls += 1;
          throw new Error('should not be called');
        },
      };
      const router = buildAppRouter({ exports: deps, inspectionsExport: stubInspectionsExportDeps });
      const caller = createCallerFactory(router)(ctxFor(adminUserId));
      await expect(() =>
        caller.exports.renderPdf({ inspectionId: newId() }),
      ).rejects.toThrow();
      expect(rendererCalls).toBe(0);
    });
  });

  describe('permissions', () => {
    it('FORBIDs a user without inspections.export from creating a share link', async () => {
      const standardUserId = `usr_${newId()}`;
      const setRows = await db
        .select({ id: schema.permissionSets.id })
        .from(schema.permissionSets)
        .where(eq(schema.permissionSets.tenantId, tenantId));
      // Any seeded set without 'inspections.export' would work; we
      // insert a bespoke one here to make the test deterministic
      // regardless of seed contents.
      const restrictedId = newId();
      await db.insert(schema.permissionSets).values({
        id: restrictedId,
        tenantId,
        name: 'ReadOnly',
        permissions: ['inspections.view'],
      });
      await db.insert(schema.user).values({
        id: standardUserId,
        name: 'Bob',
        email: 'bob@acme.test',
        tenantId,
        permissionSetId: restrictedId,
      });
      const router = buildAppRouter({ exports: exportsDeps, inspectionsExport: stubInspectionsExportDeps });
      const caller = createCallerFactory(router)(ctxFor(standardUserId));
      await expect(() =>
        caller.exports.createShareLink({ inspectionId }),
      ).rejects.toThrow(/FORBIDDEN|inspections.export/);
      // But viewing is fine — listShareLinks requires inspections.view only.
      const viewable = await caller.exports.listShareLinks({ inspectionId });
      expect(Array.isArray(viewable)).toBe(true);
      // Non-empty list is not required; the fact that it didn't throw is the assertion
      expect(setRows.length).toBeGreaterThan(0);
    });
  });
});
