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
 * Edge-case IDs: SB-V01..V13.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { createLogger } from '@forma360/shared/logger';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
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

  /**
   * The `reviewPack` tile LANDS on the contractor-review workspace. A
   * pack written into our own register does not put anything there, and
   * the visitor who asked to review a contractor's RAMS was shown "No
   * contractor packs awaiting review". This asserts through the exact
   * query that page runs.
   */
  it('SB-V11 — the reviewPack tile puts a contractor pack in the review queue', async () => {
    const { caller } = await visitorFor('rams', 'reviewPack');
    const pending = await caller.rams.reviews.list({ outcome: 'pending' });
    expect(
      pending.length,
      'the review page would read "No contractor packs awaiting review"',
    ).toBeGreaterThanOrEqual(1);
  });

  /**
   * The `withActions` refinement is named for corrective actions, and
   * the actions board read 0 / 0 / 0 / 0 in the workspace built around
   * them.
   */
  it('SB-V12 — the withActions tile fills the actions board', async () => {
    const { caller } = await visitorFor('hazard', 'withActions');
    const listed = await caller.actions.list({});
    expect(listed.rows.length, 'the actions board would read 0/0/0/0').toBeGreaterThanOrEqual(2);
    // Raised from an observation, and linked back to it — an action with
    // no source is a to-do, not a corrective action.
    expect(listed.rows.every((r) => r.sourceType === 'issue' && r.sourceId !== null)).toBe(true);
  });

  /**
   * Every tenant opened the "Action type" dropdown to one entry — "No
   * type" — which is the NULL fallback, not a choice. The field that
   * classifies an action as corrective could classify nothing.
   */
  it('SB-V13 — the action-type dropdown is not empty', async () => {
    const { caller } = await visitorFor('hazard', 'withActions');
    const types = await caller.actionTypes.list({});
    expect(types.length, 'the type dropdown would offer only "No type"').toBeGreaterThanOrEqual(3);
    expect(
      types.some((t) => t.name === 'Corrective'),
      'the corrective-actions module needs a Corrective type',
    ).toBe(true);
  });

  it('SB-V09 — the seeded risk assessment can actually be published', async () => {
    // The tile promises a document the visitor walks out holding. If
    // publish refuses, the promise dies at the last step — and it did:
    // a seeded hazard with a HIGH residual and no justification blocked
    // it, and the error named a hazard that was not the visitor's.
    const { caller, tenantId } = await visitorFor('riskAssessment', 'general');

    const hazards = await db
      .select()
      .from(schema.riskAssessmentHazards)
      .where(eq(schema.riskAssessmentHazards.tenantId, tenantId));
    const bySort = [...hazards].sort((a, b) => a.sortOrder - b.sortOrder);
    const mine = bySort[bySort.length - 1];
    const assessmentId = mine?.assessmentId ?? '';

    // Do exactly what the visitor does: work the one open hazard.
    await caller.riskAssessments.addControl({
      hazardId: mine?.id ?? '',
      description: 'Team lift for anything over 20 kg, with a pallet truck for mixed pallets',
      tier: 'administrative',
      status: 'in_place',
    });
    await caller.riskAssessments.updateHazard({
      hazardId: mine?.id ?? '',
      residualLikelihood: 2,
      residualSeverity: 2,
    });

    // ...and publish. No actionAssignments: every control is in place.
    await expect(
      caller.riskAssessments.publish({ assessmentId, confirmSignOff: true }),
    ).resolves.toBeDefined();

    const after = await db
      .select()
      .from(schema.riskAssessments)
      .where(eq(schema.riskAssessments.id, assessmentId));
    expect(after[0]?.status, 'a published assessment is active').toBe('active');
    expect(after[0]?.currentVersion, 'publish snapshots a version').toBeGreaterThanOrEqual(1);
  });

  it('SB-V10 — the visitor cannot mail strangers from our sending domain', async () => {
    const { caller } = await visitorFor('riskAssessment', 'general');

    // users.invite composes a domain-authenticated email with
    // self-service text in the subject, to any address in the world.
    await expect(
      caller.users.invite({
        email: 'victim@example.com',
        permissionSetId: '01JQZZZZZZZZZZZZZZZZZZZZZZ',
      }),
    ).rejects.toThrow(/FORBIDDEN|permission/i);
  });
});
