/**
 * Tests for the Word renderer. Uses pglite + an in-memory storage fake;
 * asserts the generated file is a valid ZIP (docx is a zip container).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderInspectionDocx, docxObjectKey } from './docx';
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
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
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

describe('renderInspectionDocx', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let inspectionId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = 'T1234567890123456789012345';
    inspectionId = 'I1234567890123456789012345';
    const templateId = 'TPL23456789012345678901234';
    const versionId = 'V12345678901234567890123499'.slice(0, 26);
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    await db.insert(schema.templates).values({ id: templateId, tenantId, name: "Tpl", createdBy: "u1" });
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
      title: 'DOCX test',
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

  it('produces a ZIP-magic docx and uploads under the hashed key', async () => {
    const storage = memStorage();
    const result = await renderInspectionDocx(
      { db: db as unknown as Database, storage },
      { tenantId, inspectionId },
    );

    expect(result.key).toMatch(
      new RegExp(`^${tenantId}/inspections/${inspectionId}/docx-[0-9a-f]{64}\\.docx$`),
    );
    const bytes = storage.uploads.get(result.key);
    if (bytes === undefined) throw new Error('upload missing');
    // ZIP local-file header magic: "PK\x03\x04".
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });
});

describe('docxObjectKey', () => {
  it('follows the documented layout', () => {
    expect(docxObjectKey('T1', 'I1', 'abc')).toBe('T1/inspections/I1/docx-abc.docx');
  });
});
