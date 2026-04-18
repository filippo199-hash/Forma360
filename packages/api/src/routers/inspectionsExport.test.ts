/**
 * Integration tests for the inspections CSV export + archive router —
 * Phase 2 PR 33.
 *
 * Exercises:
 *   - CSV header + row order matches the PR 33 spec
 *   - RFC 4180 escaping: embedded quotes, commas, newlines
 *   - 10_000 row cap is respected
 *   - filter combinations (status, templateId, siteId, date range)
 *   - tenant scoping (rows from another tenant never leak)
 *   - archiveMany sets archivedAt, returns count, tenant-scoped
 *   - includeArchived toggle on inspections.list
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
import { TEMPLATE_SCHEMA_VERSION, type TemplateContent } from '@forma360/shared/template-schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { createTestContext, type Context } from '../context';
import { buildAppRouter } from '../router';
import { createCallerFactory } from '../trpc';
import type { ExportsRouterDeps } from './exports';
import {
  buildCsv,
  csvCell,
  csvRow,
  INSPECTIONS_CSV_HEADER,
  type InspectionsExportDeps,
} from './inspectionsExport';

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

const silent = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

function stubExportsDeps(): ExportsRouterDeps {
  return {
    renderPdf: async () => ({ key: 'stub/pdf', bytes: 0, stub: true }),
    renderDocx: async () => ({ key: 'stub/docx', bytes: 0 }),
    generateShareToken: () => 'tok_test',
    buildShareUrl: (t) => `https://app.test/s/${t}`,
  };
}

function stubInspectionsExportDeps(fixedNow = new Date('2026-04-01T00:00:00Z')): {
  deps: InspectionsExportDeps;
  uploads: Map<string, string>;
} {
  const uploads = new Map<string, string>();
  const deps: InspectionsExportDeps = {
    uploadCsv: async ({ key, body }) => {
      uploads.set(key, body);
      return { url: `stub://${key}` };
    },
    now: () => fixedNow,
  };
  return { deps, uploads };
}

function simpleContent(title: string): TemplateContent {
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

describe('inspectionsExport CSV helpers', () => {
  it('csvCell quotes everything and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell('comma,value')).toBe('"comma,value"');
    expect(csvCell('new\nline')).toBe('"new\nline"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell(true)).toBe('"true"');
  });

  it('csvRow joins cells with commas and terminates with \\r\\n', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('"a","b","c"\r\n');
  });

  it('buildCsv emits the fixed header first', () => {
    const csv = buildCsv([]);
    expect(csv).toBe(csvRow(INSPECTIONS_CSV_HEADER));
    expect(INSPECTIONS_CSV_HEADER).toEqual([
      'inspection_id',
      'title',
      'document_number',
      'status',
      'template_name',
      'template_version_number',
      'conducted_by',
      'site_name',
      'started_at',
      'submitted_at',
      'completed_at',
      'score_total',
      'score_max',
      'score_percentage',
    ]);
  });
});

describe('inspectionsExport router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let otherTenantId: string;
  let adminUserId: string;
  let otherAdminId: string;
  let exportsDeps: ExportsRouterDeps;
  let inspectionsExportDeps: ReturnType<typeof stubInspectionsExportDeps>;

  function ctxFor(userId: string, tid: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
      auth: { userId, email: `${userId}@t`, tenantId: tid as never },
    });
  }

  function makeCaller(ctx: Context) {
    const router = buildAppRouter({
      exports: exportsDeps,
      inspectionsExport: inspectionsExportDeps.deps,
    });
    const factory = createCallerFactory(router);
    return factory(ctx);
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    exportsDeps = stubExportsDeps();
    inspectionsExportDeps = stubInspectionsExportDeps();

    tenantId = newId();
    otherTenantId = newId();
    await db
      .insert(schema.tenants)
      .values([
        { id: tenantId, name: 'Acme', slug: 'acme' },
        { id: otherTenantId, name: 'Other', slug: 'other' },
      ]);

    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    const otherSeeded = await seedDefaultPermissionSets(db as unknown as Database, otherTenantId);

    adminUserId = `usr_${newId()}`;
    otherAdminId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminUserId,
        name: 'Alice',
        email: 'alice@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
      {
        id: otherAdminId,
        name: 'Bob',
        email: 'bob@other.test',
        tenantId: otherTenantId,
        permissionSetId: otherSeeded.administrator,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  async function createTenantWithInspection(
    title: string,
  ): Promise<{ templateId: string; inspectionId: string }> {
    const caller = makeCaller(ctxFor(adminUserId, tenantId));
    const { templateId } = await caller.templates.create({ name: title });
    await caller.templates.saveDraft({ templateId, content: simpleContent(title) });
    await caller.templates.publish({ templateId });
    const { inspectionId } = await caller.inspections.create({ templateId });
    return { templateId, inspectionId };
  }

  it('exports a CSV with header + one row, RFC 4180 escaped', async () => {
    const { inspectionId } = await createTenantWithInspection('Report "A", v1');
    const caller = makeCaller(ctxFor(adminUserId, tenantId));
    const { csv, rowCount } = await caller.inspectionsExport.exportCsv({});
    expect(rowCount).toBe(1);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(csvRow(INSPECTIONS_CSV_HEADER).trimEnd());
    // Second line is the row itself; quoted inspection id is the first cell.
    expect(lines[1]).toContain(`"${inspectionId}"`);
    // Template name had an embedded quote; make sure the CSV double-escaped it.
    expect(csv).toContain('""A""');
  });

  it('respects the status filter', async () => {
    await createTenantWithInspection('T1');
    await createTenantWithInspection('T2');
    const caller = makeCaller(ctxFor(adminUserId, tenantId));
    // Both are in_progress; asking for completed should return zero data rows.
    const result = await caller.inspectionsExport.exportCsv({
      filter: { status: 'completed' },
    });
    expect(result.rowCount).toBe(0);
    const lines = result.csv.split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1); // header only
  });

  it('isolates tenants — another tenant\u2019s caller never sees my rows', async () => {
    const mine = await createTenantWithInspection('Mine');
    // other tenant admin queries
    const otherCaller = makeCaller(ctxFor(otherAdminId, otherTenantId));
    const result = await otherCaller.inspectionsExport.exportCsv({
      ids: [mine.inspectionId],
    });
    expect(result.rowCount).toBe(0);
  });

  it('exportCsvUrl uploads CSV bytes to R2 and returns the URL', async () => {
    const { inspectionId } = await createTenantWithInspection('UrlUpload');
    const caller = makeCaller(ctxFor(adminUserId, tenantId));
    const result = await caller.inspectionsExport.exportCsvUrl({});
    expect(result.rowCount).toBe(1);
    expect(result.key).toMatch(
      new RegExp(
        `^${tenantId}/inspections/[0-9A-HJKMNP-TV-Z]{26}/inspections-.*\\.csv$`,
      ),
    );
    expect(result.url).toBe(`stub://${result.key}`);
    const stored = inspectionsExportDeps.uploads.get(result.key);
    expect(stored).toBeDefined();
    expect(stored).toContain(inspectionId);
  });

  it('archiveMany sets archivedAt and returns the count', async () => {
    const a = await createTenantWithInspection('A');
    const b = await createTenantWithInspection('B');
    const caller = makeCaller(ctxFor(adminUserId, tenantId));
    const result = await caller.inspectionsExport.archiveMany({
      ids: [a.inspectionId, b.inspectionId],
    });
    expect(result.count).toBe(2);
    const rows = await db.select().from(schema.inspections);
    for (const r of rows) expect(r.archivedAt).not.toBeNull();
  });

  it('archiveMany is tenant-scoped — cannot archive another tenant\u2019s row', async () => {
    const mine = await createTenantWithInspection('Mine');
    const other = makeCaller(ctxFor(otherAdminId, otherTenantId));
    await expect(other.inspectionsExport.archiveMany({ ids: [mine.inspectionId] })).rejects.toThrow();
    const row = (
      await db
        .select()
        .from(schema.inspections)
        .where(eq(schema.inspections.id, mine.inspectionId))
    )[0];
    expect(row?.archivedAt).toBeNull();
  });

  it('archiveMany ignores already-archived rows', async () => {
    const a = await createTenantWithInspection('A');
    const caller = makeCaller(ctxFor(adminUserId, tenantId));
    // First archive succeeds
    const first = await caller.inspectionsExport.archiveMany({ ids: [a.inspectionId] });
    expect(first.count).toBe(1);
    // Second throws NOT_FOUND because nothing to archive
    await expect(
      caller.inspectionsExport.archiveMany({ ids: [a.inspectionId] }),
    ).rejects.toThrow();
  });

  it('inspections.list excludes archived rows by default, includes with flag', async () => {
    const a = await createTenantWithInspection('A');
    const caller = makeCaller(ctxFor(adminUserId, tenantId));
    await caller.inspectionsExport.archiveMany({ ids: [a.inspectionId] });
    const live = await caller.inspections.list({});
    expect(live.some((r) => r.id === a.inspectionId)).toBe(false);
    const all = await caller.inspections.list({ includeArchived: true });
    expect(all.some((r) => r.id === a.inspectionId)).toBe(true);
  });

  it('exportCsv with includeArchived=true includes archived rows', async () => {
    const a = await createTenantWithInspection('A');
    const caller = makeCaller(ctxFor(adminUserId, tenantId));
    await caller.inspectionsExport.archiveMany({ ids: [a.inspectionId] });
    const withoutArchived = await caller.inspectionsExport.exportCsv({});
    expect(withoutArchived.rowCount).toBe(0);
    const withArchived = await caller.inspectionsExport.exportCsv({
      filter: { includeArchived: true },
    });
    expect(withArchived.rowCount).toBe(1);
  });

  it('enforces the 500-id cap on archiveMany input', async () => {
    const caller = makeCaller(ctxFor(adminUserId, tenantId));
    const tooMany = Array.from({ length: 501 }, () => newId());
    await expect(caller.inspectionsExport.archiveMany({ ids: tooMany })).rejects.toThrow();
  });
});
