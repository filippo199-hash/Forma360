/**
 * RAMS module — the audit suite (FreeHS).
 *
 * The sixth module through the testing runbook, and the densest
 * cross-module node in the product: a pack binds risk-assessment
 * **versions**, references COSHH records, attaches library documents, is
 * issued to a client over an opaque public link, is briefed to a crew, and
 * is read back by Permits as a precondition for issuing a permit to work.
 *
 * That density is why it comes now. The last three audits found the same
 * defect ten times over — a module reading another module's records without
 * applying that module's access rule. RAMS reads more modules than anything
 * else here, so it is either the worst case of the pattern or the place it
 * was done properly.
 *
 * The module's other distinguishing property is that **issue freezes**. A
 * pack version snapshots its bound assessments, documents and attestation at
 * the moment of signing (ADR 0007/0015), so that a later revision of a risk
 * assessment cannot retroactively change what a crew was briefed on. Two
 * consequences drive this suite:
 *
 *   - the freeze has to actually hold, or "what was in force on the day" —
 *     the question the whole module exists to answer — has no answer; and
 *   - because the snapshot is immutable, **any access check has to happen at
 *     attach time**. A filter on the way out cannot help once the content is
 *     frozen and being served to an unauthenticated client.
 *
 * Six axes: RS-P (permissions, six keys — the finest-grained catalogue in
 * the product), RS-X (cross-module reads), RS-I (the freeze), RS-G (the
 * issue gate), RS-C (the client link), RS-T (tenancy).
 *
 * Every test describes CORRECT behaviour. Those that name a live defect fail
 * today and are the acceptance criteria for the fix pass.
 */
import type { PGlite } from '@electric-sql/pglite';
import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { methodStatementContentSchema, type MethodStatementContent } from '@forma360/shared/rams';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';
import { bootWorld, type World } from './__fixtures__/world';

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

function ramsProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('rams.'))
    .sort();
}

/** Public by design — the client acceptance link. */
const DECLARED_PUBLIC: Record<string, string> = {
  'rams.client.publicGet': 'client acceptance view — no login, opaque per-issue token',
  'rams.client.publicDecide': 'client accept/reject — no login, opaque per-issue token',
};

function resolve(caller: Caller, path: string): (input?: unknown) => Promise<unknown> {
  return path
    .split('.')
    .reduce<
      Record<string, unknown>
    >((acc, part) => acc[part] as Record<string, unknown>, caller as unknown as Record<string, unknown>) as unknown as (
    input?: unknown,
  ) => Promise<unknown>;
}

