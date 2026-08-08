/**
 * Training & competence matrix — audit fix verification (FreeHS module B7).
 *
 * The 7 August 2026 audit found four defects that a prose review could not
 * reach (a second tenant, a second custom field, concurrency, and volume).
 * These tests prove each is fixed and stays fixed:
 *
 *   - TR-T05  addAssignment rejects a group / site / user id from another
 *             tenant (ground rule 4), instead of writing a silently-dead rule.
 *   - TR-C07  the role custom-field is chosen deterministically (lowest order,
 *             then oldest), so a decoy field cannot strip a person of a
 *             statutory requirement depending on database return order.
 *   - TR-I06  the record natural key is enforced by a partial unique index —
 *             a racing insert can no longer duplicate a row, a superseded row
 *             frees the key for a correction, and a re-import is a no-op.
 *   - TR-V02  an unfiltered matrix over the cell ceiling is refused; a site or
 *             requirement filter bounds and admits it.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import { createLogger } from '@forma360/shared/logger';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
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
  // Every .sql in order, so migration 0074 (the natural-key index) is applied.
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
  createLogger({ service: 'training-audit', level: 'fatal', nodeEnv: 'test' });

const NOW = new Date('2026-08-06T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (offsetDays: number): string =>
  new Date(NOW.getTime() + offsetDays * DAY).toISOString().slice(0, 10);

describe('training router — audit fixes (FreeHS B7)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let otherTenantId: string;
  let adminId: string;
  let operatorId: string;
  let stdSetId: string;

  function callerFor(userId: string, tenant: string) {
    const appRouter = router({ training: createTrainingRouter({ enabled: true, now: () => NOW }) });
    return createCallerFactory(appRouter)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'audit@x.test', tenantId: tenant as never },
      }),
    );
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    otherTenantId = newId();
    adminId = newId();
    operatorId = newId();
    for (const [id, name] of [
      [tenantId, 'Precision'],
      [otherTenantId, 'Other Co'],
    ] as const) {
      await db.insert(schema.tenants).values({ id, name, slug: id.slice(-8).toLowerCase() });
    }
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    const otherSets = await seedDefaultPermissionSets(db as never, otherTenantId);
    stdSetId = sets.standard;
    await db.insert(schema.user).values([
      {
        id: adminId,
        tenantId,
        name: 'Priya Nair',
        email: 'priya@x.test',
        emailVerified: true,
        permissionSetId: sets.administrator,
      },
      {
        id: operatorId,
        tenantId,
        name: 'Dave Mullins',
        email: 'dave@x.test',
        emailVerified: true,
        permissionSetId: sets.standard,
      },
    ]);
    // A different admin lives in the other tenant, so its permission sets exist.
    await db.insert(schema.user).values({
      id: newId(),
      tenantId: otherTenantId,
      name: 'Rival Rob',
      email: 'rob@other.test',
      emailVerified: true,
      permissionSetId: otherSets.administrator,
    });
    // The tenant's job-title vocabulary; role assignment reads this field.
    await db
      .insert(schema.customUserFields)
      .values({ id: newId(), tenantId, name: 'Role', type: 'text', order: 0 });
  });

  afterEach(async () => {
    await client.close();
  });

  async function createRequirement(
    name: string,
    obligation: 'statutory' | 'mandatory' = 'mandatory',
  ) {
    const { id } = await callerFor(adminId, tenantId).training.createRequirement({
      name,
      category: null,
      obligation,
      validityMonths: 36,
      renewalLeadDays: 60,
      evidenceNote: null,
      description: null,
    });
    return id;
  }

  async function roleFieldId(): Promise<string> {
    const rows = await db
      .select({ id: schema.customUserFields.id })
      .from(schema.customUserFields)
      .where(
        and(
          eq(schema.customUserFields.tenantId, tenantId),
          eq(schema.customUserFields.name, 'Role'),
        ),
      );
    return rows[0]?.id ?? '';
  }

  function recordFor(requirementId: string) {
    return {
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
      source: 'external' as const,
      notes: null,
    };
  }

  // ─── TR-T05 ─────────────────────────────────────────────────────────────
  it('TR-T05: addAssignment refuses a group / site / user id from another tenant', async () => {
    const admin = callerFor(adminId, tenantId);
    const requirementId = await createRequirement('Manual handling');

    const foreignGroup = newId();
    const foreignSite = newId();
    const foreignUser = newId();
    await db
      .insert(schema.groups)
      .values({ id: foreignGroup, tenantId: otherTenantId, name: 'Grp' });
    await db
      .insert(schema.sites)
      .values({ id: foreignSite, tenantId: otherTenantId, name: 'Site' });
    await db.insert(schema.user).values({
      id: foreignUser,
      tenantId: otherTenantId,
      name: 'Foreign Op',
      email: 'foreign@other.test',
      emailVerified: true,
      permissionSetId: stdSetId, // value irrelevant; the FK check is on the tenant
    });

    await expect(
      admin.training.addAssignment({
        requirementId,
        scope: 'group',
        roleName: null,
        groupId: foreignGroup,
        siteId: null,
        userId: null,
      }),
    ).rejects.toThrow();
    await expect(
      admin.training.addAssignment({
        requirementId,
        scope: 'site',
        roleName: null,
        groupId: null,
        siteId: foreignSite,
        userId: null,
      }),
    ).rejects.toThrow();
    await expect(
      admin.training.addAssignment({
        requirementId,
        scope: 'person',
        roleName: null,
        groupId: null,
        siteId: null,
        userId: foreignUser,
      }),
    ).rejects.toThrow();

    // Nothing was written — not even a silently-dead row.
    const dead = await db
      .select()
      .from(schema.trainingRequirementAssignments)
      .where(eq(schema.trainingRequirementAssignments.tenantId, tenantId));
    expect(dead).toHaveLength(0);

    // Control: a group that DOES belong to the tenant is accepted.
    const ownGroup = newId();
    await db.insert(schema.groups).values({ id: ownGroup, tenantId, name: 'Fitters' });
    await expect(
      admin.training.addAssignment({
        requirementId,
        scope: 'group',
        roleName: null,
        groupId: ownGroup,
        siteId: null,
        userId: null,
      }),
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  // ─── TR-C07 ─────────────────────────────────────────────────────────────
  it('TR-C07: a decoy role field cannot override the real one; the pick is deterministic', async () => {
    const admin = callerFor(adminId, tenantId);
    const requirementId = await createRequirement('Abrasive wheels', 'statutory');
    await admin.training.addAssignment({
      requirementId,
      scope: 'role',
      roleName: 'Machine operator',
      groupId: null,
      siteId: null,
      userId: null,
    });

    // The real field says the operator is a machine operator → required.
    await db.insert(schema.userCustomFieldValues).values({
      tenantId,
      userId: operatorId,
      fieldId: await roleFieldId(),
      value: 'Machine operator',
    });
    // A decoy field ALSO matches /role|job title|position/ but sorts after
    // (higher order). Merged last-wins it could mislabel him a cleaner and
    // silently drop the statutory requirement.
    const decoy = newId();
    await db
      .insert(schema.customUserFields)
      .values({ id: decoy, tenantId, name: 'Job title', type: 'text', order: 5 });
    await db
      .insert(schema.userCustomFieldValues)
      .values({ tenantId, userId: operatorId, fieldId: decoy, value: 'Cleaner' });

    // Deterministic pick = the real 'Role' (order 0), so the gap still stands.
    const gaps = await admin.training.gaps({});
    const daveGap = gaps.notHeld.find((g) => g.personName === 'Dave Mullins');
    expect(daveGap).toBeDefined();
    expect(daveGap?.requirementId).toBe(requirementId);
  });

  // ─── TR-I06 ─────────────────────────────────────────────────────────────
  it('TR-I06: a second active record with the same natural key is refused; superseding frees it', async () => {
    const admin = callerFor(adminId, tenantId);
    const requirementId = await createRequirement('First aid');
    const rec = recordFor(requirementId);

    const first = await admin.training.addRecord(rec);
    expect(first.id).toBeDefined();

    // Same requirement + person + achieved date while the first is active →
    // a clean BAD_REQUEST, never a raw constraint 500.
    await expect(admin.training.addRecord(rec)).rejects.toThrow(/duplicate-record/);

    // Void the first (a correction), and the same key is available again.
    await admin.training.supersedeRecord({ id: first.id, reason: 'typo' });
    await expect(admin.training.addRecord(rec)).resolves.toMatchObject({ id: expect.any(String) });
  });

  it('TR-I06: the partial unique index is enforced at the database, not just in memory', async () => {
    const requirementId = await createRequirement('Working at height');
    const row = {
      tenantId,
      requirementId,
      userId: operatorId,
      personName: 'Dave Mullins',
      achievedAt: new Date(`${iso(-30)}T00:00:00.000Z`),
    };
    await db.insert(schema.trainingRecords).values({ id: newId(), ...row });
    // A direct second insert bypasses the router's onConflictDoNothing, so it
    // is the index itself that must reject it — the guarantee the import
    // dedupe assumed but never had.
    await expect(
      db.insert(schema.trainingRecords).values({ id: newId(), ...row }),
    ).rejects.toThrow();
  });

  it('TR-I06: re-importing the same rows imports nothing and reports them skipped', async () => {
    const admin = callerFor(adminId, tenantId);
    await createRequirement('Fire marshal');
    const rows = [
      { personName: 'Nia Roberts', requirementName: 'Fire marshal', achievedAt: iso(-20) },
    ];
    const firstRun = await admin.training.importRecords({ rows, skipped: [], dryRun: false });
    expect(firstRun.imported).toBe(1);

    const secondRun = await admin.training.importRecords({ rows, skipped: [], dryRun: false });
    expect(secondRun.imported).toBe(0);
    expect(secondRun.skippedDuplicates).toBe(1);
  });

  // ─── TR-V02 ─────────────────────────────────────────────────────────────
  it('TR-V02: an unfiltered matrix over the cell ceiling is refused; a filter admits it', async () => {
    const admin = callerFor(adminId, tenantId);

    // ~102 people × 55 requirements = 5610 cells, over the 5000 ceiling.
    const extraUsers = Array.from({ length: 100 }, (_, i) => ({
      id: newId(),
      tenantId,
      name: `Operative ${i}`,
      email: `op${i}@x.test`,
      emailVerified: true,
      permissionSetId: stdSetId,
    }));
    await db.insert(schema.user).values(extraUsers);
    const reqs = Array.from({ length: 55 }, (_, i) => ({
      id: newId(),
      tenantId,
      name: `Requirement ${i}`,
    }));
    await db.insert(schema.trainingRequirements).values(reqs);

    // No filter → refused, with the actionable code the web page keys on.
    await expect(admin.training.matrix({})).rejects.toThrow(/matrix-too-large/);
    await expect(admin.training.matrix()).rejects.toThrow(/matrix-too-large/);

    // A requirement filter bounds the grid to one column → admitted.
    await expect(
      admin.training.matrix({ requirementId: reqs[0]?.id ?? '' }),
    ).resolves.toBeDefined();

    // A site filter narrows the people → admitted (even with no members yet).
    const site = newId();
    await db.insert(schema.sites).values({ id: site, tenantId, name: 'Yard' });
    await expect(admin.training.matrix({ siteId: site })).resolves.toBeDefined();
  });
});
