/**
 * Unit tests for share-token generation + validation.
 *
 * Uses pglite so the token-lifecycle (valid / expired / revoked /
 * forged / wrong-length) hits the real DB schema — shape changes to
 * `public_inspection_links` will be caught here.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateShareToken,
  validateShareToken,
  revokeShareLinkRow,
  buildShareUrl,
  SHARE_TOKEN_BYTES,
} from './share';
import type { Database } from '@forma360/db/client';

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

describe('generateShareToken', () => {
  it('produces a URL-safe base64url string of the documented length', () => {
    const t = generateShareToken();
    // 32 bytes → 43 chars of base64url without padding.
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces distinct tokens on each call', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateShareToken());
    expect(seen.size).toBe(500);
  });

  it('uses the expected byte count', () => {
    expect(SHARE_TOKEN_BYTES).toBe(32);
  });
});

describe('validateShareToken', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let inspectionId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = '01HYZTENANT000000000000001';
    inspectionId = '01HYZINSPECTION00000000001';
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });

    // Minimum-viable template + version + inspection to satisfy FKs.
    const templateId = '01HYZTEMPLATE00000000000001'.slice(0, 26);
    const versionId = 'V12345678901234567890123456'.slice(0, 26);
    await db.insert(schema.templates).values({
      id: templateId,
      tenantId,
      name: 'Tpl',
      createdBy: 'u1',
    });
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
      title: 'Test',
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

  async function insertLink(input: {
    token: string;
    expiresAt?: Date | null;
    revokedAt?: Date | null;
  }) {
    const id = `LNK${'A'.repeat(23)}`;
    await db.insert(schema.publicInspectionLinks).values({
      id,
      tenantId,
      inspectionId,
      token: input.token,
      expiresAt: input.expiresAt ?? null,
      revokedAt: input.revokedAt ?? null,
      createdBy: 'u1',
    });
    return id;
  }

  it('returns claims for a valid, unexpired, un-revoked token', async () => {
    const token = generateShareToken();
    const linkId = await insertLink({ token });
    const claims = await validateShareToken(db as unknown as Database, token);
    expect(claims).not.toBeNull();
    expect(claims?.linkId).toBe(linkId);
    expect(claims?.inspectionId).toBe(inspectionId);
    expect(claims?.tenantId).toBe(tenantId);
  });

  it('returns null when the token is expired', async () => {
    const token = generateShareToken();
    const now = new Date('2026-04-18T12:00:00Z');
    const past = new Date('2026-04-18T11:59:59Z');
    await insertLink({ token, expiresAt: past });
    const claims = await validateShareToken(db as unknown as Database, token, now);
    expect(claims).toBeNull();
  });

  it('returns null when the token is revoked', async () => {
    const token = generateShareToken();
    const now = new Date('2026-04-18T12:00:00Z');
    await insertLink({ token, revokedAt: new Date('2026-04-18T10:00:00Z') });
    const claims = await validateShareToken(db as unknown as Database, token, now);
    expect(claims).toBeNull();
  });

  it('returns null for a forged / unknown token', async () => {
    const claims = await validateShareToken(
      db as unknown as Database,
      generateShareToken(),
    );
    expect(claims).toBeNull();
  });

  it('returns null for a wrong-length token without hitting the DB', async () => {
    const claims = await validateShareToken(db as unknown as Database, 'short');
    expect(claims).toBeNull();
  });

  it('returns claims when expiresAt is in the future', async () => {
    const token = generateShareToken();
    const future = new Date(Date.now() + 60_000);
    await insertLink({ token, expiresAt: future });
    const claims = await validateShareToken(db as unknown as Database, token);
    expect(claims).not.toBeNull();
  });
});

describe('revokeShareLinkRow', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let inspectionId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = '01HYZTENANT000000000000001';
    inspectionId = '01HYZINSPECTION00000000001';
    const templateId = '01HYZTEMPLATE00000000000001'.slice(0, 26);
    const versionId = '01HYZVERSION0000000000002A';
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
      title: 'Test',
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

  it('marks the row as revoked and subsequent validate returns null', async () => {
    const token = generateShareToken();
    const linkId = 'LNK' + 'A'.repeat(23);
    await db.insert(schema.publicInspectionLinks).values({
      id: linkId,
      tenantId,
      inspectionId,
      token,
      createdBy: 'u1',
    });
    const ok = await revokeShareLinkRow(db as unknown as Database, { tenantId, linkId });
    expect(ok).toBe(true);
    const claims = await validateShareToken(db as unknown as Database, token);
    expect(claims).toBeNull();
  });

  it('returns false when the row does not exist in the tenant', async () => {
    const ok = await revokeShareLinkRow(db as unknown as Database, {
      tenantId,
      linkId: 'LNK' + 'X'.repeat(23),
    });
    expect(ok).toBe(false);
  });
});

describe('buildShareUrl', () => {
  it('strips trailing slashes from the base', () => {
    expect(buildShareUrl('https://app.test/', 'abc')).toBe('https://app.test/s/abc');
    expect(buildShareUrl('https://app.test///', 'abc')).toBe('https://app.test/s/abc');
    expect(buildShareUrl('https://app.test', 'abc')).toBe('https://app.test/s/abc');
  });
});
