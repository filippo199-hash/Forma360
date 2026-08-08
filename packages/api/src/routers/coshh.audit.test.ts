/**
 * COSHH — audit fix verification (8 August 2026).
 *
 * The audit found five defects. The regulatory publish gate — the thing
 * this module exists for — was sound; the boundaries around it were not.
 * These tests prove each fix and each fails on the unfixed code.
 *
 *   - CO-S05  CRITICAL. Another tenant's people could be enrolled onto the
 *             health surveillance register and their names read back off
 *             it. First cross-tenant disclosure these audits have found,
 *             and the data is who is under health surveillance for a
 *             hazardous substance — special-category data under UK GDPR
 *             Article 9.
 *   - CO-A02  `sds.attach` accepted a storage key from another tenant.
 *   - CO-A01  the AI extraction was `z.unknown()` cast into a typed column
 *             with `as never`, under a comment claiming it had already been
 *             validated. The HTTP route does validate; it is not the only
 *             way in.
 *   - CO-S03  a failed LEV thorough examination could be cleared by setting
 *             the status dropdown back, with no passing examination.
 *   - CO-R07  editing a live assessment wrote no `coshh_events` row, while
 *             every other mutation in the module does.
 *
 * CO-S05 and CO-A02 are one root cause: the router imported nothing from
 * `../tenant-guards`. Two more instances of that same omission are covered
 * below — `assessments.update`'s assessor and `lev.recordTest`'s report key
 * — because they are the identical missing guard in the same file.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { and, eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';

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

const createCaller = createCallerFactory(appRouter);
const silentLogger = () =>
  createLogger({ service: 'coshh-audit', level: 'fatal', nodeEnv: 'test' });

/** A fully-populated, schema-valid AI extraction. */
const VALID_EXTRACTION = {
  productName: 'Acetone technical grade',
  supplier: 'Brenntag',
  productIdentifier: 'BRN-1042',
  physicalForm: 'liquid' as const,
  signalWord: 'danger' as const,
  hazardClassification: ['Flam. Liq. 2'],
  hStatements: [{ code: 'H225', text: 'Highly flammable liquid and vapour.' }],
  pStatements: [{ code: 'P210', text: 'Keep away from heat, sparks and open flames.' }],
  pictograms: ['GHS02' as const],
  workplaceExposureLimits: [],
  storageRequirements: 'Cool, ventilated, away from ignition sources.',
  issueDate: '2026-01-15',
  confidence: 'high' as const,
};

