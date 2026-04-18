/**
 * Tests for the PDF renderer. Uses a pglite DB + an in-memory storage
 * mock, and the {@link RenderDeps.puppeteerRender} injection hook to
 * avoid launching chromium.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderInspectionPdf, pdfObjectKey } from './pdf';
import type { Database } from '@forma360/db/client';
import type { Storage } from '@forma360/shared/storage';

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

/** In-memory Storage fake that records uploads into a Map. */
function memStorage(): Storage & { uploads: Map<string, Uint8Array> } {
  const uploads = new Map<string, Uint8Array>();
  const storage: Storage & { uploads: Map<string, Uint8Array> } = {
    uploads,
    async getSignedUploadUrl({ key }) {
      return `mem://${key}`;
    },
    async getSignedDownloadUrl({ key }) {
      return `mem://${key}`;
    },
    async deleteObject({ key }) {
      uploads.delete(key);
    },
  };
  // Wrap global fetch to capture the PUTs. Scoped per-test via setup.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.startsWith('mem://') && init?.method === 'PUT') {
      const key = url.slice('mem://'.length);
      const body = init.body as Uint8Array | undefined;
      if (body !== undefined) uploads.set(key, body);
      return new Response(null, { status: 200 });
    }
    return originalFetch(...args);
  }) as typeof fetch;
  return storage;
}

describe('renderInspectionPdf', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let inspectionId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = 'T1234567890123456789012345';
    inspectionId = 'I1234567890123456789012345';
    const templateId = 'TPL23456789012345678901234';
    const versionId = 'V12345678901234567890123456'.slice(0, 26);
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    await db.insert(schema.templates).values({ id: templateId, tenantId, name: "Tpl", createdBy: "u1" });
    await db.insert(schema.templateVersions).values({
      id: versionId,
      tenantId,
      templateId,
      versionNumber: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: { schemaVersion: '1', title: 'Tpl', pages: [], settings: {}, customResponseSets: [] } as any,
      publishedAt: new Date(),
    });
    await db.insert(schema.inspections).values({
      id: inspectionId,
      tenantId,
      templateId,
      templateVersionId: versionId,
      title: 'PDF test',
      accessSnapshot: {
        groups: [],
        sites: [],
        permissions: [],
        snapshotAt: new Date().toISOString(),
      },
      createdBy: 'u1',
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('uses the puppeteerRender override, uploads, and returns an R2 key', async () => {
    const storage = memStorage();
    const fakeBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

    const { key, bytes, stub } = await renderInspectionPdf(
      {
        db: db as unknown as Database,
        storage,
        appUrl: 'https://app.test',
        renderSharedSecret: 'x'.repeat(32),
        puppeteerRender: async () => fakeBytes,
      },
      { tenantId, inspectionId },
    );

    expect(key).toMatch(new RegExp(`^${tenantId}/inspections/${inspectionId}/pdf-[0-9a-f]{64}\\.pdf$`));
    expect(bytes).toBe(fakeBytes.length);
    expect(stub).toBe(true); // 5 bytes is < 1500-byte stub threshold
    expect(storage.uploads.get(key)).toEqual(fakeBytes);
  });

  it('produces a valid-looking %PDF-1.4 stub when chromium is unavailable', async () => {
    const storage = memStorage();

    const { key } = await renderInspectionPdf(
      {
        db: db as unknown as Database,
        storage,
        appUrl: 'https://app.test',
        renderSharedSecret: 'x'.repeat(32),
        // No puppeteerRender override → the chromium dynamic-import fails
        // in the test environment → stub path engages.
      },
      { tenantId, inspectionId },
    );

    const uploaded = storage.uploads.get(key);
    if (uploaded === undefined) throw new Error('upload missing');
    const header = new TextDecoder().decode(uploaded.slice(0, 8));
    expect(header.startsWith('%PDF-1.4')).toBe(true);
    // "%%EOF" trailer present.
    const tail = new TextDecoder().decode(uploaded.slice(-8));
    expect(tail).toContain('%%EOF');
  });

  it('throws a descriptive error when the inspection does not exist', async () => {
    const storage = memStorage();
    await expect(() =>
      renderInspectionPdf(
        {
          db: db as unknown as Database,
          storage,
          appUrl: 'https://app.test',
          renderSharedSecret: 'x'.repeat(32),
          puppeteerRender: async () => new Uint8Array(10),
        },
        { tenantId, inspectionId: 'I' + '0'.repeat(25) },
      ),
    ).rejects.toThrow(/Inspection not found/);
  });

  it('produces a deterministic cache key for the same content', async () => {
    const storage = memStorage();
    const deps = {
      db: db as unknown as Database,
      storage,
      appUrl: 'https://app.test',
      renderSharedSecret: 'x'.repeat(32),
      puppeteerRender: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    };
    const a = await renderInspectionPdf(deps, { tenantId, inspectionId });
    const b = await renderInspectionPdf(deps, { tenantId, inspectionId });
    expect(a.key).toBe(b.key);
  });
});

describe('pdfObjectKey', () => {
  it('follows the documented layout', () => {
    expect(pdfObjectKey('T1', 'I1', 'abc')).toBe('T1/inspections/I1/pdf-abc.pdf');
  });
});
