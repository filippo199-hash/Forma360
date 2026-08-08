/**
 * Integration tests for the RAMS router (FreeHS module B6 — Risk
 * Assessment & Method Statement).
 *
 * Edge cases (RS-E01/E02/E05-helper/E16 are the pure cases in
 * `packages/shared/src/rams.test.ts`):
 *   - RS-E03 issue gate: no steps / step missing description → refused
 *   - RS-E04 issue gate: binding a draft (never-published) RA → refused
 *   - RS-E05 issue gate: high-residual hazard unreferenced → refused
 *   - RS-E06 issue gate: emergency block incomplete → refused
 *   - RS-E07 issue snapshots the MS version, RA versions and COSHH ids;
 *     a later RA revision does not alter the issued pack
 *   - RS-E08 re-issue creates version n+1; version n stays readable and
 *     its briefings are marked superseded
 *   - RS-E09 briefings are append-only and always name a version
 *   - RS-E10 briefing a non-user by name works; cross-tenant user rejected
 *   - RS-E11 withdraw requires a reason and revokes client links
 *   - RS-E12 client share link: revoked / expired refused; acceptance
 *     recorded against the version
 *   - RS-E13 third-party review: accept sets validity; expiry invalidates
 *   - RS-E15 cross-tenant scoping on every loader
 *   - RS-E18 library template duplicate; updating a template does not
 *     alter packs already issued from it
 *
 * Plus brand gating, permission tiers, the seeded starter library and
 * the binding-suggestion autofill.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { createLogger } from '@forma360/shared/logger';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { methodStatementContentSchema, type MethodStatementContent } from '@forma360/shared/rams';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import { appRouter } from '../router';
import { createRamsRouter } from './rams';
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

const silentLogger = () => createLogger({ service: 'rams-test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

const DAY = 86_400_000;

describe('rams router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let otherTenantId: string;
  let adminId: string;
  let standardId: string;
  let otherTenantUserId: string;
  let siteA: string;

  function callerFor(userId: string, tid: string = tenantId) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'rams@x.test', tenantId: tid as never },
      }),
    );
  }

  /** A published RA with one critical residual hazard. */
  async function makeRiskAssessment(options?: {
    title?: string;
    activity?: string;
    publish?: boolean;
    hazard?: string;
    residualLikelihood?: number;
    residualSeverity?: number;
  }): Promise<{ assessmentId: string; versionId: string | null }> {
    const assessmentId = newId();
    const publish = options?.publish ?? true;
    const activity = options?.activity ?? 'Roof access and plant maintenance';
    await db.insert(schema.riskAssessments).values({
      id: assessmentId,
      tenantId,
      referenceNumber: `RA-${assessmentId.slice(-6)}`,
      title: options?.title ?? 'Working at height',
      activity,
      status: publish ? 'active' : 'draft',
      currentVersion: publish ? 1 : 0,
      createdBy: adminId,
      ...(publish ? { publishedAt: new Date() } : {}),
    });
    if (!publish) return { assessmentId, versionId: null };

    const versionId = newId();
    await db.insert(schema.riskAssessmentVersions).values({
      id: versionId,
      tenantId,
      assessmentId,
      versionNumber: 1,
      content: {
        title: options?.title ?? 'Working at height',
        activity,
        type: 'standing',
        siteId: null,
        siteName: null,
        locationText: null,
        matrix: { lowMax: 4, mediumMax: 9, highMax: 15 },
        hazards: [
          {
            hazard: options?.hazard ?? 'Fall from height',
            harmDescription: 'Serious injury or fatality',
            affectedGroups: ['employees'],
            initialLikelihood: 5,
            initialSeverity: 5,
            existingControls: 'Edge protection',
            residualLikelihood: options?.residualLikelihood ?? 5,
            residualSeverity: options?.residualSeverity ?? 4,
            residualJustification: '',
            controls: [],
          },
        ],
      },
      signedOffBy: adminId,
      signedOffByName: 'Admin',
      signedOffAt: new Date(),
    });
    return { assessmentId, versionId };
  }

  /** Content with one step, complete emergency block. */
  function goodContent(hazardRef?: {
    raVersionId: string;
    hazardIndex: number;
  }): MethodStatementContent {
    return methodStatementContentSchema.parse({
      scopeOfWorks: 'Replace AHU filters in the plant room.',
      steps: [
        {
          id: 's1',
          sequence: 1,
          title: 'Isolate and prove dead',
          description: 'Lock off, tag and prove dead at the point of work.',
          ...(hazardRef !== undefined
            ? { hazardRefs: [{ ...hazardRef, hazardLabel: 'Fall from height' }] }
            : {}),
        },
      ],
      emergency: {
        firstAid: 'Crew first aider on site.',
        emergencyProcedure: 'Raise the alarm, evacuate to the muster point, call 999.',
      },
    });
  }

  /** Create a pack, bind the RA, save good content — ready to issue. */
  async function readyPack(options?: { reference?: boolean }): Promise<{
    packId: string;
    assessmentId: string;
    versionId: string;
  }> {
    const caller = callerFor(adminId);
    const { assessmentId, versionId } = await makeRiskAssessment();
    if (versionId === null) throw new Error('expected published version');
    const { packId } = await caller.rams.packs.create({
      title: 'AHU filter replacement — Riverside',
      clientName: 'Riverside Estates',
      siteId: siteA,
      locationText: 'Plant room 3',
      supervisorName: 'Tom Whitfield',
    });
    await caller.rams.packs.bindRiskAssessment({ packId, assessmentId });
    await caller.rams.packs.saveDraft({
      packId,
      content:
        options?.reference === false
          ? goodContent()
          : goodContent({ raVersionId: versionId, hazardIndex: 0 }),
    });
    return { packId, assessmentId, versionId };
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    otherTenantId = newId();
    adminId = newId();
    standardId = newId();
    otherTenantUserId = newId();

    for (const [id, name] of [
      [tenantId, 'Acme Contracting'],
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
        name: 'Tom Whitfield',
        email: 'tom@acme.test',
        emailVerified: true,
        permissionSetId: sets.administrator,
      },
      {
        id: standardId,
        tenantId,
        name: 'Sam Operative',
        email: 'sam@acme.test',
        emailVerified: true,
        permissionSetId: sets.standard,
      },
      {
        id: otherTenantUserId,
        tenantId: otherTenantId,
        name: 'Rival Rob',
        email: 'rob@other.test',
        emailVerified: true,
        permissionSetId: otherSets.administrator,
      },
    ]);

    siteA = newId();
    await db.insert(schema.sites).values({
      id: siteA,
      tenantId,
      name: 'Riverside Plaza',
      kind: 'site',
      path: siteA,
      depth: 0,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  // ─── Brand gating + permissions ────────────────────────────────────────

  describe('brand gating', () => {
    it('refuses every procedure when the module is disabled', async () => {
      const disabled = createCallerFactory(router({ rams: createRamsRouter({ enabled: false }) }))(
        createTestContext({
          db: db as never,
          logger: silentLogger(),
          auth: { userId: adminId, email: 'tom@acme.test', tenantId: tenantId as never },
        }),
      );
      await expect(disabled.rams.packs.list({})).rejects.toThrow(/module-disabled/);
      await expect(disabled.rams.methodStatements.list({})).rejects.toThrow(/module-disabled/);
    });
  });

  describe('permission tiers', () => {
    it('lets a standard user view and brief but not author or issue', async () => {
      const caller = callerFor(standardId);
      await expect(caller.rams.packs.list({})).resolves.toEqual([]);
      await expect(
        caller.rams.packs.create({
          title: 'Nope',
          clientName: '',
          locationText: '',
          supervisorName: '',
        }),
      ).rejects.toThrow();
    });

    it('refuses issue to a user without rams.issue', async () => {
      const { packId } = await readyPack();
      await expect(
        callerFor(standardId).rams.packs.issue({ packId, confirmAttestation: true }),
      ).rejects.toThrow();
    });
  });

  // ─── The seeded library ────────────────────────────────────────────────

  describe('starter library', () => {
    it('seeds eight published templates, idempotently', async () => {
      const caller = callerFor(adminId);
      const first = await caller.rams.methodStatements.seedLibrary();
      expect(first.seeded).toBe(8);
      const second = await caller.rams.methodStatements.seedLibrary();
      expect(second.seeded).toBe(0);

      const templates = await caller.rams.methodStatements.list({ templatesOnly: true });
      expect(templates).toHaveLength(8);
      expect(templates.every((t) => t.status === 'published')).toBe(true);
      expect(templates.every((t) => t.stepCount >= 6)).toBe(true);
    });

    it('starts a pack from a library template with the steps pre-filled', async () => {
      const caller = callerFor(adminId);
      await caller.rams.methodStatements.seedLibrary();
      const templates = await caller.rams.methodStatements.list({ templatesOnly: true });
      const plantRoom = templates.find((t) => t.title === 'Plant room — mechanical works');
      expect(plantRoom).toBeDefined();

      const { packId } = await caller.rams.packs.create({
        title: 'AHU filters — Riverside',
        clientName: 'Riverside Estates',
        locationText: 'Plant room 3',
        supervisorName: 'Tom',
        methodStatementId: plantRoom?.id,
      });
      const pack = await caller.rams.packs.get({ packId });
      expect(pack.pack.draftContent.steps.length).toBeGreaterThanOrEqual(6);
      expect(pack.pack.draftContent.emergency.firstAid.length).toBeGreaterThan(0);
    });
  });

  // ─── RS-E18 · library independence ─────────────────────────────────────

  describe('RS-E18 templates and packs are independent', () => {
    it('duplicating a method statement does not alter the source', async () => {
      const caller = callerFor(adminId);
      const { methodStatementId } = await caller.rams.methodStatements.create({
        title: 'Original',
        trade: 'mechanical',
        isTemplate: true,
      });
      await caller.rams.methodStatements.saveDraft({
        methodStatementId,
        content: goodContent(),
      });
      const { methodStatementId: copyId } = await caller.rams.methodStatements.create({
        title: 'Copy',
        fromMethodStatementId: methodStatementId,
      });
      await caller.rams.methodStatements.saveDraft({
        methodStatementId: copyId,
        content: methodStatementContentSchema.parse({
          ...goodContent(),
          scopeOfWorks: 'Totally different scope',
        }),
      });

      const source = await caller.rams.methodStatements.get({ methodStatementId });
      expect(source.methodStatement.draftContent.scopeOfWorks).toBe(
        'Replace AHU filters in the plant room.',
      );
    });

    it('updating a template does not alter packs already issued from it', async () => {
      const caller = callerFor(adminId);
      const { assessmentId, versionId } = await makeRiskAssessment();
      const { methodStatementId } = await caller.rams.methodStatements.create({
        title: 'Plant room works',
        isTemplate: true,
      });
      await caller.rams.methodStatements.saveDraft({
        methodStatementId,
        content: goodContent({ raVersionId: versionId ?? '', hazardIndex: 0 }),
      });
      await caller.rams.methodStatements.publish({ methodStatementId });

      const { packId } = await caller.rams.packs.create({
        title: 'Job A',
        clientName: 'Client A',
        locationText: 'Plant room',
        supervisorName: 'Tom',
        methodStatementId,
      });
      await caller.rams.packs.bindRiskAssessment({ packId, assessmentId });
      const issued = await caller.rams.packs.issue({ packId, confirmAttestation: true });

      // Now change the template and republish.
      await caller.rams.methodStatements.saveDraft({
        methodStatementId,
        content: methodStatementContentSchema.parse({
          ...goodContent({ raVersionId: versionId ?? '', hazardIndex: 0 }),
          scopeOfWorks: 'REWRITTEN SCOPE',
        }),
      });
      await caller.rams.methodStatements.publish({ methodStatementId });

      const version = await caller.rams.packs.getVersion({ packVersionId: issued.packVersionId });
      expect(version.version.content.content.scopeOfWorks).toBe(
        'Replace AHU filters in the plant room.',
      );
    });
  });

  // ─── RS-E03 / E04 / E05 / E06 · the issue gate ─────────────────────────

  describe('RS-E03 issue gate — steps', () => {
    it('refuses a pack with no steps', async () => {
      const caller = callerFor(adminId);
      const { assessmentId } = await makeRiskAssessment({
        residualLikelihood: 1,
        residualSeverity: 1,
      });
      const { packId } = await caller.rams.packs.create({
        title: 'Empty',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      await caller.rams.packs.bindRiskAssessment({ packId, assessmentId });
      await expect(caller.rams.packs.issue({ packId, confirmAttestation: true })).rejects.toThrow(
        /no-steps/,
      );
    });

    it('refuses a step with no description', async () => {
      const caller = callerFor(adminId);
      const { assessmentId, versionId } = await makeRiskAssessment({
        residualLikelihood: 1,
        residualSeverity: 1,
      });
      const { packId } = await caller.rams.packs.create({
        title: 'Bare step',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      await caller.rams.packs.bindRiskAssessment({ packId, assessmentId });
      await caller.rams.packs.saveDraft({
        packId,
        content: methodStatementContentSchema.parse({
          steps: [{ id: 's1', sequence: 1, title: 'Do the thing', description: '' }],
          emergency: {
            firstAid: 'Crew first aider.',
            emergencyProcedure: 'Call 999.',
          },
        }),
      });
      void versionId;
      await expect(caller.rams.packs.issue({ packId, confirmAttestation: true })).rejects.toThrow(
        /step-missing-description/,
      );
    });

    it('refuses issue without the attestation', async () => {
      const { packId } = await readyPack();
      await expect(
        callerFor(adminId).rams.packs.issue({ packId, confirmAttestation: false }),
      ).rejects.toThrow(/attestation-not-confirmed/);
    });

    it('refuses a pack with no bound risk assessment', async () => {
      const caller = callerFor(adminId);
      const { packId } = await caller.rams.packs.create({
        title: 'Unbound',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      await caller.rams.packs.saveDraft({ packId, content: goodContent() });
      await expect(caller.rams.packs.issue({ packId, confirmAttestation: true })).rejects.toThrow(
        /no-risk-assessment/,
      );
    });
  });

  describe('RS-E04 draft risk assessments cannot back an issued pack', () => {
    it('refuses issue when a bound RA has never been published', async () => {
      const caller = callerFor(adminId);
      const { assessmentId } = await makeRiskAssessment({ publish: false });
      const { packId } = await caller.rams.packs.create({
        title: 'Draft RA',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      const bound = await caller.rams.packs.bindRiskAssessment({ packId, assessmentId });
      expect(bound.published).toBe(false);
      await caller.rams.packs.saveDraft({ packId, content: goodContent() });
      await expect(caller.rams.packs.issue({ packId, confirmAttestation: true })).rejects.toThrow(
        /risk-assessment-not-published/,
      );
    });

    it('refuses binding an archived risk assessment', async () => {
      const caller = callerFor(adminId);
      const { assessmentId } = await makeRiskAssessment();
      await db
        .update(schema.riskAssessments)
        .set({ archivedAt: new Date() })
        .where(eq(schema.riskAssessments.id, assessmentId));
      const { packId } = await caller.rams.packs.create({
        title: 'Archived RA',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      await expect(caller.rams.packs.bindRiskAssessment({ packId, assessmentId })).rejects.toThrow(
        /risk-assessment-archived/,
      );
    });
  });

  describe('RS-E05 high-residual hazards must be addressed by a step', () => {
    it('refuses issue when no step references the critical hazard', async () => {
      const { packId } = await readyPack({ reference: false });
      await expect(
        callerFor(adminId).rams.packs.issue({ packId, confirmAttestation: true }),
      ).rejects.toThrow(/high-risk-hazard-unreferenced/);
    });

    it('issues once a step references it', async () => {
      const { packId } = await readyPack();
      const issued = await callerFor(adminId).rams.packs.issue({
        packId,
        confirmAttestation: true,
      });
      expect(issued.versionNumber).toBe(1);
    });

    it('surfaces the unreferenced hazards on the get preview', async () => {
      const { packId } = await readyPack({ reference: false });
      const pack = await callerFor(adminId).rams.packs.get({ packId });
      expect(pack.issueGate.errors).toContain('high-risk-hazard-unreferenced');
      expect(pack.issueGate.unreferenced[0]?.hazard).toBe('Fall from height');
    });
  });

  describe('RS-E06 emergency arrangements', () => {
    it('refuses issue when the emergency block is incomplete', async () => {
      const caller = callerFor(adminId);
      const { assessmentId, versionId } = await makeRiskAssessment();
      const { packId } = await caller.rams.packs.create({
        title: 'No emergency block',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      await caller.rams.packs.bindRiskAssessment({ packId, assessmentId });
      await caller.rams.packs.saveDraft({
        packId,
        content: methodStatementContentSchema.parse({
          steps: [
            {
              id: 's1',
              sequence: 1,
              title: 'Step',
              description: 'Do it.',
              hazardRefs: [{ raVersionId: versionId ?? '', hazardIndex: 0 }],
            },
          ],
        }),
      });
      await expect(caller.rams.packs.issue({ packId, confirmAttestation: true })).rejects.toThrow(
        /emergency-block-incomplete/,
      );
    });
  });

  // ─── RS-E07 · the snapshot ─────────────────────────────────────────────

  describe('RS-E07 issue freezes the pack', () => {
    it('snapshots the RA version, and a later RA revision does not change it', async () => {
      const caller = callerFor(adminId);
      const { packId, assessmentId, versionId } = await readyPack();
      const issued = await caller.rams.packs.issue({ packId, confirmAttestation: true });

      const before = await caller.rams.packs.getVersion({ packVersionId: issued.packVersionId });
      expect(before.version.content.riskAssessments).toHaveLength(1);
      expect(before.version.content.riskAssessments[0]?.raVersionId).toBe(versionId);
      expect(before.version.content.riskAssessments[0]?.worstResidualBand).toBe('critical');

      // Publish RA version 2 with a completely different hazard set.
      await db.insert(schema.riskAssessmentVersions).values({
        id: newId(),
        tenantId,
        assessmentId,
        versionNumber: 2,
        content: {
          title: 'Working at height (revised)',
          activity: 'x',
          type: 'standing',
          siteId: null,
          siteName: null,
          locationText: null,
          matrix: { lowMax: 4, mediumMax: 9, highMax: 15 },
          hazards: [],
        },
        signedOffBy: adminId,
        signedOffByName: 'Admin',
        signedOffAt: new Date(),
      });
      await db
        .update(schema.riskAssessments)
        .set({ currentVersion: 2 })
        .where(eq(schema.riskAssessments.id, assessmentId));

      const after = await caller.rams.packs.getVersion({ packVersionId: issued.packVersionId });
      expect(after.version.content.riskAssessments[0]?.raVersionId).toBe(versionId);
      expect(after.version.content.riskAssessments[0]?.versionNumber).toBe(1);
      expect(after.version.content.riskAssessments[0]?.hazardCount).toBe(1);
    });

    it('freezes the job context and the attestation text', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      const issued = await caller.rams.packs.issue({ packId, confirmAttestation: true });
      const version = await caller.rams.packs.getVersion({ packVersionId: issued.packVersionId });
      expect(version.version.content.jobContext.clientName).toBe('Riverside Estates');
      expect(version.version.content.jobContext.siteName).toBe('Riverside Plaza');
      expect(version.version.attestationText).toContain('suitable and sufficient');

      // Renaming the pack afterwards must not touch the frozen version.
      await caller.rams.packs.update({ packId, title: 'Renamed' });
      const again = await caller.rams.packs.getVersion({ packVersionId: issued.packVersionId });
      expect(again.version.content.jobContext.title).toBe('AHU filter replacement — Riverside');
    });
  });

  // ─── RS-E08 · re-issue ─────────────────────────────────────────────────

  describe('RS-E08 re-issue', () => {
    it('creates version n+1, supersedes version n and keeps it readable', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      const v1 = await caller.rams.packs.issue({ packId, confirmAttestation: true });
      const v2 = await caller.rams.packs.issue({
        packId,
        confirmAttestation: true,
        reissueNote: 'Client asked for a change',
      });
      expect(v2.versionNumber).toBe(2);

      const detail = await caller.rams.packs.get({ packId });
      expect(detail.pack.currentVersion).toBe(2);
      expect(detail.versions).toHaveLength(2);
      const first = detail.versions.find((v) => v.versionNumber === 1);
      expect(first?.supersededAt).not.toBeNull();

      // Version 1 is still fully readable.
      const readV1 = await caller.rams.packs.getVersion({ packVersionId: v1.packVersionId });
      expect(readV1.version.versionNumber).toBe(1);
    });

    it('marks briefings against the superseded version as not current', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      await caller.rams.briefings.record({
        packId,
        entries: [{ kind: 'named_person', name: 'Joe Operative', category: 'subcontractor' }],
      });

      let status = await caller.rams.briefings.forPack({ packId });
      expect(status.briefedOnCurrent).toBe(1);
      expect(status.briefedOnSuperseded).toBe(0);

      await caller.rams.packs.issue({ packId, confirmAttestation: true });

      status = await caller.rams.briefings.forPack({ packId });
      expect(status.briefedOnCurrent).toBe(0);
      expect(status.briefedOnSuperseded).toBe(1);
      expect(status.briefings[0]?.current).toBe(false);
    });
  });

  // ─── RS-E09 / RS-E10 · briefings ───────────────────────────────────────

  describe('RS-E09 briefings are append-only and version-anchored', () => {
    it('records a group briefing in one call, each naming the version', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });

      const result = await caller.rams.briefings.record({
        packId,
        entries: [
          { kind: 'named_person', name: 'Joe', category: 'subcontractor', organisation: 'JCo' },
          { kind: 'named_person', name: 'Ann', category: 'agency' },
          { kind: 'user', userId: standardId, name: 'Sam Operative', category: 'employee' },
        ],
      });
      expect(result.briefingIds).toHaveLength(3);
      expect(result.versionNumber).toBe(1);

      const rows = await db
        .select()
        .from(schema.ramsBriefings)
        .where(eq(schema.ramsBriefings.packId, packId));
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.versionNumber === 1)).toBe(true);
    });

    it('exposes no update or delete surface', () => {
      const surface = Object.keys(appRouter._def.procedures)
        .filter((k) => k.startsWith('rams.briefings.'))
        .sort();
      expect(surface).toEqual(['rams.briefings.forPack', 'rams.briefings.record']);
    });

    it('refuses briefing against a pack that is not issued', async () => {
      const { packId } = await readyPack();
      await expect(
        callerFor(adminId).rams.briefings.record({
          packId,
          entries: [{ kind: 'named_person', name: 'Joe' }],
        }),
      ).rejects.toThrow(/pack-not-issued/);
    });

    it('lets a standard user brief the crew', async () => {
      const { packId } = await readyPack();
      await callerFor(adminId).rams.packs.issue({ packId, confirmAttestation: true });
      await expect(
        callerFor(standardId).rams.briefings.record({
          packId,
          entries: [{ kind: 'named_person', name: 'Joe' }],
        }),
      ).resolves.toMatchObject({ versionNumber: 1 });
    });
  });

  describe('RS-E10 briefee identity', () => {
    it('records a non-user by name', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      await caller.rams.briefings.record({
        packId,
        entries: [
          {
            kind: 'named_person',
            name: 'Subcontractor Sid',
            category: 'subcontractor',
            organisation: 'Sid Ltd',
          },
        ],
      });
      const rows = await db
        .select()
        .from(schema.ramsBriefings)
        .where(eq(schema.ramsBriefings.packId, packId));
      expect(rows[0]?.briefeeUserId).toBeNull();
      expect(rows[0]?.briefeeOrganisation).toBe('Sid Ltd');
    });

    it('rejects a briefee from another tenant', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      await expect(
        caller.rams.briefings.record({
          packId,
          entries: [{ kind: 'user', userId: otherTenantUserId, name: 'Rival Rob' }],
        }),
      ).rejects.toThrow(/briefee-not-found/);
    });
  });

  // ─── RS-E11 · withdraw ─────────────────────────────────────────────────

  describe('RS-E11 withdraw', () => {
    it('requires a reason', async () => {
      const { packId } = await readyPack();
      await callerFor(adminId).rams.packs.issue({ packId, confirmAttestation: true });
      await expect(
        // @ts-expect-error — deliberately omitting the required reason
        callerFor(adminId).rams.packs.withdraw({ packId }),
      ).rejects.toThrow();
    });

    it('records the reason and revokes outstanding client links', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      const link = await caller.rams.client.createLink({ packId, issuedToName: 'Client' });

      await caller.rams.packs.withdraw({ packId, reason: 'Scope changed materially' });

      const detail = await caller.rams.packs.get({ packId });
      expect(detail.pack.status).toBe('withdrawn');
      expect(detail.pack.withdrawnReason).toBe('Scope changed materially');
      expect(detail.clientLinks[0]?.revokedAt).not.toBeNull();

      await expect(callerFor(adminId).rams.client.publicGet({ token: link.token })).rejects.toThrow(
        /link-revoked/,
      );
    });

    it('refuses to withdraw a pack that was never issued', async () => {
      const { packId } = await readyPack();
      await expect(callerFor(adminId).rams.packs.withdraw({ packId, reason: 'x' })).rejects.toThrow(
        /illegal-transition/,
      );
    });
  });

  // ─── RS-E12 · client links ─────────────────────────────────────────────

  describe('RS-E12 client issue and acceptance', () => {
    it('records an acceptance against the exact version', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      const link = await caller.rams.client.createLink({ packId, issuedToName: 'Riverside' });

      const view = await caller.rams.client.publicGet({ token: link.token });
      expect(view.versionNumber).toBe(1);
      expect(view.content.jobContext.clientName).toBe('Riverside Estates');

      await caller.rams.client.publicDecide({
        token: link.token,
        decision: 'accepted',
        acceptedByName: 'Dana Client',
        acceptedByOrganisation: 'Riverside Estates',
        comment: 'Approved, proceed.',
      });

      const after = await caller.rams.client.publicGet({ token: link.token });
      expect(after.decision).toBe('accepted');
      expect(after.acceptedByName).toBe('Dana Client');
      expect(after.decidedAt).not.toBeNull();
    });

    it('supports requesting changes', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      const link = await caller.rams.client.createLink({ packId });
      await caller.rams.client.publicDecide({
        token: link.token,
        decision: 'changes_requested',
        acceptedByName: 'Dana',
        comment: 'Add the isolation step.',
      });
      const after = await caller.rams.client.publicGet({ token: link.token });
      expect(after.decision).toBe('changes_requested');
    });

    it('refuses a revoked token', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      const link = await caller.rams.client.createLink({ packId });
      const detail = await caller.rams.packs.get({ packId });
      const linkId = detail.clientLinks[0]?.id;
      expect(linkId).toBeDefined();
      if (linkId !== undefined) await caller.rams.client.revokeLink({ linkId });
      await expect(caller.rams.client.publicGet({ token: link.token })).rejects.toThrow(
        /link-revoked/,
      );
    });

    // RS-A14: the URL is recoverable after navigation, but only through
    // the permission that minted it, and never for a dead link.
    it('re-reads a live link URL and refuses a revoked one', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      const link = await caller.rams.client.createLink({ packId, issuedToName: 'Riverside' });
      const detail = await caller.rams.packs.get({ packId });
      const linkId = detail.clientLinks[0]?.id;
      expect(linkId).toBeDefined();
      if (linkId === undefined) return;

      const again = await caller.rams.client.getLinkUrl({ linkId });
      expect(again.url).toBe(link.url);

      await caller.rams.client.revokeLink({ linkId });
      await expect(caller.rams.client.getLinkUrl({ linkId })).rejects.toThrow(/link-revoked/);
    });

    it('never returns a link URL to a user who cannot issue', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      const detail = await caller.rams.packs.get({ packId });
      await caller.rams.client.createLink({ packId });
      const withLink = await caller.rams.packs.get({ packId });
      const linkId = withLink.clientLinks[0]?.id;
      expect(detail.clientLinks).toHaveLength(0);
      expect(linkId).toBeDefined();
      if (linkId === undefined) return;
      await expect(callerFor(standardId).rams.client.getLinkUrl({ linkId })).rejects.toThrow(
        /FORBIDDEN|permission/i,
      );
    });

    it('refuses an expired token', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      const link = await caller.rams.client.createLink({ packId, expiresInDays: 1 });
      await db
        .update(schema.ramsClientLinks)
        .set({ expiresAt: new Date(Date.now() - DAY) })
        .where(eq(schema.ramsClientLinks.token, link.token));
      await expect(caller.rams.client.publicGet({ token: link.token })).rejects.toThrow(
        /link-expired/,
      );
      await expect(
        caller.rams.client.publicDecide({
          token: link.token,
          decision: 'accepted',
          acceptedByName: 'Dana',
        }),
      ).rejects.toThrow(/link-expired/);
    });

    it('refuses an unknown token', async () => {
      await expect(
        callerFor(adminId).rams.client.publicGet({ token: 'not-a-real-token' }),
      ).rejects.toThrow(/link-invalid/);
    });

    it('refuses a share link for a pack that is not issued', async () => {
      const { packId } = await readyPack();
      await expect(callerFor(adminId).rams.client.createLink({ packId })).rejects.toThrow(
        /pack-not-issued/,
      );
    });
  });

  // ─── RS-E13 · third-party review ───────────────────────────────────────

  describe('RS-E13 third-party review', () => {
    async function makeContractor(): Promise<string> {
      const contractorId = newId();
      await db.insert(schema.contractors).values({
        id: contractorId,
        tenantId,
        name: 'Specialist Services Ltd',
      });
      return contractorId;
    }

    it('accepts with a validity window and reports validity', async () => {
      const caller = callerFor(adminId);
      const contractorId = await makeContractor();
      const { reviewId } = await caller.rams.reviews.submit({
        contractorId,
        title: 'Roof works RAMS v2',
        workDescription: 'Re-roofing block C',
      });

      await caller.rams.reviews.decide({
        reviewId,
        checklist: [
          { id: 'scope_matches', verdict: 'pass', comment: '' },
          { id: 'hazards_credible', verdict: 'pass', comment: '' },
        ],
        outcome: 'accepted',
        validFrom: new Date(Date.now() - DAY),
        validTo: new Date(Date.now() + 30 * DAY),
      });

      const got = await caller.rams.reviews.get({ reviewId });
      expect(got.review.outcome).toBe('accepted');
      expect(got.valid).toBe(true);
    });

    it('stops being valid once the window has passed', async () => {
      const caller = callerFor(adminId);
      const contractorId = await makeContractor();
      const { reviewId } = await caller.rams.reviews.submit({
        contractorId,
        title: 'Expired pack',
      });
      await caller.rams.reviews.decide({
        reviewId,
        checklist: [],
        outcome: 'accepted',
        validFrom: new Date(Date.now() - 60 * DAY),
        validTo: new Date(Date.now() - DAY),
      });
      const got = await caller.rams.reviews.get({ reviewId });
      expect(got.valid).toBe(false);
    });

    it('refuses acceptance while an item failed', async () => {
      const caller = callerFor(adminId);
      const contractorId = await makeContractor();
      const { reviewId } = await caller.rams.reviews.submit({ contractorId, title: 'Bad pack' });
      await expect(
        caller.rams.reviews.decide({
          reviewId,
          checklist: [{ id: 'emergency_present', verdict: 'fail', comment: 'No rescue plan' }],
          outcome: 'accepted',
        }),
      ).rejects.toThrow(/review-has-failures/);
    });

    it('allows accepted_with_conditions but demands the conditions', async () => {
      const caller = callerFor(adminId);
      const contractorId = await makeContractor();
      const { reviewId } = await caller.rams.reviews.submit({ contractorId, title: 'Conditional' });
      await expect(
        caller.rams.reviews.decide({
          reviewId,
          checklist: [{ id: 'emergency_present', verdict: 'fail', comment: 'thin' }],
          outcome: 'accepted_with_conditions',
        }),
      ).rejects.toThrow(/conditions-required/);

      await expect(
        caller.rams.reviews.decide({
          reviewId,
          checklist: [{ id: 'emergency_present', verdict: 'fail', comment: 'thin' }],
          outcome: 'accepted_with_conditions',
          conditions: 'Provide a rescue plan before mobilising.',
        }),
      ).resolves.toMatchObject({ outcome: 'accepted_with_conditions' });
    });

    it('demands comments on rejection and returns them', async () => {
      const caller = callerFor(adminId);
      const contractorId = await makeContractor();
      const { reviewId } = await caller.rams.reviews.submit({ contractorId, title: 'Rejected' });
      await expect(
        caller.rams.reviews.decide({ reviewId, checklist: [], outcome: 'rejected' }),
      ).rejects.toThrow(/comments-required/);
      await caller.rams.reviews.decide({
        reviewId,
        checklist: [],
        outcome: 'rejected',
        comments: 'Scope does not match the instructed work.',
      });
      const got = await caller.rams.reviews.get({ reviewId });
      expect(got.review.comments).toContain('Scope does not match');
    });

    it('keeps the checklist labels snapshotted at submit time', async () => {
      const caller = callerFor(adminId);
      const contractorId = await makeContractor();
      const { reviewId } = await caller.rams.reviews.submit({ contractorId, title: 'Labels' });
      await caller.rams.reviews.decide({
        reviewId,
        checklist: [{ id: 'scope_matches', verdict: 'pass', comment: 'ok' }],
        outcome: 'accepted',
      });
      const got = await caller.rams.reviews.get({ reviewId });
      const entry = got.review.checklist.find((c) => c.id === 'scope_matches');
      expect(entry?.label).toContain('Scope of works');
      expect(entry?.verdict).toBe('pass');
      // Untouched items stay UNANSWERED. They used to default to 'na',
      // which is a judgement — "does not apply to this job" — so an
      // untouched pack rendered as fully reviewed and could be signed
      // off without the reviewer reading a line.
      expect(got.review.checklist.find((c) => c.id === 'coshh_covered')?.verdict).toBe(
        'unanswered',
      );
    });

    it('refuses a contractor from another tenant', async () => {
      const otherContractorId = newId();
      await db.insert(schema.contractors).values({
        id: otherContractorId,
        tenantId: otherTenantId,
        name: 'Rival Contractor',
      });
      await expect(
        callerFor(adminId).rams.reviews.submit({
          contractorId: otherContractorId,
          title: 'Nope',
        }),
      ).rejects.toThrow(/contractor-not-found/);
    });
  });

  // ─── RS-E15 · cross-tenant scoping ─────────────────────────────────────

  describe('RS-E15 cross-tenant scoping', () => {
    it('never returns another tenant’s pack', async () => {
      const { packId } = await readyPack();
      await expect(
        callerFor(otherTenantUserId, otherTenantId).rams.packs.get({ packId }),
      ).rejects.toThrow(/pack-not-found/);
    });

    it('never returns another tenant’s method statement', async () => {
      const { methodStatementId } = await callerFor(adminId).rams.methodStatements.create({
        title: 'Ours',
      });
      await expect(
        callerFor(otherTenantUserId, otherTenantId).rams.methodStatements.get({
          methodStatementId,
        }),
      ).rejects.toThrow(/method-statement-not-found/);
    });

    it('refuses to bind another tenant’s risk assessment', async () => {
      const caller = callerFor(adminId);
      const { packId } = await caller.rams.packs.create({
        title: 'Cross tenant',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      const foreignRa = newId();
      await db.insert(schema.riskAssessments).values({
        id: foreignRa,
        tenantId: otherTenantId,
        title: 'Their RA',
        activity: 'x',
        status: 'active',
        currentVersion: 1,
        createdBy: otherTenantUserId,
      });
      await expect(
        caller.rams.packs.bindRiskAssessment({ packId, assessmentId: foreignRa }),
      ).rejects.toThrow(/risk-assessment-not-found/);
    });

    it('scopes the register list by tenant', async () => {
      await readyPack();
      const theirs = await callerFor(otherTenantUserId, otherTenantId).rams.packs.list({});
      expect(theirs).toEqual([]);
    });
  });

  // ─── Autofill: binding suggestions ─────────────────────────────────────

  describe('binding suggestions', () => {
    it('ranks the tenant’s published RAs against the job text', async () => {
      const caller = callerFor(adminId);
      await makeRiskAssessment({ title: 'Working at height' });
      await makeRiskAssessment({
        title: 'Catering hygiene',
        activity: 'Food preparation and kitchen cleaning',
      });

      const { packId } = await caller.rams.packs.create({
        title: 'Roof access — working at height survey',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      const suggestions = await caller.rams.packs.suggestBindings({ packId });
      expect(suggestions.riskAssessments.length).toBeGreaterThan(0);
      expect(suggestions.riskAssessments[0]?.title).toBe('Working at height');
      expect(suggestions.riskAssessments.map((r) => r.title)).not.toContain('Catering hygiene');
    });

    it('never suggests an already-bound assessment', async () => {
      const caller = callerFor(adminId);
      const { assessmentId } = await makeRiskAssessment({ title: 'Working at height' });
      const { packId } = await caller.rams.packs.create({
        title: 'Working at height job',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      await caller.rams.packs.bindRiskAssessment({ packId, assessmentId });
      const suggestions = await caller.rams.packs.suggestBindings({ packId });
      expect(suggestions.riskAssessments.map((r) => r.id)).not.toContain(assessmentId);
    });

    it('never suggests a draft risk assessment', async () => {
      const caller = callerFor(adminId);
      await makeRiskAssessment({ title: 'Working at height', publish: false });
      const { packId } = await caller.rams.packs.create({
        title: 'Working at height job',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      const suggestions = await caller.rams.packs.suggestBindings({ packId });
      expect(suggestions.riskAssessments).toEqual([]);
    });
  });

  // ─── Cloning a previous pack ───────────────────────────────────────────

  describe('duplicate a previous pack', () => {
    it('carries bindings, documents and content across', async () => {
      const caller = callerFor(adminId);
      const { packId, assessmentId } = await readyPack();
      await caller.rams.packs.addDocument({
        packId,
        kind: 'insurance',
        title: 'Employers liability',
        storageKey: 'tenant/rams/pack/el.pdf',
        filename: 'el.pdf',
      });

      const clone = await caller.rams.packs.create({
        title: 'Same as Riverside — Northgate',
        clientName: 'Northgate',
        locationText: 'Plant room 1',
        supervisorName: 'Tom',
        fromPackId: packId,
      });

      const detail = await caller.rams.packs.get({ packId: clone.packId });
      expect(detail.riskAssessments.map((r) => r.assessmentId)).toEqual([assessmentId]);
      expect(detail.documents).toHaveLength(1);
      expect(detail.pack.draftContent.steps).toHaveLength(1);
      // The clone is its own draft — issuing it does not touch the source.
      expect(detail.pack.status).toBe('draft');
      expect(detail.pack.referenceNumber).not.toBe(null);
    });
  });

  // ─── Register overview ─────────────────────────────────────────────────

  describe('register overview', () => {
    it('counts the four things that need a human', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();

      let overview = await caller.rams.packs.overview();
      expect(overview.draftPacks).toBe(1);
      expect(overview.awaitingBriefing).toBe(0);

      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      overview = await caller.rams.packs.overview();
      expect(overview.draftPacks).toBe(0);
      expect(overview.awaitingBriefing).toBe(1);

      await caller.rams.briefings.record({
        packId,
        entries: [{ kind: 'named_person', name: 'Joe' }],
      });
      await caller.rams.client.createLink({ packId, issuedToName: 'Client' });
      overview = await caller.rams.packs.overview();
      expect(overview.awaitingBriefing).toBe(0);
      expect(overview.pendingClientAcceptance).toBe(1);
    });
  });

  // ─── Reference numbering + event log ───────────────────────────────────

  describe('references and audit', () => {
    it('stamps sequential RAMS- references', async () => {
      const caller = callerFor(adminId);
      const a = await caller.rams.packs.create({
        title: 'A',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      const b = await caller.rams.packs.create({
        title: 'B',
        clientName: '',
        locationText: '',
        supervisorName: '',
      });
      expect(a.referenceNumber).toBe('RAMS-000001');
      expect(b.referenceNumber).toBe('RAMS-000002');
    });

    it('writes an append-only event per meaningful mutation', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      await caller.rams.packs.withdraw({ packId, reason: 'test' });

      const detail = await caller.rams.packs.get({ packId });
      const kinds = detail.events.map((e) => e.kind);
      expect(kinds).toEqual(
        expect.arrayContaining(['pack_created', 'ra_bound', 'pack_issued', 'pack_withdrawn']),
      );
    });
  });
  // ─── RS-E17 · actions-hub integration ──────────────────────────────────

  describe('RS-E17 actions raised from a pack', () => {
    // The label itself is a web concern — asserted in
    // `apps/web/src/lib/action-sources.test.ts`. This one covers the server
    // half: the source anchor the hub renders that label from.
    it('resolves a source anchor and a working back-link in the actions hub', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      const raised = await caller.rams.packs.raiseAction({
        packId,
        title: 'Add the isolation step the client asked for',
        priority: 'high',
        sourceItemId: 'client-changes-requested',
      });
      expect(raised.created).toBe(true);

      const action = await caller.actions.get({ actionId: raised.actionId });
      expect(action.source?.type).toBe('rams');
      expect(action.source?.href).toBe(`/rams/${packId}`);
      expect(action.source?.referenceNumber).toBe('RAMS-000001');
      expect(action.source?.title).toBe('AHU filter replacement — Riverside');
    });

    it('is filterable by source type on the actions list', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.raiseAction({
        packId,
        title: 'Fix it',
        sourceItemId: 'review-fail-1',
      });
      const list = await caller.actions.list({ sourceType: 'rams' });
      expect(list.rows).toHaveLength(1);
      expect(list.rows[0]?.title).toBe('Fix it');
    });

    it('adopts rather than duplicates on replay of the same trigger', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      const first = await caller.rams.packs.raiseAction({
        packId,
        title: 'Once only',
        sourceItemId: 'review-fail-1',
      });
      const second = await caller.rams.packs.raiseAction({
        packId,
        title: 'Once only',
        sourceItemId: 'review-fail-1',
      });
      expect(second.created).toBe(false);
      expect(second.actionId).toBe(first.actionId);
      const list = await caller.actions.list({ sourceType: 'rams' });
      expect(list.rows).toHaveLength(1);
    });
  });

  // ─── RS-A14 · register filter + render guard ───────────────────────────

  describe('RS-A14 polish', () => {
    it('filters the register to packs awaiting a client decision', async () => {
      const caller = callerFor(adminId);
      const withLink = await readyPack();
      const withoutLink = await readyPack();
      await caller.rams.packs.issue({ packId: withLink.packId, confirmAttestation: true });
      await caller.rams.packs.issue({ packId: withoutLink.packId, confirmAttestation: true });
      await caller.rams.client.createLink({ packId: withLink.packId, issuedToName: 'Client' });

      const all = await caller.rams.packs.list({});
      expect(all).toHaveLength(2);

      const pending = await caller.rams.packs.list({ pendingClientAcceptance: true });
      expect(pending.map((p) => p.id)).toEqual([withLink.packId]);
    });

    it('drops a pack from the filter once the client decides', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      const link = await caller.rams.client.createLink({ packId });
      expect(await caller.rams.packs.list({ pendingClientAcceptance: true })).toHaveLength(1);

      await caller.rams.client.publicDecide({
        token: link.token,
        decision: 'accepted',
        acceptedByName: 'Dana',
      });
      expect(await caller.rams.packs.list({ pendingClientAcceptance: true })).toHaveLength(0);
    });

    it("refuses to render another pack's version under this pack", async () => {
      const caller = callerFor(adminId);
      const mine = await readyPack();
      const theirs = await readyPack();
      await caller.rams.packs.issue({ packId: mine.packId, confirmAttestation: true });
      await caller.rams.packs.issue({ packId: theirs.packId, confirmAttestation: true });

      const theirDetail = await caller.rams.packs.get({ packId: theirs.packId });
      const theirVersionId = theirDetail.versions[0]?.id;
      expect(theirVersionId).toBeDefined();
      if (theirVersionId === undefined) return;

      await expect(
        caller.rams.packs.renderPdf({ packId: mine.packId, packVersionId: theirVersionId }),
      ).rejects.toThrow(/version-not-found/);

      // The pack's own version still renders.
      const mineDetail = await caller.rams.packs.get({ packId: mine.packId });
      const myVersionId = mineDetail.versions[0]?.id;
      expect(myVersionId).toBeDefined();
      const rendered = await caller.rams.packs.renderPdf({
        packId: mine.packId,
        packVersionId: myVersionId,
      });
      expect(rendered.storageKey).toContain(mine.packId);
    });
  });

  // ─── CSV register export ───────────────────────────────────────────────

  describe('CSV register export', () => {
    it('exports one row per pack with the briefing count', async () => {
      const caller = callerFor(adminId);
      const { packId } = await readyPack();
      await caller.rams.packs.issue({ packId, confirmAttestation: true });
      await caller.rams.briefings.record({
        packId,
        entries: [{ kind: 'named_person', name: 'Joe' }],
      });

      const { csv, rowCount } = await caller.rams.packs.exportCsv({});
      expect(rowCount).toBe(1);
      const lines = csv.trim().split('\n');
      expect(lines[0]).toContain('Reference,Title,Status');
      expect(lines[1]).toContain('RAMS-000001');
      expect(lines[1]).toContain('issued');
      // Title contains an em dash but no comma; the client name is plain.
      expect(lines[1]).toContain('Riverside Estates');
      // Briefed-on-current-version column.
      expect(lines[1]?.split(',').at(-2)).toBe('1');
    });

    it('quotes cells containing commas', async () => {
      const caller = callerFor(adminId);
      await caller.rams.packs.create({
        title: 'Works, phase 1',
        clientName: 'Client "A"',
        locationText: '',
        supervisorName: '',
      });
      const { csv } = await caller.rams.packs.exportCsv({});
      expect(csv).toContain('"Works, phase 1"');
      expect(csv).toContain('"Client ""A"""');
    });
  });
});