async function callFor(
  caller: Caller,
  path: string,
  input?: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; code: string; message: string }> {
  try {
    return { ok: true, value: await resolve(caller, path)(input) };
  } catch (err) {
    return {
      ok: false,
      code: err instanceof TRPCError ? err.code : 'NON_TRPC_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

describe('rams — audit suite', () => {
  let world: World;
  let client: PGlite;
  /** Holds every rams key. */
  let authorId: string;
  /** Holds `rams.create` but NOT `rams.issue` — the separation under test. */
  let draughtsmanId: string;
  /** Holds `rams.view` + `rams.brief` and no document key at all. */
  let supervisorId: string;

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asDraughtsman = () => createCaller(world.ctxFor(world.a.tenantId, draughtsmanId));
  const asSupervisor = () => createCaller(world.ctxFor(world.a.tenantId, supervisorId));
  const asPublic = () => createCaller(world.publicCtx());

  /** A published risk assessment with one high-residual hazard. */
  async function makeRiskAssessment(opts?: {
    residualLikelihood?: number;
    residualSeverity?: number;
    title?: string;
  }): Promise<{ assessmentId: string; versionId: string }> {
    const assessmentId = newId();
    const versionId = newId();
    const title = opts?.title ?? 'Working at height';
    await world.db.insert(schema.riskAssessments).values({
      id: assessmentId,
      tenantId: world.a.tenantId,
      referenceNumber: `RA-${assessmentId.slice(-6)}`,
      title,
      activity: 'Roof access and plant maintenance',
      status: 'active',
      currentVersion: 1,
      createdBy: world.a.actors.admin,
      publishedAt: new Date(),
    });
    await world.db.insert(schema.riskAssessmentVersions).values({
      id: versionId,
      tenantId: world.a.tenantId,
      assessmentId,
      versionNumber: 1,
      content: {
        title,
        activity: 'Roof access and plant maintenance',
        type: 'standing',
        siteId: null,
        siteName: null,
        locationText: null,
        matrix: { lowMax: 4, mediumMax: 9, highMax: 15 },
        hazards: [
          {
            hazard: 'Fall from height',
            harmDescription: 'Serious injury or fatality',
            affectedGroups: ['employees'],
            initialLikelihood: 5,
            initialSeverity: 5,
            existingControls: 'Edge protection',
            residualLikelihood: opts?.residualLikelihood ?? 5,
            residualSeverity: opts?.residualSeverity ?? 4,
            residualJustification: '',
            controls: [],
          },
        ],
      },
      signedOffBy: world.a.actors.admin,
      signedOffByName: 'Ada Admin',
      signedOffAt: new Date(),
    });
    return { assessmentId, versionId };
  }

  function content(hazardRef?: {
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

  /** A pack bound to a published RA with its high-risk hazard referenced. */
  async function readyPack(opts?: { referenceHazard?: boolean }): Promise<{
    packId: string;
    assessmentId: string;
    versionId: string;
  }> {
    const caller = asAdmin();
    const { assessmentId, versionId } = await makeRiskAssessment();
    const { packId } = await caller.rams.packs.create({
      title: 'AHU filter replacement — Riverside',
      clientName: 'Riverside Estates',
      siteId: world.a.sites.primary,
      locationText: 'Plant room 3',
      supervisorName: 'Tom Whitfield',
    });
    await caller.rams.packs.bindRiskAssessment({ packId, assessmentId });
    await caller.rams.packs.saveDraft({
      packId,
      content:
        opts?.referenceHazard === false
          ? content()
          : content({ raVersionId: versionId, hazardIndex: 0 }),
    });
    return { packId, assessmentId, versionId };
  }

  beforeAll(async () => {
    resetDependentsRegistryForTests();
    world = await bootWorld();
    client = world.client;

    const mk = async (name: string, permissions: string[]): Promise<string> => {
      const setId = newId();
      await world.db.insert(schema.permissionSets).values({
        id: setId,
        tenantId: world.a.tenantId,
        name,
        permissions: permissions as never,
      });
      const userId = newId();
      await world.db.insert(schema.user).values({
        id: userId,
        tenantId: world.a.tenantId,
        name,
        email: `${name.replace(/\W+/g, '-').toLowerCase()}@northgate.test`,
        permissionSetId: setId,
      });
      return userId;
    };
    authorId = await mk('RAMS author', [
      'rams.view',
      'rams.create',
      'rams.issue',
      'rams.brief',
      'documents.view',
    ]);
    draughtsmanId = await mk('RAMS draughtsman', ['rams.view', 'rams.create', 'documents.view']);
    supervisorId = await mk('Site supervisor', ['rams.view', 'rams.brief']);
  }, 180_000);

  afterAll(async () => {
    await client.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RS-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('RS-P · permissions', () => {
    it('RS-P00 · the matrix covers every rams procedure the router exposes', () => {
      const procs = ramsProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(30);
      for (const key of Object.keys(DECLARED_PUBLIC)) expect(procs).toContain(key);
    });

    it('RS-P01 · every non-public procedure refuses a user holding no rams key', async () => {
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.nobody));
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of ramsProcedures()) {
        if (path in DECLARED_PUBLIC) continue;
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('RS-P02 · authoring a pack and issuing one are genuinely different authorities', async () => {
      // `rams.issue` is the attestation authority: signing a pack asserts
      // the method is safe and the assessments are current. It is separate
      // from `rams.create` on purpose, and this is the assertion that keeps
      // it separate — the equivalent key in Contractors turned out to gate
      // nothing at all.
      const { packId } = await readyPack();
      const res = await callFor(asDraughtsman(), 'rams.packs.issue', {
        packId,
        confirmAttestation: true,
      });
      expect({ draughtsmanCouldIssue: res.ok }).toEqual({ draughtsmanCouldIssue: false });
    });

    it('RS-P03 · a supervisor can brief a crew without being able to author or issue', async () => {
      // `rams.brief` exists so a working supervisor can record that the crew
      // was briefed without holding authoring rights.
      const caller = asSupervisor();
      for (const [path, input] of [
        ['rams.packs.create', { title: 'Should not exist' }],
        ['rams.packs.issue', { packId: newId(), confirmAttestation: true }],
        ['rams.methodStatements.create', { title: 'Should not exist' }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(caller, path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RS-G — the issue gate
  // ═══════════════════════════════════════════════════════════════════════
  describe('RS-G · the issue gate', () => {
    it('RS-G01 · a pack whose high-risk hazard no step addresses cannot be issued', async () => {
      // The headline rule of the whole module (ADR 0015): a pack that binds
      // an assessment carrying a high residual risk, and then describes a
      // method in which no step references that hazard, is a pack that has
      // not addressed the thing most likely to hurt somebody.
      const { packId } = await readyPack({ referenceHazard: false });
      const res = await callFor(asAdmin(), 'rams.packs.issue', {
        packId,
        confirmAttestation: true,
      });
      expect({ issuedWithUnaddressedHighRisk: res.ok }).toEqual({
        issuedWithUnaddressedHighRisk: false,
      });
    });

    it('RS-G02 · the same pack issues once a step references the hazard', async () => {
      const { packId } = await readyPack();
      const res = await callFor(asAdmin(), 'rams.packs.issue', {
        packId,
        confirmAttestation: true,
      });
      expect({ issued: res.ok }).toEqual({ issued: true });
    });

    it('RS-G03 · the attestation must be confirmed, not defaulted', async () => {
      // The attestation text is snapshotted onto the issued version as the
      // record of what the signer asserted. Issuing without confirming it
      // would make that record a fiction.
      const { packId } = await readyPack();
      const res = await callFor(asAdmin(), 'rams.packs.issue', {
        packId,
        confirmAttestation: false,
      });
      expect({ issuedWithoutAttesting: res.ok }).toEqual({ issuedWithoutAttesting: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RS-I — the freeze
  // ═══════════════════════════════════════════════════════════════════════
  describe('RS-I · the freeze', () => {
    it('RS-I01 · revising the bound risk assessment does not alter an issued pack', async () => {
      // The question the module exists to answer is "what was in force on
      // the day". If a later RA revision reaches back into an issued pack,
      // there is no answer — the record becomes whatever is true now.
      const admin = asAdmin();
      const { packId, assessmentId } = await readyPack();
      await admin.rams.packs.issue({ packId, confirmAttestation: true });

      const before = (await admin.rams.packs.get({ packId })) as {
        currentVersion?: { content?: unknown };
      };
      const frozen = JSON.stringify(before.currentVersion?.content ?? {});

      // A new published version of the bound assessment, with the hazard
      // wording changed.
      await world.db.insert(schema.riskAssessmentVersions).values({
        id: newId(),
        tenantId: world.a.tenantId,
        assessmentId,
        versionNumber: 2,
        content: {
          title: 'Working at height (revised)',
          activity: 'Roof access and plant maintenance',
          type: 'standing',
          siteId: null,
          siteName: null,
          locationText: null,
          matrix: { lowMax: 4, mediumMax: 9, highMax: 15 },
          hazards: [
            {
              hazard: 'REWRITTEN AFTER ISSUE',
              harmDescription: 'Serious injury or fatality',
              affectedGroups: ['employees'],
              initialLikelihood: 5,
              initialSeverity: 5,
              existingControls: 'Edge protection',
              residualLikelihood: 5,
              residualSeverity: 4,
              residualJustification: '',
              controls: [],
            },
          ],
        },
        signedOffBy: world.a.actors.admin,
        signedOffByName: 'Ada Admin',
        signedOffAt: new Date(),
      });
      await world.db
        .update(schema.riskAssessments)
        .set({ currentVersion: 2 })
        .where(eq(schema.riskAssessments.id, assessmentId));

      const after = (await admin.rams.packs.get({ packId })) as {
        currentVersion?: { content?: unknown };
      };
      expect(JSON.stringify(after.currentVersion?.content ?? {})).toBe(frozen);
      expect(JSON.stringify(after.currentVersion?.content ?? {})).not.toContain(
        'REWRITTEN AFTER ISSUE',
      );
    });

    it('RS-I02 · an issued version content row is never UPDATEd by a draft save', async () => {
      // Editing an issued pack is legitimate — it produces a new draft. What
      // must not happen is the issued row changing underneath the crew that
      // was briefed on it.
      const admin = asAdmin();
      const { packId, versionId } = await readyPack();
      await admin.rams.packs.issue({ packId, confirmAttestation: true });

      const [issued] = await world.db
        .select({ id: schema.ramsPackVersions.id, content: schema.ramsPackVersions.content })
        .from(schema.ramsPackVersions)
        .where(eq(schema.ramsPackVersions.packId, packId));
      const beforeJson = JSON.stringify(issued?.content ?? {});

      await admin.rams.packs.saveDraft({
        packId,
        content: {
          ...content({ raVersionId: versionId, hazardIndex: 0 }),
          scopeOfWorks: 'EDITED AFTER ISSUE',
        },
      });

      const [afterRow] = await world.db
        .select({ content: schema.ramsPackVersions.content })
        .from(schema.ramsPackVersions)
        .where(eq(schema.ramsPackVersions.id, issued?.id ?? ''));
      expect(JSON.stringify(afterRow?.content ?? {})).toBe(beforeJson);
    });

    it('RS-I03 · re-issuing writes version n+1 and leaves version n readable', async () => {
      // "What was in force on the day" needs the superseded version to
      // survive, not to be replaced.
      const admin = asAdmin();
      const { packId, versionId } = await readyPack();
      await admin.rams.packs.issue({ packId, confirmAttestation: true });
      await admin.rams.packs.saveDraft({
        packId,
        content: {
          ...content({ raVersionId: versionId, hazardIndex: 0 }),
          scopeOfWorks: 'Revised scope for the second issue.',
        },
      });
      await admin.rams.packs.issue({
        packId,
        confirmAttestation: true,
        reissueNote: 'Scope widened to the second AHU.',
      });

      const versions = await world.db
        .select({ n: schema.ramsPackVersions.versionNumber })
        .from(schema.ramsPackVersions)
        .where(eq(schema.ramsPackVersions.packId, packId));
      expect(versions.map((v) => v.n).sort()).toEqual([1, 2]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RS-X — cross-module reads
  // ═══════════════════════════════════════════════════════════════════════
  describe('RS-X · cross-module reads', () => {
    it('RS-X00 · the documents module refuses this author the restricted document', async () => {
      // Control. `authorId` is in no group, so the Night shift document is
      // genuinely out of reach through its own module.
      const res = await callFor(
        createCaller(world.ctxFor(world.a.tenantId, authorId)),
        'documents.get',
        { documentId: world.a.documents.groupRestrictedDoc as string },
      );
      expect({ readableViaDocuments: res.ok }).toEqual({ readableViaDocuments: false });
    });

    it('RS-X01 · a pack cannot attach a document its author may not open', async () => {
      // `addDocument` resolves the document by tenant and archived-ness only,
      // with no visibility check — the same shape as Heads-Up HU-D03, which
      // was fixed by refusing at attach time.
      //
      // Attach time is the ONLY place this can be fixed here. A RAMS pack
      // snapshots its documents into an immutable issued version and then
      // serves that version to an unauthenticated client over a share link,
      // so there is no later point at which a filter could run.
      const { packId } = await readyPack();
      const res = await callFor(
        createCaller(world.ctxFor(world.a.tenantId, authorId)),
        'rams.packs.addDocument',
        { packId, documentId: world.a.documents.groupRestrictedDoc as string },
      );
      expect({ attachedARestrictedDoc: res.ok }).toEqual({ attachedARestrictedDoc: false });
    });

    it('RS-X02 · an unrestricted document attaches normally', async () => {
      // The other half: fixing RS-X01 must not break the ordinary case.
      const { packId } = await readyPack();
      const res = await callFor(
        createCaller(world.ctxFor(world.a.tenantId, authorId)),
        'rams.packs.addDocument',
        { packId, documentId: world.a.documents.publicDoc as string },
      );
      expect({ attachedAnOpenDoc: res.ok }).toEqual({ attachedAnOpenDoc: true });
    });

    it('RS-X03 · a pack cannot bind a risk assessment from another tenant', async () => {
      const { packId } = await readyPack();
      const foreignRa = newId();
      await world.db.insert(schema.riskAssessments).values({
        id: foreignRa,
        tenantId: world.b.tenantId,
        referenceNumber: 'RA-FOREIGN',
        title: 'Foreign assessment',
        activity: 'Something else',
        status: 'active',
        currentVersion: 1,
        createdBy: world.b.actors.admin,
        publishedAt: new Date(),
      });
      const res = await callFor(asAdmin(), 'rams.packs.bindRiskAssessment', {
        packId,
        assessmentId: foreignRa,
      });
      expect({ boundForeignRa: res.ok }).toEqual({ boundForeignRa: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RS-C — the client link
  // ═══════════════════════════════════════════════════════════════════════
  describe('RS-C · the client acceptance link', () => {
    async function issuedPackWithLink(): Promise<{ packId: string; token: string }> {
      const admin = asAdmin();
      const { packId } = await readyPack();
      await admin.rams.packs.issue({ packId, confirmAttestation: true });
      const link = (await admin.rams.client.createLink({
        packId,
        issuedToName: 'Riverside Estates',
      })) as { token?: string; url?: string };
      const token = link.token ?? (link.url ?? '').split('/').filter(Boolean).pop() ?? '';
      return { packId, token };
    }

    it('RS-C01 · the client view never carries the tenant id', async () => {
      const { token } = await issuedPackWithLink();
      const view = (await asPublic().rams.client.publicGet({ token })) as Record<string, unknown>;
      expect(Object.keys(view)).not.toContain('tenantId');
    });

    it('RS-C02 · the pack view lists client links without projecting the token', async () => {
      // RS-A3: an opaque token is a bearer credential — anyone holding it
      // can read the issued pack with no login. It belongs in the deliberate
      // "copy link" action (`client.getLinkUrl`, gated on `rams.issue`), not
      // in the pack payload that every `rams.view` holder receives.
      const { packId, token } = await issuedPackWithLink();
      const pack = (await asAdmin().rams.packs.get({ packId })) as {
        clientLinks?: Array<Record<string, unknown>>;
      };
      const links = pack.clientLinks ?? [];
      expect(links.length).toBeGreaterThan(0);
      expect({
        anyLinkCarriesToken: links.some((l) => 'token' in l),
        tokenAppearsAnywhere: JSON.stringify(pack).includes(token),
      }).toEqual({ anyLinkCarriesToken: false, tokenAppearsAnywhere: false });
    });

    it('RS-C03 · a revoked link stops resolving', async () => {
      const admin = asAdmin();
      const { packId, token } = await issuedPackWithLink();
      const before = await callFor(asPublic(), 'rams.client.publicGet', { token });
      expect(before.ok).toBe(true);

      const links = await world.db
        .select({ id: schema.ramsClientLinks.id })
        .from(schema.ramsClientLinks)
        .where(eq(schema.ramsClientLinks.packId, packId));
      await admin.rams.client.revokeLink({ linkId: links[0]?.id as string });

      const after = await callFor(asPublic(), 'rams.client.publicGet', { token });
      expect({ revokedLinkStillResolves: after.ok }).toEqual({ revokedLinkStillResolves: false });
    });

    it('RS-C04 · a client cannot re-decide after accepting', async () => {
      // The acceptance is recorded against the exact issued version and is
      // the client's contractual answer. Letting it be overwritten from an
      // unauthenticated endpoint would make it worthless as evidence.
      const { token } = await issuedPackWithLink();
      const first = await callFor(asPublic(), 'rams.client.publicDecide', {
        token,
        decision: 'accepted',
        acceptedByName: 'C. Client',
        acceptedByOrganisation: 'Riverside Estates',
      });
      expect({ step: 'first', ok: first.ok }).toEqual({ step: 'first', ok: true });

      const second = await callFor(asPublic(), 'rams.client.publicDecide', {
        token,
        decision: 'rejected',
        acceptedByName: 'C. Client',
        acceptedByOrganisation: 'Riverside Estates',
      });
      expect({ reDecided: second.ok }).toEqual({ reDecided: false });
    });

    it('RS-C05 · an unknown token is refused rather than resolving to anything', async () => {
      for (const token of ['not-a-real-token', 'x'.repeat(40)]) {
        const res = await callFor(asPublic(), 'rams.client.publicGet', { token });
        expect({ token, ok: res.ok }).toEqual({ token, ok: false });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RS-T — tenancy
  // ═══════════════════════════════════════════════════════════════════════
  describe('RS-T · tenancy', () => {
    it('RS-T01 · another tenant pack is unreadable and unmutatable', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { packId } = await otherAdmin.rams.packs.create({
        title: 'Foreign pack',
        clientName: 'Someone else',
      });

      for (const [path, input] of [
        ['rams.packs.get', { packId }],
        ['rams.packs.saveDraft', { packId, content: content() }],
        ['rams.packs.issue', { packId, confirmAttestation: true }],
        ['rams.packs.archive', { packId }],
        ['rams.packs.addDocument', { packId, documentId: world.a.documents.publicDoc as string }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(asAdmin(), path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }

      const [row] = await world.db
        .select({ title: schema.ramsPacks.title, status: schema.ramsPacks.status })
        .from(schema.ramsPacks)
        .where(eq(schema.ramsPacks.id, packId));
      expect(row?.title).toBe('Foreign pack');
      expect(row?.status).toBe('draft');
    });

    it('RS-T02 · the register never contains another tenant packs', async () => {
      const res = (await asAdmin().rams.packs.list({})) as
        | { packs?: Array<{ tenantId?: string }> }
        | Array<{ id: string }>;
      const rows = Array.isArray(res) ? res : (res.packs ?? []);
      const foreign = await world.db
        .select({ id: schema.ramsPacks.id })
        .from(schema.ramsPacks)
        .where(eq(schema.ramsPacks.tenantId, world.b.tenantId));
      const foreignIds = new Set(foreign.map((f) => f.id));
      expect((rows as Array<{ id: string }>).filter((r) => foreignIds.has(r.id))).toEqual([]);
    });
  });
});
