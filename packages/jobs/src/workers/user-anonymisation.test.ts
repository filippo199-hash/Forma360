/**
 * Anonymisation cascade tests (platform review PF-31 — the worker was a
 * logged no-op).
 *
 * Edge cases:
 *   - UA-J01: sessions/accounts deleted; signature strokes + signer-name
 *     snapshots blanked; the signed FACT (row, status) retained; the
 *     personal notification inbox deleted; other users untouched
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANONYMISED_SIGNER_NAME, runUserAnonymisationCascade } from './user-anonymisation';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
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

describe('user-anonymisation cascade (PF-31)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
  });
  afterEach(async () => {
    await client.close();
  });

  it('UA-J01: scrubs auth artefacts + strokes, keeps the signed fact', async () => {
    const tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'T', slug: `t-${tenantId}` });
    const psId = newId();
    await db
      .insert(schema.permissionSets)
      .values({ id: psId, tenantId, name: 'S', permissions: [] });
    const targetId = `usr_${newId()}`;
    const otherId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      { id: targetId, name: 'Tina Target', email: `t-${tenantId}@x.test`, tenantId, permissionSetId: psId },
      { id: otherId, name: 'Oscar Other', email: `o-${tenantId}@x.test`, tenantId, permissionSetId: psId },
    ]);
    await db.insert(schema.session).values({
      id: newId(),
      token: `tok-${newId()}`,
      userId: targetId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // A signed inspection slot for each user.
    const templateId = newId();
    const versionId = newId();
    await db.insert(schema.templates).values({ id: templateId, tenantId, name: 'T', createdBy: targetId });
    await db.insert(schema.templateVersions).values({
      id: versionId,
      tenantId,
      templateId,
      versionNumber: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: { schemaVersion: '1', title: 'T', pages: [], settings: {}, customResponseSets: [] } as any,
      publishedAt: new Date(),
    });
    const inspectionId = newId();
    await db.insert(schema.inspections).values({
      id: inspectionId,
      tenantId,
      templateId,
      templateVersionId: versionId,
      title: 'Audit',
      accessSnapshot: { groups: [], sites: [], permissions: [], snapshotAt: new Date().toISOString() },
      createdBy: targetId,
    });
    for (const [slot, uid, name] of [
      [0, targetId, 'Tina Target'],
      [1, otherId, 'Oscar Other'],
    ] as const) {
      await db.insert(schema.inspectionSignatures).values({
        id: newId(),
        tenantId,
        inspectionId,
        slotId: newId(),
        slotIndex: slot,
        signerUserId: uid,
        signerName: name,
        signatureData: 'data:image/png;base64,STROKES',
        signedAt: new Date(),
      });
    }
    await db.insert(schema.notifications).values({
      id: newId(),
      tenantId,
      userId: targetId,
      kind: 'x',
      title: 'personal',
    });

    const result = await runUserAnonymisationCascade(db as never, tenantId, targetId);
    expect(result.sessions).toBe(1);
    expect(result.signatures).toBe(1);
    expect(result.notifications).toBe(1);

    const sigs = await db
      .select()
      .from(schema.inspectionSignatures)
      .where(eq(schema.inspectionSignatures.inspectionId, inspectionId));
    const target = sigs.find((s) => s.signerUserId === targetId);
    const other = sigs.find((s) => s.signerUserId === otherId);
    // The signed FACT survives; the stroke + name snapshot do not.
    expect(target?.signedAt).not.toBeNull();
    expect(target?.signerName).toBe(ANONYMISED_SIGNER_NAME);
    expect(target?.signatureData).toBe('');
    // Other users untouched.
    expect(other?.signerName).toBe('Oscar Other');
    expect(other?.signatureData).toContain('STROKES');

    const sessions = await db.select().from(schema.session).where(eq(schema.session.userId, targetId));
    expect(sessions).toHaveLength(0);
  });
});
