/**
 * Unit tests for the fire due digest (FreeHS module B4, HSE review FS-3).
 *
 * Edge cases:
 *   - FS-J01: the digest collects failed / overdue / due-soon checks,
 *     failed doors, due FRA reviews, PEEP reviews and expiring marshal
 *     training for the right tenant, and emails every fireSafety.manage
 *     holder (admin via org.settings; standard users excluded)
 *   - FS-J02: a clean calendar sends nothing; a notify failure is
 *     swallowed (logged) and the run still reports the other sends
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { eq } from 'drizzle-orm';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFireDigests, runFireDueDigest, type FireDigest } from './fire-due-digest';

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

const logger = createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
const NOW = new Date('2026-08-03T06:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY_MS);

describe('fire-due-digest', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let adminEmail: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    adminId = `usr_${newId()}`;
    adminEmail = `alice-${tenantId}@acme.test`;
    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Alice Admin',
        email: adminEmail,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: `usr_${newId()}`,
        name: 'Stan Standard',
        email: `stan-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.standard,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  async function seedBuilding(name: string): Promise<string> {
    const id = newId();
    await db.insert(schema.fireBuildings).values({
      id,
      tenantId,
      name,
      createdBy: adminId,
    });
    return id;
  }

  it('FS-J01: collects every red/amber line for the tenant and emails the manage holders', async () => {
    const buildingId = await seedBuilding('Head Office');

    await db.insert(schema.fireLogbookChecks).values([
      {
        id: newId(),
        tenantId,
        buildingId,
        checkType: 'alarm_test',
        frequency: 'weekly',
        // Clock says fine — but the last result was a FAIL (FS-1).
        lastResult: 'fail',
        nextDueAt: daysAhead(6),
      },
      {
        id: newId(),
        tenantId,
        buildingId,
        checkType: 'emergency_lighting_function',
        frequency: 'monthly',
        lastResult: 'pass',
        nextDueAt: daysAgo(3),
      },
      {
        id: newId(),
        tenantId,
        buildingId,
        checkType: 'extinguisher_visual',
        frequency: 'monthly',
        nextDueAt: daysAhead(2), // inside the 7-day monthly warning window
      },
    ]);

    await db.insert(schema.fireDoors).values({
      id: newId(),
      tenantId,
      buildingId,
      doorRef: 'FD-1-01',
      locationKind: 'other',
      lastOutcome: 'fail',
      nextInspectionDueAt: daysAhead(300),
      createdBy: adminId,
    });

    await db.insert(schema.fireRiskAssessments).values({
      id: newId(),
      tenantId,
      buildingId,
      referenceNumber: 'FRA-0001',
      title: 'Head Office FRA',
      status: 'active',
      nextReviewAt: daysAgo(1),
      createdBy: adminId,
    });

    await db.insert(schema.firePeeps).values({
      id: newId(),
      tenantId,
      buildingId,
      personName: 'Jo Resident',
      nextReviewAt: daysAgo(2),
      createdBy: adminId,
    });

    await db.insert(schema.fireMarshals).values({
      id: newId(),
      tenantId,
      buildingId,
      userId: adminId,
      role: 'marshal',
      trainedAt: daysAgo(700),
      trainingExpiresAt: daysAhead(10),
      createdBy: adminId,
    });

    const digests = await collectFireDigests(db as never, NOW);
    expect(digests).toHaveLength(1);
    const d = digests[0];
    expect(d?.tenantId).toBe(tenantId);
    expect(d?.failedChecks).toEqual([{ buildingName: 'Head Office', label: 'alarm test' }]);
    expect(d?.overdueChecks).toEqual([
      { buildingName: 'Head Office', label: 'emergency lighting function' },
    ]);
    expect(d?.dueSoonChecks).toEqual([
      { buildingName: 'Head Office', label: 'extinguisher visual' },
    ]);
    expect(d?.failedDoors).toEqual([{ buildingName: 'Head Office', label: 'FD-1-01' }]);
    expect(d?.fraReviewsDue).toEqual([{ referenceNumber: 'FRA-0001', title: 'Head Office FRA' }]);
    expect(d?.peepReviewsDue).toBe(1);
    expect(d?.marshalsExpiring).toBe(1);

    const sent: Array<{ to: string; digest: FireDigest; viewUrl: string }> = [];
    const result = await runFireDueDigest({
      db: db as never,
      logger,
      appUrl: 'https://freehs.test',
      notify: async (recipient, digest, viewUrl) => {
        sent.push({ to: recipient.email, digest, viewUrl });
      },
      now: () => NOW,
    });
    expect(result.tenants).toBe(1);
    // Admin (via org.settings) + the seeded Manager set has fireSafety.manage
    // but no users — so exactly one email, to Alice, never to Stan.
    expect(sent.map((s) => s.to)).toEqual([adminEmail]);
    // A recipient with no stated language falls back to English.
    expect(sent[0]?.viewUrl).toBe('https://freehs.test/en/fire-safety');
  });

  it('DOC-A01: the digest link lands in the reader own language', async () => {
    // Ten workers hardcoded /en/ in the links they emailed, each beside a
    // locale they were already carrying. `appLink` is the one way now, and
    // packages/shared/src/app-link.test.ts fails on the eleventh.
    const buildingId = await seedBuilding('Head Office');
    await db.insert(schema.fireLogbookChecks).values({
      id: newId(),
      tenantId,
      buildingId,
      checkType: 'alarm_test',
      frequency: 'weekly',
      nextDueAt: new Date(NOW.getTime() - 86_400_000),
    });
    await db.update(schema.user).set({ locale: 'fr' }).where(eq(schema.user.email, adminEmail));

    const sent: string[] = [];
    await runFireDueDigest({
      db: db as never,
      logger,
      appUrl: 'https://freehs.test',
      notify: async (_recipient, _digest, viewUrl) => {
        sent.push(viewUrl);
      },
      now: () => NOW,
    });
    expect(sent).toEqual(['https://freehs.test/fr/fire-safety']);
  });

  it('FS-J02: a clean calendar sends nothing; one failing notify does not sink the run', async () => {
    const buildingId = await seedBuilding('Quiet Depot');
    await db.insert(schema.fireLogbookChecks).values({
      id: newId(),
      tenantId,
      buildingId,
      checkType: 'alarm_test',
      frequency: 'weekly',
      lastResult: 'pass',
      nextDueAt: daysAhead(6),
    });

    const sent: string[] = [];
    const clean = await runFireDueDigest({
      db: db as never,
      logger,
      appUrl: 'https://freehs.test',
      notify: async (recipient) => {
        sent.push(recipient.email);
      },
      now: () => NOW,
    });
    expect(clean).toEqual({ tenants: 0, emails: 0 });
    expect(sent).toHaveLength(0);

    // Second tenant with a failure — its digest sends even when the
    // notify for the first recipient throws.
    const otherTenant = newId();
    await db
      .insert(schema.tenants)
      .values({ id: otherTenant, name: 'Beta', slug: `b-${otherTenant}` });
    const sets = await seedDefaultPermissionSets(db as never, otherTenant);
    const bossId = `usr_${newId()}`;
    const boss2Id = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: bossId,
        name: 'Bea Boss',
        email: `bea-${otherTenant}@beta.test`,
        tenantId: otherTenant,
        permissionSetId: sets.administrator,
      },
      {
        id: boss2Id,
        name: 'Cal Cover',
        email: `cal-${otherTenant}@beta.test`,
        tenantId: otherTenant,
        permissionSetId: sets.administrator,
      },
    ]);
    const betaBuilding = newId();
    await db.insert(schema.fireBuildings).values({
      id: betaBuilding,
      tenantId: otherTenant,
      name: 'Beta Works',
      createdBy: bossId,
    });
    await db.insert(schema.fireLogbookChecks).values({
      id: newId(),
      tenantId: otherTenant,
      buildingId: betaBuilding,
      checkType: 'alarm_test',
      frequency: 'weekly',
      lastResult: 'fail',
      nextDueAt: daysAhead(6),
    });

    let calls = 0;
    const delivered: string[] = [];
    const result = await runFireDueDigest({
      db: db as never,
      logger,
      appUrl: 'https://freehs.test',
      notify: async (recipient) => {
        calls += 1;
        if (calls === 1) throw new Error('smtp down');
        delivered.push(recipient.email);
      },
      now: () => NOW,
    });
    expect(result.tenants).toBe(1);
    expect(result.emails).toBe(1);
    expect(delivered).toHaveLength(1);
  });
});
