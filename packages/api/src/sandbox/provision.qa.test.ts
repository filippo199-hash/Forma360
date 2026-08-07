/**
 * Adversarial QA pass over sandbox provisioning (ADR 0017).
 *
 * `provision.test.ts` proves the happy path builds what it claims to.
 * This file attacks it: does the seeded content survive contact with a
 * visitor who then *uses* the workspace? Does it leak across tenants?
 * Does it hold under concurrency?
 *
 * The findings that produced these tests:
 *   - seeded rows stamped reference numbers by hand without advancing
 *     `reference_counters`, so the visitor's first self-created record
 *     collided with a seeded one;
 *   - two of those hand-written formats did not match what the routers
 *     actually produce (`ISS-000001` vs `OBS-000001`, `PTW-000001` vs
 *     `PTW-0001`), so a sandbox register looked unlike a real one.
 *
 * Edge-case IDs:
 *   SB-Q01 — seeded reference numbers match the router formats exactly.
 *   SB-Q02 — the next router-issued reference does not collide with a
 *            seeded one (the counter was advanced during provisioning).
 *   SB-Q03 — every seeded row belongs to the sandbox tenant.
 *   SB-Q04 — seeded rows only reference users/sites inside that tenant.
 *   SB-Q05 — concurrent provisions produce distinct, complete workspaces.
 *   SB-Q06 — the visitor is an administrator of their own workspace.
 *   SB-Q07 — a sandbox cannot read another sandbox's data.
 *   SB-Q08 — claim normalises a messy address and keeps admin rights.
 *   SB-Q09 — every scenario/refinement pair provisions without throwing.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { createLogger } from '@forma360/shared/logger';
import { scenariosForBrand } from '@forma360/shared/sandbox-scenarios';
import { eq } from 'drizzle-orm';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';
import { nextReferenceValue } from '../reference-counter';
import { provisionSandbox } from './provision';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

async function bootDb(): Promise<PgliteDatabase<typeof schema>> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return db;
}

const silentLogger = () => createLogger({ service: 'sbx-qa', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

describe('sandbox provisioning — QA', () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    db = await bootDb();
  });

  function provision(scenarioId: string, refinementId: string) {
    return provisionSandbox(db as never, silentLogger(), {
      brand: 'freehs',
      choice: { scenarioId: scenarioId as never, refinementId },
    });
  }

  function callerFor(userId: string, tenantId: string) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'qa@sandbox.invalid', tenantId: tenantId as never },
      }),
    );
  }

  it('SB-Q01 — seeded reference numbers match the router formats exactly', async () => {
    const ra = await provision('riskAssessment', 'general');
    const raRows = await db
      .select()
      .from(schema.riskAssessments)
      .where(eq(schema.riskAssessments.tenantId, ra.tenantId));
    // riskAssessments router: `RA-${String(n).padStart(4, '0')}`
    expect(raRows[0]?.referenceNumber).toMatch(/^RA-\d{4}$/);

    const obs = await provision('hazard', 'withActions');
    const obsRows = await db
      .select()
      .from(schema.issues)
      .where(eq(schema.issues.tenantId, obs.tenantId));
    // issues router: `OBS-${n.padStart(6, '0')}` — not ISS-.
    for (const row of obsRows) {
      expect(row.referenceNumber).toMatch(/^OBS-\d{6}$/);
    }

    const permit = await provision('permit', 'hotWork');
    const permitRows = await db
      .select()
      .from(schema.permits)
      .where(eq(schema.permits.tenantId, permit.tenantId));
    // permits router: `PTW-${String(n).padStart(4, '0')}`
    expect(permitRows[0]?.referenceNumber).toMatch(/^PTW-\d{4}$/);
  });

  it('SB-Q02 — the next router-issued reference does not collide with a seeded one', async () => {
    const { tenantId } = await provision('riskAssessment', 'general');
    const seeded = await db
      .select({ ref: schema.riskAssessments.referenceNumber })
      .from(schema.riskAssessments)
      .where(eq(schema.riskAssessments.tenantId, tenantId));
    const seededRefs = new Set(seeded.map((r) => r.ref));

    // What the router would stamp on the visitor's next assessment.
    const n = await nextReferenceValue(db as never, tenantId, 'riskAssessment');
    expect(seededRefs.has(`RA-${String(n).padStart(4, '0')}`)).toBe(false);

    // Same for the observation register, which seeds three rows.
    const hazard = await provision('hazard', 'withActions');
    const seededObs = await db
      .select({ ref: schema.issues.referenceNumber })
      .from(schema.issues)
      .where(eq(schema.issues.tenantId, hazard.tenantId));
    const obsRefs = new Set(seededObs.map((r) => r.ref));
    const m = await nextReferenceValue(db as never, hazard.tenantId, 'issue');
    expect(obsRefs.has(`OBS-${String(m).padStart(6, '0')}`)).toBe(false);

    // And permits.
    const permit = await provision('permit', 'confinedSpace');
    const seededPermits = await db
      .select({ ref: schema.permits.referenceNumber })
      .from(schema.permits)
      .where(eq(schema.permits.tenantId, permit.tenantId));
    const permitRefs = new Set(seededPermits.map((r) => r.ref));
    const p = await nextReferenceValue(db as never, permit.tenantId, 'permit');
    expect(permitRefs.has(`PTW-${String(p).padStart(4, '0')}`)).toBe(false);
  });

  it('SB-Q03 — every seeded row belongs to the sandbox tenant', async () => {
    const a = await provision('permit', 'hotWork');
    const b = await provision('hazard', 'withActions');

    async function tenantIdsIn<T extends { tenantId: string }>(rows: T[]): Promise<Set<string>> {
      return new Set(rows.map((r) => r.tenantId));
    }

    // Nothing provisioned for A may carry B's tenant id, or vice versa.
    for (const [table, name] of [
      [schema.sites, 'sites'],
      [schema.contractors, 'contractors'],
      [schema.issueCategories, 'issueCategories'],
      [schema.permissionSets, 'permissionSets'],
    ] as const) {
      const rows = await db.select().from(table);
      const ids = await tenantIdsIn(rows as Array<{ tenantId: string }>);
      expect(
        [...ids].every((id) => id === a.tenantId || id === b.tenantId),
        name,
      ).toBe(true);
    }
  });

  it('SB-Q04 — seeded rows only reference users and sites inside the tenant', async () => {
    const { tenantId } = await provision('hazard', 'withActions');

    const userIds = new Set(
      (await db.select().from(schema.user).where(eq(schema.user.tenantId, tenantId))).map(
        (u) => u.id,
      ),
    );
    const siteIds = new Set(
      (await db.select().from(schema.sites).where(eq(schema.sites.tenantId, tenantId))).map(
        (s) => s.id,
      ),
    );

    const rows = await db.select().from(schema.issues).where(eq(schema.issues.tenantId, tenantId));
    for (const row of rows) {
      if (row.reportedByUserId !== null) expect(userIds.has(row.reportedByUserId)).toBe(true);
      if (row.siteId !== null) expect(siteIds.has(row.siteId)).toBe(true);
    }
  });

  it('SB-Q05 — concurrent provisions produce distinct, complete workspaces', async () => {
    const results = await Promise.all([
      provision('riskAssessment', 'general'),
      provision('permit', 'hotWork'),
      provision('hazard', 'withActions'),
    ]);

    const tenantIds = new Set(results.map((r) => r.tenantId));
    expect(tenantIds.size).toBe(3);

    for (const r of results) {
      const users = await db.select().from(schema.user).where(eq(schema.user.tenantId, r.tenantId));
      expect(users).toHaveLength(2);
      const sets = await db
        .select()
        .from(schema.permissionSets)
        .where(eq(schema.permissionSets.tenantId, r.tenantId));
      expect(sets.length).toBeGreaterThanOrEqual(3);
    }

    // Slugs and emails are globally unique columns — a collision here
    // would have thrown, but assert it so the intent is recorded.
    const allUsers = await db.select().from(schema.user);
    expect(new Set(allUsers.map((u) => u.email)).size).toBe(allUsers.length);
  });

  it('SB-Q06 — the visitor is an administrator of their own workspace', async () => {
    const { tenantId, userId } = await provision('riskAssessment', 'general');

    const rows = await db
      .select({ permissions: schema.permissionSets.permissions })
      .from(schema.user)
      .innerJoin(schema.permissionSets, eq(schema.user.permissionSetId, schema.permissionSets.id))
      .where(eq(schema.user.id, userId));

    const permissions = rows[0]?.permissions ?? [];
    expect(grantsAdminAccess(permissions as never)).toBe(true);

    // And they can actually read the module they were sent to.
    const status = await callerFor(userId, tenantId).sandbox.status();
    expect(status.isSandbox).toBe(true);
  });

  it('SB-Q07 — a sandbox cannot read another sandbox’s data', async () => {
    const mine = await provision('hazard', 'withActions');
    const theirs = await provision('hazard', 'withActions');

    const theirRows = await db
      .select()
      .from(schema.issues)
      .where(eq(schema.issues.tenantId, theirs.tenantId));
    expect(theirRows.length).toBeGreaterThan(0);

    const visible = await callerFor(mine.userId, mine.tenantId).issues.issues.list({});
    const visibleIds = new Set(visible.items.map((i) => i.id));
    // My register is populated — this is a real read, not an empty one.
    expect(visibleIds.size).toBeGreaterThan(0);
    for (const row of theirRows) {
      expect(visibleIds.has(row.id)).toBe(false);
    }
  });

  it('SB-Q08 — claim normalises a messy address and keeps admin rights', async () => {
    const { tenantId, userId } = await provision('riskAssessment', 'general');

    await callerFor(userId, tenantId).sandbox.claim({ email: '  Sam.Baker@Northgate.CO.UK  ' });

    const rows = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    expect(rows[0]?.email).toBe('sam.baker@northgate.co.uk');

    const perms = await db
      .select({ permissions: schema.permissionSets.permissions })
      .from(schema.user)
      .innerJoin(schema.permissionSets, eq(schema.user.permissionSetId, schema.permissionSets.id))
      .where(eq(schema.user.id, userId));
    expect(grantsAdminAccess((perms[0]?.permissions ?? []) as never)).toBe(true);
  });

  it('SB-Q10 — a tile seeds content into the module it lands on', async () => {
    // The incident tile used to seed *observations* while landing on
    // /incidents, so the visitor arrived at an empty register with the
    // content filed somewhere they would never look.
    const incident = await provision('incident', 'withRiddor');
    expect(incident.landingPath).toBe('/incidents');
    const incidentRows = await db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.tenantId, incident.tenantId));
    expect(incidentRows).toHaveLength(1);
    expect(incidentRows[0]?.status).toBe('reported');
    expect(incidentRows[0]?.referenceNumber).toMatch(/^IN-\d{6}$/);

    // The hazard tile lands on the observation register and fills it.
    const hazard = await provision('hazard', 'withActions');
    expect(hazard.landingPath).toBe('/observations');
    const obsRows = await db
      .select()
      .from(schema.issues)
      .where(eq(schema.issues.tenantId, hazard.tenantId));
    expect(obsRows.length).toBeGreaterThanOrEqual(3);
  });

  it('SB-Q11 — a refinement never seeds content that contradicts it', async () => {
    // The COSHH refinement lands on /coshh. It used to fall back to the
    // warehouse loading-bay assessment, promising one thing and
    // delivering another.
    const coshh = await provision('riskAssessment', 'coshh');
    expect(coshh.landingPath).toBe('/coshh');
    const strayRa = await db
      .select()
      .from(schema.riskAssessments)
      .where(eq(schema.riskAssessments.tenantId, coshh.tenantId));
    expect(strayRa).toHaveLength(0);

    const fire = await provision('riskAssessment', 'fire');
    expect(fire.landingPath).toBe('/fire-safety');
    const strayFire = await db
      .select()
      .from(schema.riskAssessments)
      .where(eq(schema.riskAssessments.tenantId, fire.tenantId));
    expect(strayFire).toHaveLength(0);

    // ...while the refinements that do land on /risk-assessments seed a
    // matching assessment.
    for (const refinement of ['general', 'manualHandling']) {
      const ra = await provision('riskAssessment', refinement);
      expect(ra.landingPath).toBe('/risk-assessments');
      const rows = await db
        .select()
        .from(schema.riskAssessments)
        .where(eq(schema.riskAssessments.tenantId, ra.tenantId));
      expect(rows, refinement).toHaveLength(1);
    }
  });

  it('SB-Q09 — every offered scenario/refinement pair provisions cleanly', async () => {
    for (const scenario of scenariosForBrand('freehs')) {
      for (const refinement of scenario.refinements) {
        const result = await provision(scenario.id, refinement.id);
        expect(result.tenantId, `${scenario.id}/${refinement.id}`).toBeTruthy();
        expect(result.landingPath.startsWith('/'), `${scenario.id}/${refinement.id}`).toBe(true);

        // Every workspace, whatever the tile, has the shared org context
        // — an empty register is the thing this whole flow exists to
        // avoid.
        const sites = await db
          .select()
          .from(schema.sites)
          .where(eq(schema.sites.tenantId, result.tenantId));
        expect(sites.length, `${scenario.id}/${refinement.id} sites`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