describe('coshh — audit fixes (8 August 2026)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let otherTenantId: string;
  let adminId: string;
  let colleagueId: string;
  /** Tenant B's administrator — the name that must never reach tenant A. */
  let foreignAdminId: string;
  let siteA: string;

  function ctxFor(userId: string, tid: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tid as never },
    });
  }
  const callerFor = (userId: string, tid: string = tenantId) => createCaller(ctxFor(userId, tid));

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    otherTenantId = newId();
    await db.insert(schema.tenants).values([
      { id: tenantId, name: 'Acme', slug: `acme-${tenantId.slice(-8).toLowerCase()}` },
      { id: otherTenantId, name: 'Rival', slug: `rival-${otherTenantId.slice(-8).toLowerCase()}` },
    ]);
    const sets = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    const otherSets = await seedDefaultPermissionSets(db as unknown as Database, otherTenantId);

    adminId = `usr_${newId()}`;
    colleagueId = `usr_${newId()}`;
    foreignAdminId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Priya Nair',
        email: `priya-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: colleagueId,
        name: 'Dev Rao',
        email: `dev-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.standard,
      },
      {
        id: foreignAdminId,
        name: 'Ada Admin',
        email: `ada-${otherTenantId}@rival.test`,
        tenantId: otherTenantId,
        permissionSetId: otherSets.administrator,
      },
    ]);

    siteA = newId();
    await db.insert(schema.sites).values({ id: siteA, tenantId, name: 'Warehouse' });
  });

  afterEach(async () => {
    await client.close();
  });

  async function newSubstance(name = 'Acetone'): Promise<string> {
    const { substanceId } = await callerFor(adminId).coshh.substances.create({ name });
    return substanceId;
  }

  // ── CO-S05 — the critical one ─────────────────────────────────────────

  it('CO-S05: a foreign user cannot be enrolled onto the surveillance register', async () => {
    const admin = callerFor(adminId);
    const substanceId = await newSubstance();

    // The fixture is real: tenant B's admin exists and has a name worth leaking.
    const [foreign] = await db
      .select({ name: schema.user.name, tenantId: schema.user.tenantId })
      .from(schema.user)
      .where(eq(schema.user.id, foreignAdminId));
    expect(foreign).toMatchObject({ name: 'Ada Admin', tenantId: otherTenantId });

    await expect(
      admin.coshh.surveillance.enroll({ substanceId, userId: foreignAdminId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'user not found in this tenant' });

    // Nothing was written, so nothing can be read back.
    const rows = await db
      .select({ id: schema.coshhHealthSurveillance.id })
      .from(schema.coshhHealthSurveillance)
      .where(eq(schema.coshhHealthSurveillance.substanceId, substanceId));
    expect(rows).toHaveLength(0);

    const register = await admin.coshh.surveillance.list({ substanceId });
    expect(register).toHaveLength(0);
    expect(JSON.stringify(register)).not.toContain('Ada Admin');
  });

  it('CO-S05: the register itself is tenant-scoped, not just the write path', async () => {
    const admin = callerFor(adminId);
    const substanceId = await newSubstance();

    // Defence in depth: plant the row the old `enroll` would have written,
    // straight into the table, and prove `list` still refuses to surface it
    // or resolve the foreign name through its join.
    await db.insert(schema.coshhHealthSurveillance).values({
      id: newId(),
      tenantId: otherTenantId,
      substanceId,
      userId: foreignAdminId,
      intervalMonths: 12,
      nextDueAt: new Date(),
      createdBy: foreignAdminId,
    });

    const register = await admin.coshh.surveillance.list({ substanceId });
    expect(register).toHaveLength(0);
    expect(JSON.stringify(register)).not.toContain('Ada Admin');
  });

  it('CO-S05: the gate is a gate — our own people still enrol and show their name', async () => {
    const admin = callerFor(adminId);
    const substanceId = await newSubstance();

    await expect(
      admin.coshh.surveillance.enroll({ substanceId, userId: colleagueId, intervalMonths: 6 }),
    ).resolves.toMatchObject({ enrolmentId: expect.any(String) });

    const register = await admin.coshh.surveillance.list({ substanceId });
    expect(register).toHaveLength(1);
    expect(register[0]).toMatchObject({ userId: colleagueId, userName: 'Dev Rao' });
  });

  it('CO-S05 (same omission): a foreign assessor cannot be set on an assessment', async () => {
    const admin = callerFor(adminId);
    const substanceId = await newSubstance();
    const { assessmentId } = await admin.coshh.assessments.create({
      substanceId,
      taskDescription: 'Degreasing parts',
    });

    await expect(
      admin.coshh.assessments.update({ assessmentId, assessorUserId: foreignAdminId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'user not found in this tenant' });

    await expect(
      admin.coshh.assessments.update({ assessmentId, assessorUserId: colleagueId }),
    ).resolves.toEqual({ ok: true });
  });

  // ── CO-A02 — the storage-key boundary ─────────────────────────────────

  it('CO-A02: sds.attach refuses a storage key from another tenant', async () => {
    const admin = callerFor(adminId);
    const substanceId = await newSubstance();

    await expect(
      admin.coshh.sds.attach({
        substanceId,
        storageKey: `${otherTenantId}/coshh/stolen-sds.pdf`,
        filename: 'sds.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const rows = await db
      .select({ id: schema.coshhSdsDocuments.id })
      .from(schema.coshhSdsDocuments)
      .where(eq(schema.coshhSdsDocuments.substanceId, substanceId));
    expect(rows).toHaveLength(0);

    // Our own key still attaches.
    await expect(
      admin.coshh.sds.attach({
        substanceId,
        storageKey: `${tenantId}/coshh/sds.pdf`,
        filename: 'sds.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).resolves.toMatchObject({ version: 1 });
  });

  it('CO-A02 (same omission): lev.recordTest refuses a foreign report key', async () => {
    const admin = callerFor(adminId);
    const { levUnitId } = await admin.coshh.lev.create({ name: 'Welding bay extraction' });

    await expect(
      admin.coshh.lev.recordTest({
        levUnitId,
        testedAt: new Date(),
        result: 'pass',
        reportStorageKey: `${otherTenantId}/coshh/report.pdf`,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      admin.coshh.lev.recordTest({
        levUnitId,
        testedAt: new Date(),
        result: 'pass',
        reportStorageKey: `${tenantId}/coshh/report.pdf`,
      }),
    ).resolves.toMatchObject({ testId: expect.any(String) });
  });

  // ── CO-A01 — the AI boundary ──────────────────────────────────────────

  it('CO-A01: a malformed AI extraction is refused at the tRPC boundary', async () => {
    const admin = callerFor(adminId);
    const substanceId = await newSubstance();
    const file = {
      substanceId,
      storageKey: `${tenantId}/coshh/sds.pdf`,
      filename: 'sds.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    };

    // A pictogram outside the GHS set — the shape a hallucinating model
    // produces, and precisely what `sdsExtractionSchema` exists to catch.
    await expect(
      admin.coshh.sds.attach({
        ...file,
        extraction: { ...VALID_EXTRACTION, pictograms: ['GHS99'] },
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // Free-form junk, which `z.unknown()` waved straight through into a
    // column typed `$type<SdsExtraction>()`.
    await expect(
      admin.coshh.sds.attach({ ...file, extraction: { arbitrary: 'nonsense' } } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // Nothing was written by either attempt.
    const rows = await db
      .select({ id: schema.coshhSdsDocuments.id })
      .from(schema.coshhSdsDocuments)
      .where(eq(schema.coshhSdsDocuments.substanceId, substanceId));
    expect(rows).toHaveLength(0);
  });

  it('CO-A01: a valid extraction still attaches and is stored intact', async () => {
    const admin = callerFor(adminId);
    const substanceId = await newSubstance();
    await admin.coshh.sds.attach({
      substanceId,
      storageKey: `${tenantId}/coshh/sds.pdf`,
      filename: 'sds.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      extraction: VALID_EXTRACTION,
    });

    const [row] = await db
      .select({ extraction: schema.coshhSdsDocuments.extraction })
      .from(schema.coshhSdsDocuments)
      .where(eq(schema.coshhSdsDocuments.substanceId, substanceId));
    expect(row?.extraction).toMatchObject({
      productName: 'Acetone technical grade',
      pictograms: ['GHS02'],
      confidence: 'high',
    });
  });

  // ── CO-S03 — the LEV return path ──────────────────────────────────────

  it('CO-S03: a failed examination cannot be cleared by setting the status back', async () => {
    const admin = callerFor(adminId);
    const { levUnitId } = await admin.coshh.lev.create({ name: 'Welding bay extraction' });

    await admin.coshh.lev.recordTest({
      levUnitId,
      testedAt: new Date(),
      result: 'fail',
      defectsSummary: 'Ductwork detached at hood 3',
    });

    // The fail took it out of service — that half always worked.
    let [unit] = await db
      .select({ status: schema.coshhLevUnits.status })
      .from(schema.coshhLevUnits)
      .where(eq(schema.coshhLevUnits.id, levUnitId));
    expect(unit?.status).toBe('out_of_service');

    await expect(admin.coshh.lev.update({ levUnitId, status: 'in_service' })).rejects.toMatchObject(
      {
        code: 'PRECONDITION_FAILED',
        message: 'lev-failed-examination-outstanding',
      },
    );

    [unit] = await db
      .select({ status: schema.coshhLevUnits.status })
      .from(schema.coshhLevUnits)
      .where(eq(schema.coshhLevUnits.id, levUnitId));
    expect(unit?.status).toBe('out_of_service');
  });

  it('CO-S03: a passing examination is what puts it back — not a dead end', async () => {
    const admin = callerFor(adminId);
    const { levUnitId } = await admin.coshh.lev.create({ name: 'Welding bay extraction' });

    await admin.coshh.lev.recordTest({
      levUnitId,
      testedAt: new Date(Date.now() - 86_400_000),
      result: 'fail',
    });
    await admin.coshh.lev.recordTest({ levUnitId, testedAt: new Date(), result: 'pass' });

    const [unit] = await db
      .select({ status: schema.coshhLevUnits.status })
      .from(schema.coshhLevUnits)
      .where(eq(schema.coshhLevUnits.id, levUnitId));
    expect(unit?.status).toBe('in_service');

    // Other status moves are untouched, and a decommissioned unit is not
    // resurrected by an examination.
    await admin.coshh.lev.update({ levUnitId, status: 'decommissioned' });
    await admin.coshh.lev.recordTest({ levUnitId, testedAt: new Date(), result: 'pass' });
    const [after] = await db
      .select({ status: schema.coshhLevUnits.status })
      .from(schema.coshhLevUnits)
      .where(eq(schema.coshhLevUnits.id, levUnitId));
    expect(after?.status).toBe('decommissioned');
  });

  // ── CO-R07 — the trail ────────────────────────────────────────────────

  it('CO-R07: editing an assessment leaves a trail of who, what and the prior value', async () => {
    const admin = callerFor(adminId);
    const substanceId = await newSubstance();
    const { assessmentId } = await admin.coshh.assessments.create({
      substanceId,
      taskDescription: 'Degreasing parts',
    });

    await admin.coshh.assessments.update({
      assessmentId,
      taskDescription: 'Degreasing parts in the wash bay',
      routesOfExposure: ['inhalation', 'skin'],
      levRequired: true,
    });

    const events = await db
      .select({
        kind: schema.coshhEvents.kind,
        detail: schema.coshhEvents.detail,
        actorUserId: schema.coshhEvents.actorUserId,
        entityType: schema.coshhEvents.entityType,
      })
      .from(schema.coshhEvents)
      .where(
        and(
          eq(schema.coshhEvents.tenantId, tenantId),
          eq(schema.coshhEvents.entityId, assessmentId),
          eq(schema.coshhEvents.kind, 'updated'),
        ),
      );
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.entityType).toBe('assessment');
    expect(event?.actorUserId).toBe(adminId);
    // Which fields moved...
    expect(event?.detail).toContain('taskDescription');
    expect(event?.detail).toContain('routesOfExposure');
    expect(event?.detail).toContain('levRequired');
    // ...and what they said before, which is the half that makes it evidence.
    expect(event?.detail).toContain('Degreasing parts');
    expect(event?.detail).toContain('"levRequired":false');
  });

  it('CO-R07: a no-op update writes no event', async () => {
    const admin = callerFor(adminId);
    const substanceId = await newSubstance();
    const { assessmentId } = await admin.coshh.assessments.create({
      substanceId,
      taskDescription: 'Degreasing parts',
    });

    await admin.coshh.assessments.update({ assessmentId });

    const events = await db
      .select({ id: schema.coshhEvents.id })
      .from(schema.coshhEvents)
      .where(
        and(eq(schema.coshhEvents.entityId, assessmentId), eq(schema.coshhEvents.kind, 'updated')),
      );
    expect(events).toHaveLength(0);
  });

  it('CO-R07: the trail survives republishing, which clears the changed-since flag', async () => {
    const admin = callerFor(adminId);
    const substanceId = await newSubstance();
    const { assessmentId } = await admin.coshh.assessments.create({
      substanceId,
      taskDescription: 'Degreasing parts',
    });
    // Set the routes straight in the table: going through `update` would
    // itself write the event row this test is counting.
    await db
      .update(schema.coshhAssessments)
      .set({ routesOfExposure: ['inhalation'] })
      .where(eq(schema.coshhAssessments.id, assessmentId));
    await admin.coshh.assessments.addControl({
      assessmentId,
      tier: 'engineering',
      description: 'LEV at the wash bay',
    });
    await admin.coshh.assessments.publish({ assessmentId });

    await admin.coshh.assessments.update({ assessmentId, plainSummary: 'Rewritten after publish' });
    await admin.coshh.assessments.publish({ assessmentId });

    // Republishing moves lastPublishedAt past updatedAt, so the UI's
    // "changed since publish" prompt goes quiet — the event row is the only
    // thing left that remembers the edit happened.
    const events = await db
      .select({ detail: schema.coshhEvents.detail })
      .from(schema.coshhEvents)
      .where(
        and(eq(schema.coshhEvents.entityId, assessmentId), eq(schema.coshhEvents.kind, 'updated')),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toContain('plainSummary');
  });
});
