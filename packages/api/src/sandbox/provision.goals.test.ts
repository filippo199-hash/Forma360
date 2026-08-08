/**
 * Every tile's goal, asserted against a real provisioned workspace.
 *
 * This file exists because a tile shipped that promised a
 * site-walkthrough template and delivered an empty inspections page.
 * The seed for it simply returned, and the gap was written down in a
 * comment instead of being closed. A comment cannot fail CI.
 *
 * The contract here is structural, not documentary:
 *
 *   1. `GOAL_ASSERTIONS` is a `Record<SandboxScenarioId, …>`, so adding
 *      a tile to the catalogue without an assertion is a TYPE error.
 *   2. The suite walks EVERY tile and EVERY refinement the brand
 *      offers — not a chosen sample — and runs that tile's assertion
 *      against the rows provisioning actually wrote.
 *   3. Every assertion checks for content in the module the visitor
 *      LANDS ON. A row written somewhere they will never look does not
 *      count as landing on something.
 *
 * If you add a tile, you must make its goal true. There is no path
 * through this file that lets an empty register ship.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { createLogger } from '@forma360/shared/logger';
import { scenariosForBrand, type SandboxScenarioId } from '@forma360/shared/sandbox-scenarios';
import { effectiveFlaggedOptionIds } from '@forma360/shared/template-schema';
import { and, eq } from 'drizzle-orm';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
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

const silentLogger = () => createLogger({ service: 'sbx-goals', level: 'fatal', nodeEnv: 'test' });

/** What an assertion receives: the tenant it must inspect, and which refinement produced it. */
interface GoalContext {
  db: PgliteDatabase<typeof schema>;
  tenantId: string;
  refinementId: string;
  /** Locale-relative route the visitor was sent to. */
  landingPath: string;
}

type GoalAssertion = (ctx: GoalContext) => Promise<void>;

/**
 * One assertion per tile. Typed as a full Record over the scenario-id
 * union, so a new tile fails to compile until its goal is asserted.
 */
