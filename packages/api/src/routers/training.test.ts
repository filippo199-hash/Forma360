/**
 * Training & competence matrix router (FreeHS module B7).
 *
 * Edge cases:
 *   - TR-E10: brand gate — a brand without the module refuses every call
 *   - TR-E11: role assignment drives the matrix; adding a role adds the gap
 *   - TR-E12: recording a completion closes the gap and computes the expiry
 *   - TR-E13: records are append-only — a renewal never mutates its predecessor
 *   - TR-E14: the gap list is ordered expired → expiring → never held
 *   - TR-E15: tenant isolation — one tenant never sees another's records
 *   - TR-E16: permissions — recording needs training.record, catalogue needs manage
 *   - TR-E17: CSV import reports per-row failures instead of failing whole
 *   - TR-E18: people without accounts (contractors' operatives) appear in the matrix
 *   - TR-E19: reverse lookup answers "who is qualified for X"
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { createLogger } from '@forma360/shared/logger';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import { createTrainingRouter } from './training';
import { createCallerFactory, router } from '../trpc';

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

const silentLogger = () =>
  createLogger({ service: 'training-test', level: 'fatal', nodeEnv: 'test' });

/** A fixed "today" so expiry maths is deterministic. */
const NOW = new Date('2026-08-06T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (offsetDays: number): string =>
  new Date(NOW.getTime() + offsetDays * DAY).toISOString().slice(0, 10);

describe('training router (FreeHS B7)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let otherTenantId: string;
  let adminId: string;
  let standardId: string;
  let operatorId: string;
  let roleFieldId: string;

  /** A caller bound to a user, against an enabled (or disabled) module. */
  function callerFor(userId: string, tenant: string, enabled = true) {
    const appRouter = router({ training: createTrainingRouter({ enabled, now: () => NOW }) });
    return createCallerFactory(appRouter)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'training@x.test', tenantId: tenant as never },
      }),
    );
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    otherTenantId = newId();
    adminId = newId();
    standardId = newId();
    operatorId = newId();

    for (const [id, name] of [
      [tenantId, 'Precision Engineering'],
      [otherTenantId, 'Other Co'],
    ] as const) {
      await db.insert(schema.tenants).values({ id, name, slug: id.slice(-8).toLowerCase() });
    }

    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    const otherSets = await seedDefaultPermissionSets(db as never, otherTenantId);

    await db.insert(schema.user).values([
      {
        id: adminId,
        tenantId,
        name: 'Priya Nair',
        email: 'priya@precision.test',
        emailVerified: true,
        permissionSetId: sets.administrator,
      },
      {
        id: standardId,
        tenantId,
        name: 'Sam Standard',
        email: 'sam@precision.test',
        emailVerified: true,
        permissionSetId: sets.standard,
      },
      {
        id: operatorId,
        tenantId,
        name: 'Dave Mullins',
        email: 'dave@precision.test',
        emailVerified: true,
        permissionSetId: sets.standard,
      },
      {
        id: newId(),
        tenantId: otherTenantId,
        name: 'Rival Rob',
        email: 'rob@other.test',
        emailVerified: true,
        permissionSetId: otherSets.administrator,
      },
    ]);

    // The tenant's own job-title vocabulary — role assignment reads this.
    roleFieldId = newId();
    await db.insert(schema.customUserFields).values({
      id: roleFieldId,
      tenantId,
      name: 'Role',
      type: 'text',
    });
    await db.insert(schema.userCustomFieldValues).values({
      tenantId,
      userId: operatorId,
      fieldId: roleFieldId,
      value: 'Machine operator',
    });
  });

  afterEach(async () => {
    await client.close();
  });

  /** Create a requirement and assign it to the machine-operator role. */
  async function seedRequirement(
    opts: {
      name?: string;
      validityMonths?: number | null;
      obligation?: 'statutory' | 'mandatory';
    } = {},
  ): Promise<string> {
    const caller = callerFor(adminId, tenantId);
    const { id } = await caller.training.createRequirement({
      name: opts.name ?? 'Abrasive wheels',
      category: null,
      obligation: opts.obligation ?? 'mandatory',
      validityMonths: opts.validityMonths === undefined ? 36 : opts.validityMonths,
      renewalLeadDays: 60,
      evidenceNote: null,
      description: null,
    });
    await caller.training.addAssignment({
      requirementId: id,
      scope: 'role',
      roleName: 'Machine operator',
      groupId: null,
      siteId: null,
      userId: null,
    });
    return id;
  }

  it('TR-E10: a brand without the module refuses every call', async () => {
    const caller = callerFor(adminId, tenantId, false);
    await expect(caller.training.listRequirements({})).rejects.toThrow(/module-disabled/);
    await expect(caller.training.gaps({})).rejects.toThrow(/module-disabled/);
  });

  it('TR-E11: a role assignment puts the requirement in that person’s set', async () => {
    const caller = callerFor(adminId, tenantId);
    const requirementId = await seedRequirement();

    const gaps = await caller.training.gaps({});
    // Dave holds the role, so the requirement is a gap for him and nobody else.
    expect(gaps.notHeld.map((g) => g.personName)).toEqual(['Dave Mullins']);
    expect(gaps.notHeld[0]?.requirementId).toBe(requirementId);
    expect(gaps.total).toBe(1);

    // Priya has no role, so no requirement reaches her.
    const matrix = await caller.training.matrix({});
    expect(matrix.cells.filter((c) => c.personName === 'Priya Nair')).toHaveLength(0);
  });

  it('TR-E12: recording a completion closes the gap and computes the expiry', async () => {
    const caller = callerFor(adminId, tenantId);
    const requirementId = await seedRequirement({ validityMonths: 36 });

    const res = await caller.training.addRecord({
      requirementId,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-30),
      awardingBody: 'Safety Co',
      certificateNumber: 'AW-1',
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });
    // 36 months on from the achievement date, not from today.
    expect(res.expiresAt?.toISOString().slice(0, 10)).toBe(
      new Date(new Date(iso(-30)).setUTCFullYear(new Date(iso(-30)).getUTCFullYear() + 3))
        .toISOString()
        .slice(0, 10),
    );

    const gaps = await caller.training.gaps({});
    expect(gaps.total).toBe(0);
  });

  it('TR-E13: records are append-only — a renewal never mutates its predecessor', async () => {
    const caller = callerFor(adminId, tenantId);
    const requirementId = await seedRequirement({ validityMonths: 12 });

    // Lapsed, then renewed.
    const first = await caller.training.addRecord({
      requirementId,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-400),
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });
    await caller.training.addRecord({
      requirementId,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-5),
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });

    // Both rows survive; the old expiry is untouched.
    const records = await caller.training.listRecords({});
    expect(records).toHaveLength(2);
    const original = records.find((r) => r.id === first.id);
    expect(original?.expiresAt?.toISOString().slice(0, 10)).toBe(
      first.expiresAt?.toISOString().slice(0, 10),
    );

    // Today reads in date, because the renewal governs.
    const gaps = await caller.training.gaps({});
    expect(gaps.total).toBe(0);
  });

  it('TR-E14: the gap list is grouped expired, expiring, never held', async () => {
    const caller = callerFor(adminId, tenantId);
    const expiredReq = await seedRequirement({ name: 'First aid', validityMonths: 12 });
    const soonReq = await seedRequirement({ name: 'FLT', validityMonths: 12 });
    await seedRequirement({ name: 'Confined space', validityMonths: 12 });

    // Expired 10 days ago.
    await caller.training.addRecord({
      requirementId: expiredReq,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-400),
      expiresAt: iso(-10),
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });
    // Expires in 14 days — inside the 60-day lead.
    await caller.training.addRecord({
      requirementId: soonReq,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-300),
      expiresAt: iso(14),
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });

    const gaps = await caller.training.gaps({});
    expect(gaps.expired.map((g) => g.requirementName)).toEqual(['First aid']);
    expect(gaps.expiringSoon.map((g) => g.requirementName)).toEqual(['FLT']);
    expect(gaps.notHeld.map((g) => g.requirementName)).toEqual(['Confined space']);
    expect(gaps.total).toBe(3);
  });

  it('TR-E15: one tenant never sees another tenant’s records', async () => {
    const caller = callerFor(adminId, tenantId);
    const requirementId = await seedRequirement();
    await caller.training.addRecord({
      requirementId,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-10),
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });

    const otherAdmin = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.tenantId, otherTenantId))
      .limit(1);
    const rivalId = otherAdmin[0]?.id;
    expect(rivalId).toBeDefined();
    const rival = callerFor(rivalId as string, otherTenantId);
    expect(await rival.training.listRequirements({})).toHaveLength(0);
    expect(await rival.training.listRecords({})).toHaveLength(0);
    expect((await rival.training.gaps({})).total).toBe(0);
  });

  it('TR-E16: recording needs training.record; the catalogue needs training.manage', async () => {
    const standard = callerFor(standardId, tenantId);
    // Standard holds training.view only.
    await expect(
      standard.training.createRequirement({
        name: 'Nope',
        category: null,
        obligation: 'mandatory',
        validityMonths: null,
        renewalLeadDays: 60,
        evidenceNote: null,
        description: null,
      }),
    ).rejects.toThrow(/FORBIDDEN|training.manage/);
    // TR-B10: and can no longer read the ORG-WIDE views either — those
    // name colleagues' shortfalls. Their own record stays reachable.
    await expect(standard.training.gaps({})).rejects.toThrow(/FORBIDDEN|training.view/);
    await expect(standard.training.person({})).resolves.toBeDefined();
  });

  it('TR-E17: CSV import reports per-row failures instead of failing whole', async () => {
    const caller = callerFor(adminId, tenantId);
    await seedRequirement({ name: 'Manual handling', validityMonths: 36 });

    const res = await caller.training.importRecords({
      rows: [
        {
          personName: 'Dave Mullins',
          userEmail: 'dave@precision.test',
          requirementName: 'Manual handling',
          achievedAt: iso(-20),
        },
        // Unknown requirement — reported, not fatal.
        { personName: 'Nia Roberts', requirementName: 'Does not exist', achievedAt: iso(-20) },
        // Unparseable date — reported, not fatal.
        { personName: 'Tom Baird', requirementName: 'Manual handling', achievedAt: 'not-a-date' },
      ],
    });

    expect(res.imported).toBe(1);
    expect(res.failed).toBe(2);
    expect(res.errors.map((e) => e.row)).toEqual([2, 3]);
    // The good row landed, matched to its user, and is marked imported.
    const records = await caller.training.listRecords({});
    expect(records).toHaveLength(1);
    expect(records[0]?.userId).toBe(operatorId);
    expect(records[0]?.source).toBe('imported');
  });

  it('TR-E18: people without accounts appear in the matrix', async () => {
    const caller = callerFor(adminId, tenantId);
    const requirementId = await seedRequirement({ name: 'CSCS', validityMonths: 60 });

    // A contractor's operative — no platform account, name only.
    await caller.training.addRecord({
      requirementId,
      userId: null,
      personName: 'Agency Alan',
      personCategory: 'contractor',
      contractorId: null,
      achievedAt: iso(-30),
      awardingBody: 'CITB',
      certificateNumber: 'CSCS-99',
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });

    const matrix = await caller.training.matrix({});
    expect(matrix.people.map((p) => p.name)).toContain('Agency Alan');
    const alanCells = matrix.cells.filter((c) => c.personName === 'Agency Alan');
    expect(alanCells).toHaveLength(1);
    expect(alanCells[0]?.status).toBe('in_date');
  });

  it('TR-E19: reverse lookup answers "who is qualified for X"', async () => {
    const caller = callerFor(adminId, tenantId);
    const requirementId = await seedRequirement({ name: 'Confined space', validityMonths: 24 });

    await caller.training.addRecord({
      requirementId,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-30),
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });

    const qualified = await caller.training.qualifiedFor({
      requirementId,
      includeExpiringSoon: true,
    });
    expect(qualified.map((q) => q.personName)).toEqual(['Dave Mullins']);

    // Someone whose ticket lapsed is not qualified.
    const lapsedReq = await seedRequirement({ name: 'IPAF', validityMonths: 12 });
    await caller.training.addRecord({
      requirementId: lapsedReq,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-400),
      expiresAt: iso(-3),
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });
    expect(
      await caller.training.qualifiedFor({ requirementId: lapsedReq, includeExpiringSoon: true }),
    ).toHaveLength(0);
  });
  // ── Review round 1 (TR-A7 / TR-A8 / TR-A12) ───────────────────────────

  it('TR-A7: a held-but-not-required record is not a gap and does not drag compliance', async () => {
    const caller = callerFor(adminId, tenantId);
    // Assigned to the role Dave holds, and one he does NOT hold.
    const assigned = await seedRequirement({ name: 'Manual handling', validityMonths: 12 });
    const { id: unassigned } = await caller.training.createRequirement({
      name: 'Abrasive wheels',
      category: null,
      obligation: 'mandatory',
      validityMonths: 12,
      renewalLeadDays: 60,
      evidenceNote: null,
      description: null,
    });

    // In date for what he needs; lapsed on what he does not.
    await caller.training.addRecord({
      requirementId: assigned,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-10),
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });
    await caller.training.addRecord({
      requirementId: unassigned,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-800),
      expiresAt: iso(-30),
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });

    // The lapsed voluntary card is NOT a gap …
    const gaps = await caller.training.gaps({});
    expect(gaps.total).toBe(0);

    // … and does not drag the board number: 1 of 1 required is in date.
    const compliance = await caller.training.compliance({});
    expect(compliance.overall).toBe(100);
    const wheels = compliance.byRequirement.find((r) => r.requirementId === unassigned);
    expect(wheels?.gaps).toBe(0);

    // It still shows in the matrix, because the wallet must not blank a
    // card someone actually holds.
    const matrix = await caller.training.matrix({});
    const cell = matrix.cells.find((c) => c.requirementId === unassigned);
    expect(cell?.status).toBe('expired');
    expect(cell?.required).toBe(false);
  });

  it('TR-A8: superseding a record removes it from the matrix and reopens the gap', async () => {
    const caller = callerFor(adminId, tenantId);
    const requirementId = await seedRequirement({ validityMonths: 12 });

    // The classic fat-finger: an expiry decades out, which under
    // "furthest-reaching cover" would mark this person permanently
    // competent — and permanently pass the permit gate.
    const { id } = await caller.training.addRecord({
      requirementId,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-10),
      expiresAt: '2099-01-01',
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });
    expect((await caller.training.gaps({})).total).toBe(0);

    await caller.training.supersedeRecord({ id, reason: 'Expiry typed as 2099' });

    // The gap is back, and the row survives as evidence with its reason.
    expect((await caller.training.gaps({})).notHeld).toHaveLength(1);
    const records = await caller.training.listRecords({});
    expect(records).toHaveLength(1);
    expect(records[0]?.supersededAt).not.toBeNull();
    expect(records[0]?.notes).toContain('Expiry typed as 2099');

    // Voiding twice is refused rather than silently re-stamping.
    await expect(caller.training.supersedeRecord({ id, reason: 'again' })).rejects.toThrow(
      /already-superseded/,
    );
  });

  it('TR-A12: compliance reports statutory and mandatory apart, and by area', async () => {
    const caller = callerFor(adminId, tenantId);
    await seedRequirement({ name: 'Fire marshal', validityMonths: 12, obligation: 'statutory' });
    await seedRequirement({ name: 'Manual handling', validityMonths: 12, obligation: 'mandatory' });

    const compliance = await caller.training.compliance({});
    // Both are reported, and separately — the board asks for them apart.
    expect(compliance.statutory).toBe(0);
    expect(compliance.mandatory).toBe(0);
    expect(compliance.overall).toBe(0);
    expect(Array.isArray(compliance.byArea)).toBe(true);
  });

  it('TR-A5: the person view defaults to the caller, so /training/me is personal', async () => {
    const caller = callerFor(adminId, tenantId);
    const requirementId = await seedRequirement();
    // A record for someone ELSE.
    await caller.training.addRecord({
      requirementId,
      userId: operatorId,
      personName: 'Dave Mullins',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-10),
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });

    // Calling with no argument returns the CALLER's wallet, which is
    // empty — never the colleague's record.
    const mine = await callerFor(standardId, tenantId).training.person({});
    expect(mine.records).toHaveLength(0);
  });
  // ── Round 2 (TR-B2 / TR-B5 / TR-B6 / TR-B7 / TR-B10 / TR-B12) ─────────

  it('TR-B2: the person view with NO arguments returns the caller’s own wallet', async () => {
    const caller = callerFor(adminId, tenantId);
    const requirementId = await seedRequirement();
    await caller.training.addRecord({
      requirementId,
      userId: adminId,
      personName: 'Priya Nair',
      personCategory: 'employee',
      contractorId: null,
      achievedAt: iso(-10),
      awardingBody: null,
      certificateNumber: null,
      evidenceKey: null,
      evidenceFilename: null,
      source: 'external',
      notes: null,
    });

    // The exact call the /training/me page makes.
    const mine = await caller.training.person({});
    expect(mine.records).toHaveLength(1);
    expect(mine.isSelf).toBe(true);
    expect(mine.personName).toBe('Priya Nair');

    // An empty string must be treated as absent, which is what the page
    // used to send — and what produced WHERE person_name = ''.
    const alsoMine = await caller.training.person({ personName: '' });
    expect(alsoMine.records).toHaveLength(1);
  });

  it('TR-B2: the cell key follows the resolved target, so gaps show in my wallet', async () => {
    // A requirement assigned to the OPERATOR's role, never held.
    await seedRequirement();
    // Give the operator the role match by asking as them.
    const asOperator = callerFor(operatorId, tenantId);
    const mine = await asOperator.training.person({});
    // A not_held requirement exists only as a CELL, never as a record —
    // so if the key is wrong, "what am I missing" is silently blank.
    expect(mine.cells).toHaveLength(1);
    expect(mine.cells[0]?.status).toBe('not_held');
  });

  it('TR-B10: another person’s wallet needs training.view; your own never does', async () => {
    // `standardId` holds the seeded Standard set, which no longer carries
    // training.view.
    const standard = callerFor(standardId, tenantId);
    await expect(standard.training.person({})).resolves.toBeDefined();
    await expect(standard.training.person({ userId: operatorId })).rejects.toThrow(
      /FORBIDDEN|training.view/,
    );
    // …and the org-wide views stay shut.
    await expect(standard.training.gaps({})).rejects.toThrow(/FORBIDDEN|training.view/);
  });

  it('TR-B7: a requirement-filtered matrix returns exactly one column', async () => {
    const caller = callerFor(adminId, tenantId);
    const a = await seedRequirement({ name: 'Abrasive wheels' });
    await seedRequirement({ name: 'Manual handling' });
    await seedRequirement({ name: 'First aid at work' });

    expect((await caller.training.matrix({})).requirements).toHaveLength(3);
    // Filtered: one column, so the grid cannot assert "not required" about
    // 29 other tickets and then write that into the CSV and the PDF.
    const filtered = await caller.training.matrix({ requirementId: a });
    expect(filtered.requirements).toHaveLength(1);
    expect(filtered.requirements[0]?.id).toBe(a);
  });

  it('TR-B5: an import row with no email matches an existing user by name', async () => {
    const caller = callerFor(adminId, tenantId);
    await seedRequirement({ name: 'Manual handling' });
    const res = await caller.training.importRecords({
      rows: [
        // No userEmail — the common case for an LMS extract keyed on a
        // payroll number. This used to create a duplicate name-only person
        // beside the same human's account.
        { personName: 'Dave Mullins', requirementName: 'Manual handling', achievedAt: iso(-5) },
      ],
      skipped: [],
      dryRun: false,
    });
    expect(res.imported).toBe(1);
    expect(res.matchedToUsers).toBe(1);
    expect(res.nameOnly).toBe(0);
    const records = await caller.training.listRecords({});
    expect(records[0]?.userId).toBe(operatorId);
  });

  it('TR-B4: rows the client could not parse are reported, not silently dropped', async () => {
    const caller = callerFor(adminId, tenantId);
    await seedRequirement({ name: 'Manual handling' });
    const res = await caller.training.importRecords({
      rows: [
        {
          personName: 'Dave Mullins',
          requirementName: 'Manual handling',
          achievedAt: iso(-5),
          sourceRow: 2,
        },
      ],
      // What the parser could not use, carried through with the user's own
      // line numbers.
      skipped: [
        { row: 3, message: 'missing:achievedAt' },
        { row: 7, message: 'missing:personName' },
      ],
      dryRun: false,
    });
    expect(res.imported).toBe(1);
    expect(res.failed).toBe(2);
    expect(res.errors.map((e) => e.row).sort()).toEqual([3, 7]);
  });

  it('TR-B6: re-running the same import is a no-op, and dry run writes nothing', async () => {
    const caller = callerFor(adminId, tenantId);
    await seedRequirement({ name: 'Manual handling' });
    const row = {
      personName: 'Dave Mullins',
      userEmail: 'dave@precision.test',
      requirementName: 'Manual handling',
      achievedAt: iso(-5),
    };

    // Dry run: reports what would land, writes nothing.
    const dry = await caller.training.importRecords({ rows: [row], skipped: [], dryRun: true });
    expect(dry.wouldImport).toBe(1);
    expect(dry.imported).toBe(0);
    expect(await caller.training.listRecords({})).toHaveLength(0);

    // Real run, then the same file again.
    expect(
      (await caller.training.importRecords({ rows: [row], skipped: [], dryRun: false })).imported,
    ).toBe(1);
    const second = await caller.training.importRecords({ rows: [row], skipped: [], dryRun: false });
    expect(second.imported).toBe(0);
    expect(second.skippedDuplicates).toBe(1);
    expect(await caller.training.listRecords({})).toHaveLength(1);
  });

  it('TR-B12: a userId from another tenant is refused, not silently inserted', async () => {
    const caller = callerFor(adminId, tenantId);
    const requirementId = await seedRequirement();
    const outsider = (
      await db.select().from(schema.user).where(eq(schema.user.tenantId, otherTenantId)).limit(1)
    )[0];
    expect(outsider).toBeDefined();
    await expect(
      caller.training.addRecord({
        requirementId,
        userId: outsider?.id ?? '',
        personName: 'Rival Rob',
        personCategory: 'employee',
        contractorId: null,
        achievedAt: iso(-5),
        awardingBody: null,
        certificateNumber: null,
        evidenceKey: null,
        evidenceFilename: null,
        source: 'external',
        notes: null,
      }),
    ).rejects.toThrow(/user-not-in-tenant/);
  });

  it('TR-B13: an empty site filter says the site has no members', async () => {
    const caller = callerFor(adminId, tenantId);
    await seedRequirement();
    const siteId = newId();
    await db.insert(schema.sites).values({
      id: siteId,
      tenantId,
      name: 'Riverside',
      kind: 'site',
      path: siteId,
    });
    const gaps = await caller.training.gaps({ siteId });
    expect(gaps.total).toBe(0);
    // …and says WHY, rather than reading as "no gaps".
    expect(gaps.siteHasNoMembers).toBe(true);
  });
});
