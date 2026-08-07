/**
 * Would the visitor actually SEE the seeded content?
 *
 * `provision.goals.test.ts` asserts the rows exist. That is necessary
 * and not sufficient: a row can exist and still be invisible, because
 * every register filters — by status, by `archivedAt IS NULL`, by
 * `isCurrent`, by permission. The inspections tile shipped broken in a
 * way that row-level assertions would not have caught either, and the
 * near-miss after it was `templates.currentVersionId`: the row was
 * there, the flag was set, and the start-inspection picker still would
 * not have offered it.
 *
 * So this file asserts through the ACTUAL tRPC procedures the pages
 * call, as the provisioned visitor, with their real permission set.
 * If a filter would hide the seed, these fail.
 *
 * Edge-case IDs: SB-V01..V08.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { createLogger } from '@forma360/shared/logger';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';
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

const silentLogger = () => createLogger({ service: 'sbx-vis', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

describe('sandbox content is visible through the real API', () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    db = await bootDb();
  });

  /** Provision a tile and return a caller authenticated AS that visitor. */
  async function visitorFor(scenarioId: string, refinementId: string) {
    const { tenantId, userId, landingPath } = await provisionSandbox(db as never, silentLogger(), {
      brand: 'freehs',
      choice: { scenarioId: scenarioId as never, refinementId },
    });
    const caller = createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'v@sandbox.invalid', tenantId: tenantId as never },
      }),
    );
    return { caller, tenantId, userId, landingPath };
  }

  it('SB-V01 — the inspection template is offered by the start picker', async () => {
    const { caller } = await visitorFor('inspection', 'siteWalk');

    // Exactly what TemplatePickerDialog asks for.
    const published = await caller.templates.list({ status: 'published' });
    const offerable = published.filter(
      (t: { currentVersionId: string | null; archivedAt: Date | null }) =>
        t.currentVersionId !== null && t.archivedAt === null,
    );

    expect(offerable.length, 'the picker would show no template to start').toBeGreaterThanOrEqual(
      1,
    );
    expect(offerable[0]?.name).toContain('walkthrough');
  });

  it('SB-V02 — the in-progress inspection appears in the register', async () => {
    const { caller } = await visitorFor('inspection', 'siteWalk');

    const listed = await caller.inspections.list({});
    const rows = Array.isArray(listed) ? listed : (listed as { items: unknown[] }).items;
    expect(rows.length, 'the inspections register would be empty').toBeGreaterThanOrEqual(1);
  });

  it('SB-V03 — every inspection refinement offers its own template', async () => {
    for (const refinement of ['siteWalk', 'equipment', 'vehicles', 'fireChecks']) {
      db = await bootDb();
      const { caller } = await visitorFor('inspection', refinement);
      const published = await caller.templates.list({ status: 'published' });
      expect(published.length, `${refinement} offers nothing`).toBeGreaterThanOrEqual(1);
      expect(
        published[0]?.currentVersionId,
        `${refinement} template is not startable`,
      ).not.toBeNull();
    }
  });

  it('SB-V04 — the risk assessment is listed', async () => {
    const { caller } = await visitorFor('riskAssessment', 'general');
    const listed = await caller.riskAssessments.list({ status: 'all', type: 'all' });
    const rows = Array.isArray(listed) ? listed : (listed as { items: unknown[] }).items;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('SB-V05 — the COSHH substance survives the default active filter', async () => {
    const { caller, landingPath } = await visitorFor('riskAssessment', 'coshh');
    expect(landingPath).toBe('/coshh');
    // The register defaults to status 'active'; a substance in any other
    // state is invisible on first load.
    const listed = await caller.coshh.substances.list({ status: 'active' });
    const rows = Array.isArray(listed) ? listed : (listed as { items: unknown[] }).items;
    expect(rows.length, 'the COSHH register would be empty').toBeGreaterThanOrEqual(1);
  });

  it('SB-V06 — the fire building survives the default active filter', async () => {
    const { caller, landingPath } = await visitorFor('riskAssessment', 'fire');
    expect(landingPath).toBe('/fire-safety');
    const listed = await caller.fireSafety.buildings.list({ status: 'active' });
    const rows = Array.isArray(listed) ? listed : (listed as { items: unknown[] }).items;
    expect(rows.length, 'the fire register would be empty').toBeGreaterThanOrEqual(1);
  });

  it('SB-V07 — the RAMS pack is listed', async () => {
    const { caller } = await visitorFor('rams', 'reviewPack');
    const listed = await caller.rams.packs.list({});
    const rows = Array.isArray(listed) ? listed : (listed as { items: unknown[] }).items;
    expect(rows.length, 'the RAMS register would be empty').toBeGreaterThanOrEqual(1);
  });

  it('SB-V08 — permits, incidents and observations are listed', async () => {
    const permit = await visitorFor('permit', 'hotWork');
    const permitListed = await permit.caller.permits.list({});
    const permitRows = Array.isArray(permitListed)
      ? permitListed
      : (permitListed as { items: unknown[] }).items;
    expect(permitRows.length, 'the permit register would be empty').toBeGreaterThanOrEqual(1);

    db = await bootDb();
    const incident = await visitorFor('incident', 'withRiddor');
    const incidentListed = await incident.caller.incidents.list({});
    const incidentRows = Array.isArray(incidentListed)
      ? incidentListed
      : (incidentListed as { items: unknown[] }).items;
    expect(incidentRows.length, 'the incident register would be empty').toBeGreaterThanOrEqual(1);

    db = await bootDb();
    const hazard = await visitorFor('hazard', 'withActions');
    const issueListed = await hazard.caller.issues.issues.list({});
    expect(
      issueListed.items.length,
      'the observation register would be empty',
    ).toBeGreaterThanOrEqual(3);
  });
});