const GOAL_ASSERTIONS: Record<SandboxScenarioId, GoalAssertion> = {
  /**
   * Goal: a draft assessment with worked hazards and one left unrated.
   * The COSHH and fire refinements land elsewhere and must furnish
   * THAT module instead.
   */
  riskAssessment: async ({ db, tenantId, refinementId, landingPath }) => {
    if (refinementId === 'coshh') {
      expect(landingPath).toBe('/coshh');
      const substances = await db
        .select()
        .from(schema.coshhSubstances)
        .where(eq(schema.coshhSubstances.tenantId, tenantId));
      expect(substances.length, 'coshh refinement must seed a substance').toBeGreaterThanOrEqual(1);
      expect(substances[0]?.referenceNumber, 'blank reference reads as broken').toMatch(
        /^CS-\d{4}$/,
      );

      // An assessment clears the red "no assessment" chip on the row.
      const assessments = await db
        .select()
        .from(schema.coshhAssessments)
        .where(eq(schema.coshhAssessments.tenantId, tenantId));
      expect(assessments.length, 'substance must carry an assessment').toBeGreaterThanOrEqual(1);

      // An `active` COSHH assessment with no controls is not a valid
      // assessment — and this is the one module where an empty shell
      // misrepresents the product's own standard to a visitor whose
      // first sight of it is this record.
      const controls = await db
        .select()
        .from(schema.coshhAssessmentControls)
        .where(eq(schema.coshhAssessmentControls.tenantId, tenantId));
      expect(
        controls.length,
        'an active assessment with zero controls would fail an inspection',
      ).toBeGreaterThanOrEqual(3);
      const tiers = new Set(controls.map((c) => c.tier));
      expect(
        [...tiers].some((t) => t !== 'ppe' && t !== 'rpe'),
        'controls cannot be PPE-only — that is the last resort, not the answer',
      ).toBe(true);
      expect(assessments[0]?.routesOfExposure.length, 'routes of exposure').toBeGreaterThan(0);
      expect(assessments[0]?.personsExposed.length, 'who is exposed').toBeGreaterThan(0);
      // A review already due would light an amber chip on a brand-new workspace.
      const due = assessments[0]?.nextReviewAt;
      expect(due === null || due === undefined || due.getTime() > Date.now()).toBe(true);
      return;
    }
    if (refinementId === 'fire') {
      expect(landingPath).toBe('/fire-safety');
      const buildings = await db
        .select()
        .from(schema.fireBuildings)
        .where(eq(schema.fireBuildings.tenantId, tenantId));
      expect(buildings.length, 'fire refinement must seed a building').toBeGreaterThanOrEqual(1);

      // A draft FRA makes the register print "FRA missing" — only an
      // active one counts as in place.
      const fras = await db
        .select()
        .from(schema.fireRiskAssessments)
        .where(eq(schema.fireRiskAssessments.tenantId, tenantId));
      expect(fras.length, 'building must carry an FRA').toBeGreaterThanOrEqual(1);
      expect(fras[0]?.status, 'a draft FRA reads as missing').toBe('active');
      expect(fras[0]?.riskRating, 'intolerable would flag a brand-new workspace').not.toBe(
        'intolerable',
      );
      return;
    }

    expect(landingPath).toBe('/risk-assessments');
    const assessments = await db
      .select()
      .from(schema.riskAssessments)
      .where(eq(schema.riskAssessments.tenantId, tenantId));
    expect(assessments.length, 'must seed one assessment').toBe(1);
    expect(assessments[0]?.status).toBe('draft');

    const hazards = await db
      .select()
      .from(schema.riskAssessmentHazards)
      .where(eq(schema.riskAssessmentHazards.tenantId, tenantId));
    expect(hazards.length, 'must seed at least two hazards').toBeGreaterThanOrEqual(2);

    const bySort = [...hazards].sort((a, b) => a.sortOrder - b.sortOrder);
    const last = bySort[bySort.length - 1];
    expect(last?.residualLikelihood, 'last hazard is the visitor decision').toBeNull();

    const controls = await db
      .select()
      .from(schema.riskAssessmentControls)
      .where(eq(schema.riskAssessmentControls.tenantId, tenantId));
    expect(controls.length, 'earlier hazards must be worked').toBeGreaterThan(0);
  },

  /**
   * Goal: a published template matching the subject, runnable, plus one
   * inspection already in progress. This is the tile that shipped
   * broken.
   */
  inspection: async ({ db, tenantId, landingPath }) => {
    expect(landingPath).toBe('/inspections');

    const templates = await db
      .select()
      .from(schema.templates)
      .where(eq(schema.templates.tenantId, tenantId));
    expect(templates.length, 'must seed a template').toBeGreaterThanOrEqual(1);
    expect(templates[0]?.status, 'template must be published, not draft').toBe('published');

    const versions = await db
      .select()
      .from(schema.templateVersions)
      .where(
        and(
          eq(schema.templateVersions.tenantId, tenantId),
          eq(schema.templateVersions.isCurrent, true),
        ),
      );
    expect(versions.length, 'must have a current version to run').toBe(1);
    expect(
      versions[0]?.publishedAt,
      'a version without publishedAt is not published',
    ).not.toBeNull();

    // The field that actually makes it startable. `inspections.create`
    // pins from `templates.currentVersionId`, and the start-inspection
    // picker filters on it — a template with `is_current` set but this
    // column null looks published and cannot be run. Asserting only the
    // flag is how the first version of this test passed while the tile
    // was still broken.
    expect(templates[0]?.currentVersionId, 'template must pin its current version').toBe(
      versions[0]?.id,
    );
    expect(templates[0]?.titleFormat, 'title renderer reads the column, not the content').toBe(
      versions[0]?.content.settings.titleFormat,
    );

    const content = versions[0]?.content;
    expect(content, 'version must carry content').toBeTruthy();
    const pages = content?.pages ?? [];
    const questionCount = pages.flatMap((p) => p.sections).flatMap((s) => s.items).length;
    expect(questionCount, 'template must have real questions').toBeGreaterThanOrEqual(3);

    const inspections = await db
      .select()
      .from(schema.inspections)
      .where(eq(schema.inspections.tenantId, tenantId));
    expect(inspections.length, 'register must not be empty').toBeGreaterThanOrEqual(1);
    const run = inspections[0];
    expect(run?.templateVersionId, 'inspection must pin its version').toBe(versions[0]?.id);

    // "Already underway" has to mean something. The first cut wrote the
    // row and no answers, so the tile promised work in progress and
    // delivered a title, a date and a status badge.
    const answered = Object.keys((run?.responses ?? {}) as Record<string, unknown>).length;
    expect(answered, 'an inspection with no answers is not underway').toBeGreaterThanOrEqual(2);
    expect(answered, 'leave the visitor something to finish').toBeLessThan(questionCount);

    // Without this the conduct screen shows a name and the finished
    // report prints "Prepared by —".
    expect(run?.conductedBy, 'the run needs a named author').not.toBeNull();

    // None of the seeded answers may be a flagged one: a seeded failure
    // raises a corrective action the visitor never agreed to.
    const setsById = new Map((content?.customResponseSets ?? []).map((cs) => [cs.id, cs]));
    for (const page of pages) {
      for (const section of page.sections) {
        for (const item of section.items) {
          if (item.type !== 'multipleChoice') continue;
          const answer = (run?.responses as Record<string, unknown>)[item.id];
          if (typeof answer !== 'string') continue;
          const set = setsById.get(item.responseSetId);
          const flagged = new Set(effectiveFlaggedOptionIds(item, set as never));
          expect(
            flagged.has(answer),
            `seeded answer on "${item.prompt}" must not be a failure`,
          ).toBe(false);
        }
      }
    }
  },

  /**
   * Goal: three observations, two still open and one closed — the exact
   * words on the tile. Plus, on `withActions`, an action against each
   * open one, because that refinement is NAMED for corrective actions
   * and shipped an actions board reading 0/0/0/0.
   */
  hazard: async ({ db, tenantId, refinementId, landingPath }) => {
    expect(landingPath).toBe('/observations');
    const rows = await db.select().from(schema.issues).where(eq(schema.issues.tenantId, tenantId));
    expect(rows.length, 'register must hold three reports').toBe(3);
    expect(rows.filter((r) => r.status === 'open').length, 'two must still be open').toBe(2);
    expect(
      rows.filter((r) => r.status === 'closed').length,
      'one must be closed — the promise says "two still open"',
    ).toBe(1);
    expect(new Set(rows.map((r) => r.referenceNumber)).size).toBe(rows.length);

    // A register whose every row shares one timestamp reads as staged.
    const days = new Set(rows.map((r) => r.dateOccurred.toISOString().slice(0, 10)));
    expect(days.size, 'reports must have a history, not one shared second').toBe(3);

    // ...and one that is all at one site does not exercise the filter.
    expect(new Set(rows.map((r) => r.siteId)).size, 'spread across both sites').toBeGreaterThan(1);

    // Only the anonymous refinement demonstrates the QR channel; on the
    // others an unattributed report reads as broken, not deliberate.
    const anon = rows.filter((r) => r.reportedByUserId === null);
    expect(anon.length, 'anonymous only where the visitor asked for it').toBe(
      refinementId === 'anonymous' ? 1 : 0,
    );

    const acts = await db
      .select()
      .from(schema.actions)
      .where(eq(schema.actions.tenantId, tenantId));
    if (refinementId === 'withActions') {
      expect(acts.length, 'the corrective-actions tile must seed corrective actions').toBe(2);
      for (const a of acts) {
        expect(a.assigneeUserId, 'an unassigned action goes nowhere').not.toBeNull();
        expect(a.dueAt, 'an action with no due date is never chased').not.toBeNull();
        expect(a.siteId, 'an action must inherit the site of its finding').not.toBeNull();
        expect(a.referenceNumber).toMatch(/^AC-\d{6}$/);
      }
    } else {
      expect(acts.length, 'other refinements do not promise actions').toBe(0);
    }
  },

  /** Goal: nine permit types plus one permit of the chosen category. */
  permit: async ({ db, tenantId, refinementId, landingPath }) => {
    expect(landingPath).toBe('/permits');
    const types = await db
      .select()
      .from(schema.permitTypes)
      .where(eq(schema.permitTypes.tenantId, tenantId));
    expect(types.length, 'the nine default types').toBeGreaterThanOrEqual(9);

    const permits = await db
      .select()
      .from(schema.permits)
      .where(eq(schema.permits.tenantId, tenantId));
    expect(permits.length, 'one permit waiting on the visitor').toBe(1);

    // A draft permit is invisible: permits.list defaults to status
    // 'open' (issued / active / suspended). The row would exist and the
    // register would be empty.
    expect(permits[0]?.status, 'a draft permit never reaches the register').toBe('issued');
    expect(permits[0]?.issuedAt, 'issued means issued by someone').not.toBeNull();
    expect(
      permits[0]?.preconditions.every((p) => p.checked),
      'issue confirms preconditions',
    ).toBe(true);

    const expected: Record<string, string> = {
      hotWork: 'hot_work',
      confinedSpace: 'confined_space',
      workingAtHeight: 'work_at_height',
      electrical: 'electrical',
    };
    const type = types.find((t) => t.id === permits[0]?.permitTypeId);
    expect(type?.category, 'permit must match the chosen refinement').toBe(expected[refinementId]);

    // The type states its own gate and the permit page prints the
    // limits. An issued permit with no readings against a gas-required
    // type makes "the gate evaluates readings against these" a lie.
    if (type?.requiresGasTesting === true && (type.gasLimits?.length ?? 0) > 0) {
      const readings = permits[0]?.gasReadings ?? [];
      for (const limit of type.gasLimits) {
        const hit = readings.filter((r) => r.limitId === limit.id);
        expect(hit.length, `no reading recorded for ${limit.label}`).toBeGreaterThanOrEqual(1);
        expect(
          hit.every((r) => r.withinLimits === true),
          `${limit.label} out of range`,
        ).toBe(true);
      }
    }
    // A type demanding an authorising signature must carry one, or the
    // record shows work in force that nobody authorised.
    if (type?.requiresAuthoriser === true) {
      expect(permits[0]?.authoriserUserId, 'authorising signature missing').not.toBeNull();
      expect(permits[0]?.authorisedAt).not.toBeNull();
    }

    // For a permit, "who issued this and when" is the most important
    // line in the audit trail — and it was the one missing. The seed
    // wrote the end state without any events, so a permit six people
    // had signed off showed a History with one line on it.
    const events = await db
      .select()
      .from(schema.permitEvents)
      .where(eq(schema.permitEvents.tenantId, tenantId));
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has('issued'), 'the issue event must reach the log').toBe(true);
    expect(kinds.has('precondition_checked'), 'precondition confirmations must too').toBe(true);
    if (type?.requiresAuthoriser === true) {
      expect(kinds.has('authorised'), 'the authorising signature must reach the log').toBe(true);
    }
  },

  /** Goal: one incident at reported, with RIDDOR-relevant facts. */
  incident: async ({ db, tenantId, landingPath }) => {
    expect(landingPath).toBe('/incidents');
    const rows = await db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.tenantId, tenantId));
    expect(rows.length, 'one incident on file').toBe(1);
    expect(rows[0]?.status).toBe('reported');
    expect(rows[0]?.referenceNumber).toMatch(/^IN-\d{6}$/);
    expect(
      (rows[0]?.description ?? '').length,
      'incident must read like a real report',
    ).toBeGreaterThan(50);

    // The record has to agree with itself. A fractured wrist, a hospital
    // visit and two weeks off was badged "Severity: Minor" and
    // "0 day(s) lost", and a supervisor triaging on that badge skips it.
    expect(rows[0]?.severity, 'hospitalisation floors severity at serious').toBe('serious');

    const persons = await db
      .select()
      .from(schema.incidentPersons)
      .where(eq(schema.incidentPersons.tenantId, tenantId));
    expect(persons.length, 'an injury incident needs an injured person').toBe(1);
    expect(persons[0]?.injury.injuryKinds, 'the fracture is one of two RIDDOR triggers').toContain(
      'fracture',
    );
    expect(persons[0]?.injury.hospitalisation).toBe('admitted');

    const absences = await db
      .select()
      .from(schema.incidentAbsences)
      .where(eq(schema.incidentAbsences.tenantId, tenantId));
    expect(absences.length, 'over-7-day is the other trigger; it needs an absence').toBe(1);
    expect(absences[0]?.toDate, 'an open period keeps counting').toBeNull();

    // A workspace seconds old must not open by telling the visitor off
    // for someone else's late report (the chip fires past 24 h).
    const occurred = rows[0]?.occurredAt.getTime() ?? 0;
    const reported = rows[0]?.reportedAt.getTime() ?? 0;
    expect(reported - occurred, 'seeded record must not be a late report').toBeLessThanOrEqual(
      24 * 60 * 60 * 1000,
    );
  },

  /**
   * Goal: a pack with steps in it, and — on `reviewPack` — a contractor
   * pack in the review queue. The review page said "No contractor packs
   * awaiting review" to a visitor who had just asked to review one.
   */
  rams: async ({ db, tenantId, refinementId, landingPath }) => {
    expect(landingPath).toBe('/rams');
    const packs = await db
      .select()
      .from(schema.ramsPacks)
      .where(eq(schema.ramsPacks.tenantId, tenantId));
    expect(packs.length, 'register must hold a pack').toBeGreaterThanOrEqual(1);

    // A pack with a reference and no content is a shell: nothing to
    // read, nothing to judge, and an issue gate with nothing to act on.
    const steps = packs[0]?.draftContent.steps ?? [];
    expect(steps.length, 'a pack with no method-statement steps is empty').toBeGreaterThanOrEqual(
      3,
    );
    expect(
      steps.every((s2, i) => s2.sequence === i + 1),
      'steps must be densely sequenced',
    ).toBe(true);
    expect(
      steps.some((s2) => s2.controlNotes.length > 0),
      'steps without controls are a list of tasks, not a method statement',
    ).toBe(true);

    const reviews = await db
      .select()
      .from(schema.ramsReviews)
      .where(eq(schema.ramsReviews.tenantId, tenantId));
    if (refinementId === 'reviewPack') {
      expect(reviews.length, 'the review tile must put something in the review queue').toBe(1);
      expect(reviews[0]?.outcome, 'a decided review is not awaiting review').toBe('pending');
      expect(reviews[0]?.checklist.length, 'the reviewer needs their checklist').toBeGreaterThan(0);
    } else {
      expect(reviews.length, 'other refinements do not promise a review').toBe(0);
    }
  },
};

describe('sandbox tile goals', () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    db = await bootDb();
  });

  // Every tile, every refinement the brand offers. Not a sample.
  for (const scenario of scenariosForBrand('freehs')) {
    for (const refinement of scenario.refinements) {
      it(`SB-G:${scenario.id}/${refinement.id} — ${scenario.goal.slice(0, 60)}…`, async () => {
        const { tenantId, landingPath } = await provisionSandbox(db as never, silentLogger(), {
          brand: 'freehs',
          choice: { scenarioId: scenario.id, refinementId: refinement.id },
        });

        await GOAL_ASSERTIONS[scenario.id]({
          db,
          tenantId,
          refinementId: refinement.id,
          landingPath,
        });
      });
    }
  }

  it('SB-G00 — every tile declares a non-trivial goal', () => {
    for (const scenario of scenariosForBrand('freehs')) {
      expect(scenario.goal.length, `${scenario.id} goal`).toBeGreaterThan(30);
      expect(scenario.refinements.length, `${scenario.id} refinements`).toBeGreaterThan(0);
    }
  });
});
