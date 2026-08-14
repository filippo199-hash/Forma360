/**
 * Tests for the PDF renderer. Uses a pglite DB + an in-memory storage
 * mock, and the {@link RenderDeps.puppeteerRender} injection hook to
 * avoid launching chromium.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderDashboardPdf, renderDrillPdf, renderInspectionPdf, pdfObjectKey } from './pdf';
import { loadDrillSnapshot } from './snapshot';
import type { Database } from '@forma360/db/client';
import type { Storage } from '@forma360/shared/storage';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

async function bootDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
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
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
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
    await db
      .insert(schema.templates)
      .values({ id: templateId, tenantId, name: 'Tpl', createdBy: 'u1' });
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

    expect(key).toMatch(
      new RegExp(`^${tenantId}/inspections/${inspectionId}/pdf-[0-9a-f]{64}\\.pdf$`),
    );
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

describe('renderDashboardPdf', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  const tenantId = 'T1234567890123456789012345';
  const dashboardId = 'D1234567890123456789012345';
  const ownerId = 'usr_dashboard_pdf_owner';

  const spec = {
    version: '1',
    widgets: [
      { id: 'open-actions', kind: 'kpi', title: 'Open actions', source: 'actions', metric: 'open' },
    ],
  };

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const permissionSetId = 'P1234567890123456789012345';
    await db.insert(schema.permissionSets).values({
      id: permissionSetId,
      tenantId,
      name: 'Viewer',
      permissions: ['analytics.view'],
    });
    await db.insert(schema.user).values({
      id: ownerId,
      name: 'Olive Owner',
      email: 'olive@acme.test',
      tenantId,
      permissionSetId,
    });
    await db.insert(schema.dashboards).values({
      id: dashboardId,
      tenantId,
      ownerUserId: ownerId,
      title: 'Weekly safety overview',
      spec,
      status: 'published',
    });
  });

  afterEach(async () => {
    await client.close();
  });

  function deps(storage: ReturnType<typeof memStorage>) {
    return {
      db: db as unknown as Database,
      storage,
      appUrl: 'https://app.test',
      renderSharedSecret: 'x'.repeat(32),
      puppeteerRender: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    };
  }

  it('uploads to the documented key layout and returns it', async () => {
    const storage = memStorage();
    const { key, bytes } = await renderDashboardPdf(deps(storage), { tenantId, dashboardId });
    expect(key).toMatch(
      new RegExp(`^${tenantId}/dashboards/${dashboardId}/pdf-[0-9a-f]{64}\\.pdf$`),
    );
    expect(bytes).toBe(4);
    expect(storage.uploads.has(key)).toBe(true);
  });

  it('keys on (spec + updatedAt + title): stable across renders, fresh on change', async () => {
    const storage = memStorage();
    const a = await renderDashboardPdf(deps(storage), { tenantId, dashboardId });
    const b = await renderDashboardPdf(deps(storage), { tenantId, dashboardId });
    expect(a.key).toBe(b.key);
    await db
      .update(schema.dashboards)
      .set({ title: 'Renamed overview', updatedAt: new Date() })
      .where(eq(schema.dashboards.id, dashboardId));
    const c = await renderDashboardPdf(deps(storage), { tenantId, dashboardId });
    expect(c.key).not.toBe(a.key);
  });

  it('throws a descriptive error when the dashboard is missing or cross-tenant', async () => {
    const storage = memStorage();
    await expect(() =>
      renderDashboardPdf(deps(storage), { tenantId, dashboardId: 'D' + '0'.repeat(25) }),
    ).rejects.toThrow(/Dashboard not found/);
    await expect(() =>
      renderDashboardPdf(deps(storage), { tenantId: 'T' + '9'.repeat(25), dashboardId }),
    ).rejects.toThrow(/Dashboard not found/);
  });
});

describe('renderDrillPdf', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  const tenantId = 'T1234567890123456789012345';
  const buildingId = 'B1234567890123456789012345';
  const drillId = 'DR123456789012345678901234';
  const conductorId = 'usr_drill_pdf_conductor';

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const permissionSetId = 'P1234567890123456789012345';
    await db.insert(schema.permissionSets).values({
      id: permissionSetId,
      tenantId,
      name: 'Viewer',
      permissions: ['fireSafety.view'],
    });
    await db.insert(schema.user).values({
      id: conductorId,
      name: 'Wanda Warden',
      email: 'wanda@acme.test',
      tenantId,
      permissionSetId,
    });
    await db.insert(schema.fireBuildings).values({
      id: buildingId,
      tenantId,
      name: 'Unit 4 Office',
      address: '1 Works Lane',
      createdBy: conductorId,
    });
    await db.insert(schema.fireDrills).values({
      id: drillId,
      tenantId,
      buildingId,
      conductedAt: new Date('2026-08-01T10:30:00.000Z'),
      conductedBy: conductorId,
      evacuationSeconds: 154,
      peoplePresent: 40,
      peopleAccountedFor: 40,
      rollComplete: true,
      notes: 'Alarm raised from call point 3.',
      lessonsLearned: 'Stairwell B door was propped open.',
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('loadDrillSnapshot resolves the drill, building and names', async () => {
    const snap = await loadDrillSnapshot(db as unknown as Database, { tenantId, drillId });
    if (snap === null) throw new Error('snapshot missing');
    expect(snap.drill.id).toBe(drillId);
    expect(snap.drill.conductedAt).toBe('2026-08-01T10:30:00.000Z');
    expect(snap.drill.conductedByName).toBe('Wanda Warden');
    expect(snap.drill.evacuationSeconds).toBe(154);
    expect(snap.drill.rollComplete).toBe(true);
    expect(snap.building).toEqual({ name: 'Unit 4 Office', address: '1 Works Lane' });
    expect(snap.tenantName).toBe('Acme');
    expect(await loadDrillSnapshot(db as unknown as Database, { tenantId, drillId: 'DR' + '0'.repeat(24) })).toBeNull();
    expect(
      await loadDrillSnapshot(db as unknown as Database, { tenantId: 'T' + '9'.repeat(25), drillId }),
    ).toBeNull();
  });

  it('uploads to the documented key layout and returns it', async () => {
    const storage = memStorage();
    const { key, bytes } = await renderDrillPdf(
      {
        db: db as unknown as Database,
        storage,
        appUrl: 'https://app.test',
        renderSharedSecret: 'x'.repeat(32),
        puppeteerRender: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      },
      { tenantId, drillId },
    );
    expect(key).toMatch(
      new RegExp(`^${tenantId}/fire-safety/${drillId}/drill-pdf-[0-9a-f]{64}\\.pdf$`),
    );
    expect(bytes).toBe(4);
    expect(storage.uploads.has(key)).toBe(true);
  });

  it('throws a descriptive error when the drill is missing or cross-tenant', async () => {
    const storage = memStorage();
    const deps = {
      db: db as unknown as Database,
      storage,
      appUrl: 'https://app.test',
      renderSharedSecret: 'x'.repeat(32),
      puppeteerRender: async () => new Uint8Array(4),
    };
    await expect(() =>
      renderDrillPdf(deps, { tenantId, drillId: 'DR' + '0'.repeat(24) }),
    ).rejects.toThrow(/Fire drill not found/);
    await expect(() =>
      renderDrillPdf(deps, { tenantId: 'T' + '9'.repeat(25), drillId }),
    ).rejects.toThrow(/Fire drill not found/);
  });
});

describe('pdfObjectKey', () => {
  it('follows the documented layout', () => {
    expect(pdfObjectKey('T1', 'I1', 'abc')).toBe('T1/inspections/I1/pdf-abc.pdf');
  });
});
