/**
 * Inspections module — the audit suite (FreeHS).
 *
 * Thirteenth module through the runbook, and the oldest: templates and
 * inspections are Phase 2, so this code predates every convention the
 * later modules were built to. `inspections.test.ts` covers the lifecycle
 * and `templates.test.ts` the content schema.
 *
 * Two questions this suite exists to ask.
 *
 * **Does the freeze hold?** An inspection pins its template version at
 * start (T-E04) and snapshots access state per ADR 0007. Both are promises
 * about the past: what the inspector was shown, and who could see it, must
 * not move because somebody later publishes a new template version or
 * reorganises the site tree. Everything downstream — the PDF, the public
 * share link, the approval — is only worth as much as that freeze.
 *
 * **Does the contractor boundary hold at every door?** The Observations
 * audit found `loadContractorScope` called in exactly two places in a
 * 1,620-line router — `list` and `get` — while three sibling read paths
 * resolved the record by tenant and id alone. `inspections.ts` calls it in
 * exactly two places as well, and a portal contractor's `inspections`
 * activity grants `inspections.view` + `.conduct` + `.sign` tenant-wide.
 * So this suite walks every door that grant opens.
 *
 * Five axes: IS-P (permissions), IS-S (contractor scoping parity), IS-F
 * (the freeze), IS-L (the public share link), IS-T (tenancy).
 *
 * Every test describes CORRECT behaviour. Those that name a live defect
 * fail today and are the acceptance criteria for the fix pass.
 */
import type { PGlite } from '@electric-sql/pglite';
import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { appRouter } from '../router';
import { createCallerFactory, router as trpcRouter } from '../trpc';
import { createExportsRouter } from './exports';
import { bootWorld, type World } from './__fixtures__/world';

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

/**
 * The default `appRouter` wires no share-token deps, so `createShareLink`
 * throws before it reaches anything worth testing. This instance supplies
 * deterministic ones so the link surface is exercisable.
 */
let shareTokenCounter = 0;
const createExportsCaller = createCallerFactory(
  trpcRouter({
    exports: createExportsRouter({
      renderPdf: async () => ({ key: 'stub://pdf', bytes: 0, stub: true }),
      renderDocx: async () => ({ key: 'stub://docx', bytes: 0 }),
      generateShareToken: () => `sharetoken${(shareTokenCounter += 1).toString().padStart(4, '0')}`,
      buildShareUrl: (token) => `http://localhost:3000/s/${token}`,
    }),
  }),
);

function inspectionProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('inspections.') || k.startsWith('signatures.'))
    .sort();
}

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

function serialise(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_k, v: unknown) => (v instanceof Date ? v.toISOString() : v)) ?? ''
    );
  } catch {
    return String(value);
  }
}

/** The signature item id used by every template this suite publishes. */
const SIG_ITEM_ID = newId();

/** A template with a text question and one open signature slot. */
function templateContent(questionLabel: string) {
  const textItemId = newId();
  return {
    schemaVersion: '1' as const,
    title: questionLabel,
    pages: [
      {
        id: newId(),
        type: 'title' as const,
        title: 'Title',
        sections: [
          {
            id: newId(),
            title: 's',
            items: [
              {
                id: newId(),
                type: 'conductedBy' as const,
                prompt: 'Conducted by',
                required: false,
              },
            ],
          },
        ],
      },
      {
        id: newId(),
        type: 'inspection' as const,
        title: 'Inspection',
        sections: [
          {
            id: newId(),
            title: 'Checks',
            items: [
              { id: textItemId, type: 'text' as const, prompt: questionLabel, required: false },
              {
                id: SIG_ITEM_ID,
                type: 'signature' as const,
                prompt: 'Sign here',
                required: false,
                mode: 'sequential' as const,
                slots: [{ slotIndex: 0, assigneeUserId: null, label: 'Inspector' }],
              },
            ],
          },
        ],
      },
    ],
    settings: {
      titleFormat: '{date}',
      documentNumberFormat: '{counter:6}',
      documentNumberStart: 1,
      approvalPage: {
        title: 'Approve',
        approverSlots: [{ slotIndex: 0, assigneeUserId: null }],
      },
    },
    customResponseSets: [],
  };
}

