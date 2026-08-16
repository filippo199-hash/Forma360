/**
 * Contractors router — directory + derived company-wide compliance.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { eq } from 'drizzle-orm';
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
const silentLogger = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

function futureDate(): string {
  return new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
}
function pastDate(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}
/** Relative, never a hardcoded calendar date — the suite must not go red on a wall-clock change. */
function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

describe('contractors router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tenantId as never },
    });
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = newId();
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Admin',
      email: 'admin@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('derives compliance: blocking requirement needs a verified, unexpired doc', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: contractorId } = await caller.contractors.create({ name: 'Acme Electrical' });

    // No requirements yet → "no_requirements".
    let list = (await caller.contractors.list()).contractors;
    expect(list.find((c) => c.id === contractorId)?.complianceStatus).toBe('no_requirements');

    const { id: reqId } = await caller.contractors.addRequirement({
      contractorId,
      name: 'Public Liability Insurance',
      blocking: true,
    });

    // Blocking requirement, no doc → non_compliant.
    list = (await caller.contractors.list()).contractors;
    expect(list.find((c) => c.id === contractorId)?.complianceStatus).toBe('non_compliant');

    // Uploaded but pending → still non_compliant.
    const { id: docId } = await caller.contractors.addDocument({
      requirementId: reqId,
      storageKey: `${tenantId}/contractors/${contractorId}/insurance.pdf`,
      filename: 'insurance.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      endDate: futureDate(),
    });
    let got = await caller.contractors.get({ id: contractorId });
    expect(got.complianceStatus).toBe('non_compliant');

    // Verified + unexpired → compliant.
    await caller.contractors.verifyDocument({ id: docId });
    got = await caller.contractors.get({ id: contractorId });
    expect(got.complianceStatus).toBe('compliant');
    expect(got.requirements[0]?.satisfied).toBe(true);
  });

  it('an expired verified document does not satisfy the requirement', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: contractorId } = await caller.contractors.create({ name: 'NewCo' });
    const { id: reqId } = await caller.contractors.addRequirement({
      contractorId,
      name: 'Insurance',
      blocking: true,
    });
    const { id: docId } = await caller.contractors.addDocument({
      requirementId: reqId,
      storageKey: `${tenantId}/contractors/${contractorId}/old.pdf`,
      filename: 'old.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      endDate: pastDate(),
    });
    await caller.contractors.verifyDocument({ id: docId });
    const got = await caller.contractors.get({ id: contractorId });
    expect(got.complianceStatus).toBe('non_compliant');
  });

  it('CT-C09: asOf answers compliance on a past day', async () => {
    // The register keeps every document's validity window precisely so it
    // can answer "was their insurance in force on the day of the
    // incident" — but nothing let a caller name the day.
    const caller = createCaller(ctxFor(adminUserId));
    const { id: contractorId } = await caller.contractors.create({ name: 'Lapsed Ltd' });
    const { id: reqId } = await caller.contractors.addRequirement({
      contractorId,
      name: 'Public Liability Insurance',
      blocking: true,
    });
    // Cover ran from 120 days ago to 60 days ago — expired today.
    const { id: docId } = await caller.contractors.addDocument({
      requirementId: reqId,
      storageKey: `${tenantId}/contractors/${contractorId}/policy.pdf`,
      filename: 'policy.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      startDate: daysFromNow(-120),
      endDate: daysFromNow(-60),
    });
    await caller.contractors.verifyDocument({ id: docId });

    const now = await caller.contractors.get({ id: contractorId });
    expect(now.complianceStatus).toBe('non_compliant');
    expect(now.asOf).toBe(daysFromNow(0));

    const incident = await caller.contractors.get({ id: contractorId, asOf: daysFromNow(-90) });
    expect(incident.complianceStatus).toBe('compliant');
    expect(incident.requirements[0]?.satisfied).toBe(true);
    expect(incident.asOf).toBe(daysFromNow(-90));

    // Before the policy incepted: NOT in force. This is the half an
    // end-date-only check got wrong.
    const before = await caller.contractors.get({ id: contractorId, asOf: daysFromNow(-150) });
    expect(before.complianceStatus).toBe('non_compliant');

    // The register agrees with the detail view on the same day.
    const register = await caller.contractors.list({ asOf: daysFromNow(-90) });
    expect(register.contractors.find((c) => c.id === contractorId)?.complianceStatus).toBe(
      'compliant',
    );
  });

  it('CT-C09: a policy that has not started yet is not cover today', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: contractorId } = await caller.contractors.create({ name: 'Future Co' });
    const { id: reqId } = await caller.contractors.addRequirement({
      contractorId,
      name: 'Insurance',
      blocking: true,
    });
    const { id: docId } = await caller.contractors.addDocument({
      requirementId: reqId,
      storageKey: `${tenantId}/contractors/${contractorId}/next-year.pdf`,
      filename: 'next-year.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      startDate: daysFromNow(30),
      endDate: daysFromNow(395),
    });
    await caller.contractors.verifyDocument({ id: docId });
    expect((await caller.contractors.get({ id: contractorId })).complianceStatus).toBe(
      'non_compliant',
    );
    expect(
      (await caller.contractors.get({ id: contractorId, asOf: daysFromNow(60) })).complianceStatus,
    ).toBe('compliant');
  });

  it('CT-V02: the register pages, and the cursor neither drops nor repeats a row', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) {
      await caller.contractors.create({ name });
    }
    const page1 = await caller.contractors.list({ limit: 2 });
    expect(page1.contractors.map((c) => c.name)).toEqual(['Alpha', 'Bravo']);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await caller.contractors.list({
      limit: 2,
      ...(page1.nextCursor === null ? {} : { cursor: page1.nextCursor }),
    });
    expect(page2.contractors.map((c) => c.name)).toEqual(['Charlie', 'Delta']);

    const page3 = await caller.contractors.list({
      limit: 2,
      ...(page2.nextCursor === null ? {} : { cursor: page2.nextCursor }),
    });
    expect(page3.contractors.map((c) => c.name)).toEqual(['Echo']);
    expect(page3.hasMore).toBe(false);
  });

  it('CT-V02: search runs server-side, so a picker cannot stop at page one', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await caller.contractors.create({ name: 'Sparky Electrical', category: 'Electrical' });
    await caller.contractors.create({ name: 'Drips Plumbing', category: 'Plumbing' });
    const byName = await caller.contractors.list({ search: 'sparky' });
    expect(byName.contractors.map((c) => c.name)).toEqual(['Sparky Electrical']);
    const byCategory = await caller.contractors.list({ search: 'plumb' });
    expect(byCategory.contractors.map((c) => c.name)).toEqual(['Drips Plumbing']);
  });

  it('CT-W01: create mints an upload token, so the expiry reminder always has a link', async () => {
    // Only the manual "copy upload link" button ever wrote this, so a
    // contractor's chase email pointed at the sign-in page instead.
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.create({ name: 'Sparky' });
    const [row] = await db
      .select({ token: schema.contractors.uploadToken })
      .from(schema.contractors)
      .where(eq(schema.contractors.id, id));
    expect(row?.token).toMatch(/^[0-9a-f]{48}$/);
  });

  it('CT-S01: neither list nor get returns the upload token', async () => {
    // It is the bearer credential for the no-login upload portal, and
    // MINTING one needs `contractors.manage` — but every `contractors.view`
    // holder was handed it in the row.
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.create({ name: 'Token Co' });
    const listed = (await caller.contractors.list()).contractors.find((c) => c.id === id);
    expect(listed).toBeDefined();
    expect(Object.keys(listed ?? {})).not.toContain('uploadToken');
    const got = await caller.contractors.get({ id });
    expect(Object.keys(got.contractor)).not.toContain('uploadToken');
  });

  it('CT-U01: a document with neither an expiry nor the assertion is refused', async () => {
    // A null expiry reads as "valid forever" to the compliance derivation
    // and is skipped by the chase worker, so it must not be reachable by
    // simply leaving both date boxes blank.
    const caller = createCaller(ctxFor(adminUserId));
    const { id: contractorId } = await caller.contractors.create({ name: 'Blank Co' });
    const { id: reqId } = await caller.contractors.addRequirement({
      contractorId,
      name: 'Insurance',
      blocking: true,
    });
    const doc = {
      requirementId: reqId,
      storageKey: `${tenantId}/contractors/${contractorId}/blank.pdf`,
      filename: 'blank.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
    };
    await expect(caller.contractors.addDocument(doc)).rejects.toThrow(/EXPIRY_REQUIRED/);
    // The deliberate assertion is accepted.
    await expect(caller.contractors.addDocument({ ...doc, noExpiry: true })).resolves.toBeDefined();
  });

  it('CT-U01: a requirement on a renewal cycle has no "never expires" escape', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: contractorId } = await caller.contractors.create({ name: 'Cycle Co' });
    const { id: reqId } = await caller.contractors.addRequirement({
      contractorId,
      name: 'Annual insurance',
      blocking: true,
      recurrenceMonths: 12,
    });
    await expect(
      caller.contractors.addDocument({
        requirementId: reqId,
        storageKey: `${tenantId}/contractors/${contractorId}/perpetual.pdf`,
        filename: 'perpetual.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        noExpiry: true,
      }),
    ).rejects.toThrow(/EXPIRY_REQUIRED/);
  });

  it('CT-T03b: archiving a contractor that is not there is not a success', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await expect(caller.contractors.archive({ id: newId() })).rejects.toThrow();
  });

  it('a manual override wins over the derived status and can be cleared', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: contractorId } = await caller.contractors.create({ name: 'Override Co' });
    // No requirements → derived is no_requirements.
    let got = await caller.contractors.get({ id: contractorId });
    expect(got.complianceStatus).toBe('no_requirements');

    // Force suspended with a reason.
    await caller.contractors.setComplianceOverride({
      id: contractorId,
      override: 'suspended',
      reason: 'Safety breach on site',
    });
    got = await caller.contractors.get({ id: contractorId });
    expect(got.complianceStatus).toBe('suspended');
    expect(got.derivedComplianceStatus).toBe('no_requirements');
    expect(got.contractor.complianceOverride).toBe('suspended');
    expect(got.contractor.complianceOverrideReason).toBe('Safety breach on site');

    // Also reflected in the list.
    const list = (await caller.contractors.list()).contractors;
    expect(list.find((c) => c.id === contractorId)?.complianceStatus).toBe('suspended');

    // Clearing reverts to derived and wipes the reason.
    await caller.contractors.setComplianceOverride({ id: contractorId, override: null });
    got = await caller.contractors.get({ id: contractorId });
    expect(got.complianceStatus).toBe('no_requirements');
    expect(got.contractor.complianceOverride).toBeNull();
    expect(got.contractor.complianceOverrideReason).toBeNull();
  });

  it('advisory requirements do not affect compliance', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: contractorId } = await caller.contractors.create({ name: 'Cleaners' });
    await caller.contractors.addRequirement({
      contractorId,
      name: 'Toolbox talk',
      blocking: false,
    });
    const got = await caller.contractors.get({ id: contractorId });
    // Only advisory requirements → no blocking ones → no_requirements (compliant-by-default).
    expect(got.complianceStatus).toBe('no_requirements');
  });

  it('BUG-22: applyTemplates with no template for the trade refuses, never a silent zero', async () => {
    // "Apply electricians template" on a free-typed trade with no saved
    // template used to return { applied: 0 } and the UI toasted
    // "0 requirements added." as a success.
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.create({
      name: 'Volt & Sons',
      category: 'electricians',
    });
    await expect(caller.contractors.applyTemplates({ id })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'no-templates-for-category',
    });
  });

  it('BUG-22: template matching is case- and whitespace-insensitive', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await caller.contractors.templates.create({
      category: 'Electrical',
      name: 'Public Liability Insurance',
      blocking: true,
    });
    await caller.contractors.templates.create({
      category: 'Electrical',
      name: '18th Edition certificate',
      blocking: true,
    });
    // Free-typed category differs in case and padding from the template's.
    const { id } = await caller.contractors.create({ name: 'Sparky', category: ' electrical ' });
    // create auto-applies with the same normalised matching…
    let got = await caller.contractors.get({ id });
    expect(got.requirements.map((r) => r.name).sort()).toEqual([
      '18th Edition certificate',
      'Public Liability Insurance',
    ]);

    // …and the explicit command reports duplicates honestly: everything is
    // already there, so applied is 0 with matched > 0 — not an error.
    const res = await caller.contractors.applyTemplates({ id });
    expect(res).toMatchObject({ applied: 0 });
    expect(res.matched).toBeGreaterThan(0);
  });

  it('BUG-22: applyTemplates adds only the missing requirements', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.create({ name: 'Pipes Ltd', category: 'Plumbing' });
    // Template created AFTER the contractor, so create's auto-apply found nothing.
    await caller.contractors.templates.create({
      category: 'plumbing',
      name: 'Gas Safe registration',
      blocking: true,
    });
    const res = await caller.contractors.applyTemplates({ id });
    expect(res).toMatchObject({ applied: 1, matched: 1 });
    const got = await caller.contractors.get({ id });
    expect(got.requirements.map((r) => r.name)).toContain('Gas Safe registration');
  });
});