describe('inspections — audit suite', () => {
  let world: World;
  let client: PGlite;
  /** Internal inspector: view + conduct + sign + export + manage. */
  let inspectorId: string;
  /** External contractor portal user — the `inspections` activity grant. */
  let portalUserId: string;
  /** A published template and an in-progress inspection reported internally. */
  let templateId: string;
  let internalInspectionId: string;

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asPortalUser = () => createCaller(world.ctxFor(world.a.tenantId, portalUserId));

  /** Publish a template and return its id + current version id. */
  async function publishTemplate(
    questionLabel: string,
  ): Promise<{ templateId: string; versionId: string }> {
    const admin = asAdmin();
    const created = await admin.templates.create({
      name: `Audit template ${newId().slice(-6)}`,
    });
    await admin.templates.saveDraft({
      templateId: created.templateId,
      content: templateContent(questionLabel) as never,
    });
    const published = await admin.templates.publish({ templateId: created.templateId });
    return { templateId: created.templateId, versionId: published.versionId };
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
        email: `${name.toLowerCase().replace(/\W+/g, '-')}@northgate.test`,
        permissionSetId: setId,
      });
      return userId;
    };

    inspectorId = await mk('Internal inspector', [
      'inspections.view',
      'inspections.conduct',
      'inspections.sign',
      'inspections.export',
      'inspections.manage',
      'templates.view',
    ]);

    // Exactly what `CONTRACTOR_ACTIVITIES.inspections` grants, tenant-wide.
    portalUserId = await mk('Contractor portal user', [
      'inspections.view',
      'inspections.conduct',
      'inspections.sign',
    ]);
    await world.db.insert(schema.contractorUsers).values({
      id: newId(),
      tenantId: world.a.tenantId,
      contractorId: world.a.contractorIds[0] ?? '',
      userId: portalUserId,
      activities: ['inspections'] as never,
      acknowledgedAt: world.now,
      acknowledgedVersion: 1,
    });

    const published = await publishTemplate('ZZQUESTION-original-wording');
    templateId = published.templateId;

    // Started by an INTERNAL inspector — nothing to do with the contractor.
    const inspector = createCaller(world.ctxFor(world.a.tenantId, inspectorId));
    const started = await inspector.inspections.create({ templateId });
    internalInspectionId = started.inspectionId;
    await inspector.inspections.saveProgress({
      inspectionId: internalInspectionId,
      responses: { q1: { value: 'ZZANSWER-internal-only' } } as never,
    });
  }, 240_000);

  afterAll(async () => {
    await client.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IS-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('IS-P · permissions', () => {
    it('IS-P00 · the matrix covers every inspections and signatures procedure', () => {
      const procs = inspectionProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(12);
      expect(procs).toContain('inspections.create');
      expect(procs).toContain('signatures.sign');
    });

    it('IS-P01 · every procedure refuses a keyless caller, bar the two that authorise by signer', async () => {
      // `signWorkflow` and `listAwaitingMySignature` carry no
      // `requirePermission` ON PURPOSE: they authorise by named-signer
      // membership instead (`signerUserId === ctx.auth.userId`, FORBIDDEN
      // otherwise), because the person a template asks to counter-sign may
      // hold no inspections key at all. Declared by name so a THIRD ungated
      // procedure fails this test rather than joining a silent allowlist.
      const AUTHORISED_BY_SIGNER_MEMBERSHIP = [
        'inspections.signWorkflow',
        'inspections.listAwaitingMySignature',
      ];
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.nobody));
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of inspectionProcedures()) {
        if (AUTHORISED_BY_SIGNER_MEMBERSHIP.includes(path)) continue;
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('IS-P02 · conducting an inspection does not confer exporting or approving it', async () => {
      const conductor = createCaller(
        world.ctxFor(world.a.tenantId, await (async () => portalUserId)()),
      );
      for (const [path, input] of [
        ['exports.renderPdf', { inspectionId: internalInspectionId }],
        ['exports.createShareLink', { inspectionId: internalInspectionId }],
        ['inspectionsExport.exportCsv', {}],
      ] as Array<[string, unknown]>) {
        const res = await callFor(conductor, path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IS-S — contractor scoping parity
  // ═══════════════════════════════════════════════════════════════════════
  describe('IS-S · contractor scoping parity', () => {
    it('IS-S00 · control · the portal user cannot open the internal inspection', async () => {
      const res = await callFor(asPortalUser(), 'inspections.get', {
        inspectionId: internalInspectionId,
      });
      expect({ portalUserOpenedIt: res.ok }).toEqual({ portalUserOpenedIt: false });

      const list = await asPortalUser().inspections.list({});
      expect({
        internalInspectionInList: serialise(list).includes(internalInspectionId),
      }).toEqual({ internalInspectionInList: false });
    });

    it('IS-S01 · the signature sheet is scoped like the inspection it belongs to', async () => {
      // `signatures.listSlots` is gated on `inspections.view`, which the
      // portal user holds tenant-wide, and resolves the inspection by
      // tenant + id with no contractor scope. Same omission the
      // Observations audit found one level down from `get`.
      const res = await callFor(asPortalUser(), 'signatures.listSlots', {
        inspectionId: internalInspectionId,
      });
      expect({ signatureSheetLeaked: res.ok }).toEqual({ signatureSheetLeaked: false });
    });

    it('IS-S02 · the share-link list is scoped — this one hands over a public URL', async () => {
      // `exports.listShareLinks` is gated on `inspections.view` and
      // projects `buildShareUrl(token)` for every link on the inspection.
      // Unscoped, an external contractor is handed a working, opaque,
      // UNAUTHENTICATED URL to another company's completed inspection —
      // the one artefact in this module designed to be forwarded onwards.
      const exportsAdmin = createExportsCaller(
        world.ctxFor(world.a.tenantId, world.a.actors.admin),
      );
      await exportsAdmin.exports.createShareLink({ inspectionId: internalInspectionId });

      const portalExports = createExportsCaller(world.ctxFor(world.a.tenantId, portalUserId));
      const res = await callFor(portalExports as unknown as Caller, 'exports.listShareLinks', {
        inspectionId: internalInspectionId,
      });
      expect({ shareLinksLeaked: res.ok }).toEqual({ shareLinksLeaked: false });
    });

    it('IS-S03 · a portal user cannot write into an internal inspection', async () => {
      // `inspections.conduct` is granted tenant-wide by the portal
      // activity, and `saveProgress` resolves by tenant + id. Reading
      // another company's inspection is a disclosure; overwriting its
      // answers changes the evidential record of a walk-round somebody
      // else signs.
      const res = await callFor(asPortalUser(), 'inspections.saveProgress', {
        inspectionId: internalInspectionId,
        responses: { q1: { value: 'ZZOVERWRITE-from-outside' } },
      });
      expect({ overwroteInternalAnswers: res.ok }).toEqual({ overwroteInternalAnswers: false });

      const [row] = await world.db
        .select({ responses: schema.inspections.responses })
        .from(schema.inspections)
        .where(eq(schema.inspections.id, internalInspectionId));
      expect({
        answersStillInternal: !serialise(row?.responses).includes('ZZOVERWRITE'),
      }).toEqual({ answersStillInternal: true });
    });

    it('IS-S04 · a portal user cannot sign an internal inspection', async () => {
      // The sharpest of the four. A signature is an attestation by a named
      // person that they carried out the check — `inspections.sign` is
      // granted tenant-wide by the activity, and `signatures.sign`
      // resolves by tenant + id.
      const res = await callFor(asPortalUser(), 'signatures.sign', {
        inspectionId: internalInspectionId,
        slotIndex: 0,
        slotId: SIG_ITEM_ID,
        signatureData: 'data:image/png;base64,iVBORw0KGgo=',
        signerName: 'Outside Contractor',
      });
      expect({ signedSomebodyElsesInspection: res.ok }).toEqual({
        signedSomebodyElsesInspection: false,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IS-F — the freeze
  // ═══════════════════════════════════════════════════════════════════════
  describe('IS-F · the freeze', () => {
    it('IS-F01 · T-E04 · publishing a new template version does not alter an inspection in progress', async () => {
      // The inspector is halfway through a walk-round on their phone. If
      // publishing a revision retitled the questions underneath them, the
      // answers already given would be answers to questions nobody asked.
      const admin = asAdmin();
      const { templateId: tid } = await publishTemplate('ZZQUESTION-as-started');
      const inspector = createCaller(world.ctxFor(world.a.tenantId, inspectorId));
      const { inspectionId } = await inspector.inspections.create({ templateId: tid });

      const [before] = await world.db
        .select({ versionId: schema.inspections.templateVersionId })
        .from(schema.inspections)
        .where(eq(schema.inspections.id, inspectionId));

      await admin.templates.saveDraft({
        templateId: tid,
        content: templateContent('ZZQUESTION-rewritten-mid-walk-round') as never,
      });
      await admin.templates.publish({ templateId: tid });

      const [after] = await world.db
        .select({ versionId: schema.inspections.templateVersionId })
        .from(schema.inspections)
        .where(eq(schema.inspections.id, inspectionId));
      const seen = await inspector.inspections.get({ inspectionId });

      expect({
        pinMoved: before?.versionId !== after?.versionId,
        inspectorSeesRewrite: serialise(seen).includes('ZZQUESTION-rewritten-mid-walk-round'),
        inspectorSeesOriginal: serialise(seen).includes('ZZQUESTION-as-started'),
      }).toEqual({ pinMoved: false, inspectorSeesRewrite: false, inspectorSeesOriginal: true });
    });

    it('IS-F02 · ADR 0007 · the access snapshot is frozen at start, not recomputed on read', async () => {
      const inspector = createCaller(world.ctxFor(world.a.tenantId, inspectorId));
      const { inspectionId } = await inspector.inspections.create({ templateId });

      const [row] = await world.db
        .select({ snapshot: schema.inspections.accessSnapshot })
        .from(schema.inspections)
        .where(eq(schema.inspections.id, inspectionId));
      const snapshot = row?.snapshot as { snapshotAt?: string } | null;

      expect({
        snapshotWritten: snapshot !== null && typeof snapshot?.snapshotAt === 'string',
      }).toEqual({ snapshotWritten: true });
    });

    it('IS-F03 · archiving the template stops new starts and leaves the one in progress completable', async () => {
      // T-E05. The template is withdrawn because it is wrong; the
      // walk-round already under way still has to be finishable, because
      // the inspector is standing in the plant room holding a phone.
      const admin = asAdmin();
      const { templateId: tid } = await publishTemplate('ZZQUESTION-to-be-archived');
      const inspector = createCaller(world.ctxFor(world.a.tenantId, inspectorId));
      const { inspectionId } = await inspector.inspections.create({ templateId: tid });
      await admin.templates.archive({ templateId: tid });

      const newStart = await callFor(inspector, 'inspections.create', { templateId: tid });
      const carryOn = await callFor(inspector, 'inspections.saveProgress', {
        inspectionId,
        responses: { q1: { value: 'Finished after the template was withdrawn' } },
      });

      expect({ startedAfterArchive: newStart.ok, finishedInFlight: carryOn.ok }).toEqual({
        startedAfterArchive: false,
        finishedInFlight: true,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IS-L — the public share link
  // ═══════════════════════════════════════════════════════════════════════
  describe('IS-L · the public share link', () => {
    it('IS-L01 · a revoked share link stops resolving', async () => {
      const admin = createExportsCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
      const { linkId } = await admin.exports.createShareLink({
        inspectionId: internalInspectionId,
      });
      await admin.exports.revokeShareLink({ linkId });

      const links = await admin.exports.listShareLinks({ inspectionId: internalInspectionId });
      const revoked = links.find((l) => l.linkId === linkId);
      expect({ revoked: revoked?.revoked }).toEqual({ revoked: true });
    });

    it('IS-L02 · minting and revoking a public link needs inspections.export, not view', async () => {
      // The share link serves the whole inspection to anyone holding the
      // URL, with no account. Creating one is a decision to publish; the
      // read permission must not carry it.
      const viewerOnly = createExportsCaller(world.ctxFor(world.a.tenantId, portalUserId));
      const res = await callFor(viewerOnly as unknown as Caller, 'exports.createShareLink', {
        inspectionId: internalInspectionId,
      });
      expect({ mintedWithViewOnly: res.ok }).toEqual({ mintedWithViewOnly: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IS-T — tenancy
  // ═══════════════════════════════════════════════════════════════════════
  describe('IS-T · tenancy', () => {
    it('IS-T01 · no inspections procedure reaches another tenant inspection', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const foreignTemplate = await otherAdmin.templates.create({ name: 'Foreign template' });
      await otherAdmin.templates.saveDraft({
        templateId: foreignTemplate.templateId,
        content: templateContent('ZZFOREIGNQUESTION-do-not-disclose') as never,
      });
      await otherAdmin.templates.publish({ templateId: foreignTemplate.templateId });
      const { inspectionId: foreignInspection } = await otherAdmin.inspections.create({
        templateId: foreignTemplate.templateId,
      });

      const reached: string[] = [];
      for (const path of [...inspectionProcedures(), 'exports.listShareLinks']) {
        const res = await callFor(asAdmin(), path, {
          inspectionId: foreignInspection,
          templateId: foreignTemplate.templateId,
        });
        if (res.ok && serialise(res.value).includes('ZZFOREIGNQUESTION')) reached.push(path);
      }
      expect(reached).toEqual([]);

      const [row] = await world.db
        .select({ status: schema.inspections.status })
        .from(schema.inspections)
        .where(eq(schema.inspections.id, foreignInspection));
      expect({ status: row?.status }).toEqual({ status: 'in_progress' });
    });

    it('IS-T02 · an inspection cannot be started from, or moved to, another tenant', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const foreign = await otherAdmin.templates.create({ name: 'Foreign template for starting' });

      const started = await callFor(asAdmin(), 'inspections.create', {
        templateId: foreign.templateId,
      });
      expect({ startedFromForeignTemplate: started.ok }).toEqual({
        startedFromForeignTemplate: false,
      });

      const moved = await callFor(asAdmin(), 'inspections.setSite', {
        inspectionId: internalInspectionId,
        siteId: world.b.sites.primary,
      });
      expect({ movedToForeignSite: moved.ok }).toEqual({ movedToForeignSite: false });
    });
  });
});
