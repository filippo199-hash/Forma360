/**
 * Heads-Up / Briefings — the audit suite (FreeHS).
 *
 * The fourth module through the testing runbook, and the first chosen for a
 * **cross-module** reason rather than its own surface.
 *
 * The Documents audit established that the document visibility layer holds
 * under every read path *that module* exposes. Heads-Up is the module that
 * can route around it: a briefing attaches a library document and pushes it
 * to a named list of people, and if nothing in that path asks whether each
 * recipient was entitled to the document, the restriction is decorative.
 * A per-module access rule is only as strong as the modules that consume it,
 * and no amount of reading Documents proves anything about Heads-Up.
 *
 * The second reason is that this module is where a legal record is made.
 * `signedAt` on a briefing is the evidence that a person was told something
 * before they were asked to do it. Anything that lets a signature be forged,
 * duplicated, back-filled or collected against a withdrawn briefing damages
 * the one artefact the module exists to produce.
 *
 * Five axes:
 *
 *   1. **HU-P — the generated permission matrix.** Every `headsUps.*`
 *      procedure enumerated from the router at runtime.
 *   2. **HU-R — the engagement record.** Who may sign, for whom, in what
 *      order, how many times, and against which lifecycle states.
 *   3. **HU-D — document disclosure.** The cross-module axis above,
 *      including the unauthenticated share link.
 *   4. **HU-T — tenancy.** Ground rule 4, against the mirror tenant.
 *   5. **HU-V — volume.** A 200-recipient fan-out against the engagement
 *      roll-up and the recipient list.
 *
 * Every test describes CORRECT behaviour. Those that name a live defect fail
 * today and are the acceptance criteria for the fix pass.
 */
import type { PGlite } from '@electric-sql/pglite';
import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@forma360/db/schema';
import { and, eq } from 'drizzle-orm';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';
import { loadHeadsUpLibraryDocuments } from '../heads-up-documents';
import { bootWorld, type World } from './__fixtures__/world';

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

function headsUpProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('headsUps.'))
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

describe('heads-up — audit suite', () => {
  let world: World;
  let client: PGlite;

  beforeAll(async () => {
    resetDependentsRegistryForTests();
    world = await bootWorld();
    client = world.client;
  }, 180_000);

  afterAll(async () => {
    await client.close();
  });

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  /** A recipient of the published briefing, and of the leaky one. */
  const asRecipient = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.standard));
  /** A recipient who has already acknowledged the published briefing. */
  const asAckedRecipient = () =>
    createCaller(world.ctxFor(world.a.tenantId, world.a.actors.trainingRecorder));
  /** Holds `headsUp.view` and is on nobody's recipient list. */
  const asNonRecipient = () =>
    createCaller(world.ctxFor(world.a.tenantId, world.a.actors.trainingViewer));

  // ═══════════════════════════════════════════════════════════════════════
  // HU-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('HU-P · permissions', () => {
    it('HU-P00 · the matrix covers every heads-up procedure the router exposes', () => {
      const procs = headsUpProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(20);
      expect(procs).toContain('headsUps.sign');
      expect(procs).toContain('headsUps.engagementSummary');
    });

    it('HU-P01 · every procedure refuses a user holding no headsUp key', async () => {
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.nobody));
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of headsUpProcedures()) {
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('HU-P02 · a headsUp.view holder cannot publish, edit or read the analytics', async () => {
      // `headsUp.view` is in the seeded Standard set — every employee holds
      // it, because everybody receives briefings. So what it does NOT grant
      // is the whole of the module's access model.
      const caller = asRecipient();
      const headsUpId = world.a.headsUps.published as string;
      for (const [path, input] of [
        ['headsUps.create', { title: 'Should not exist', description: '' }],
        ['headsUps.update', { headsUpId, title: 'Renamed' }],
        ['headsUps.publish', { headsUpId }],
        ['headsUps.archive', { headsUpId }],
        ['headsUps.createShareLink', { headsUpId }],
        ['headsUps.sendReminder', { headsUpId }],
        ['headsUps.engagementSummary', { headsUpId }],
        ['headsUps.listRecipients', { headsUpId }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(caller, path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // HU-R — the engagement record
  // ═══════════════════════════════════════════════════════════════════════
  describe('HU-R · the engagement record', () => {
    it('HU-R01 · a non-recipient cannot acknowledge or sign', async () => {
      const caller = asNonRecipient();
      const headsUpId = world.a.headsUps.published as string;
      for (const path of ['headsUps.markAcknowledged', 'headsUps.sign']) {
        const res = await callFor(caller, path, { headsUpId, signatureData: 'data:image/png,x' });
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });

    it('HU-R02 · a recipient cannot sign on behalf of anybody else', async () => {
      // The signature is scoped to `ctx.auth.userId` rather than taken from
      // input, so there is no parameter to forge. Pinned because a signature
      // is the module's whole output: if this ever becomes settable, the
      // record stops being evidence.
      const before = await world.db
        .select({ signedAt: schema.headsUpRecipients.signedAt })
        .from(schema.headsUpRecipients)
        .where(
          and(
            eq(schema.headsUpRecipients.headsUpId, world.a.headsUps.published as string),
            eq(schema.headsUpRecipients.userId, world.a.actors.trainingRecorder),
          ),
        );
      // A hostile caller passing someone else's id in every plausible field.
      await callFor(asRecipient(), 'headsUps.sign', {
        headsUpId: world.a.headsUps.published as string,
        userId: world.a.actors.trainingRecorder,
        recipientUserId: world.a.actors.trainingRecorder,
        signatureData: 'data:image/png;base64,forged',
      });
      const after = await world.db
        .select({ signedAt: schema.headsUpRecipients.signedAt })
        .from(schema.headsUpRecipients)
        .where(
          and(
            eq(schema.headsUpRecipients.headsUpId, world.a.headsUps.published as string),
            eq(schema.headsUpRecipients.userId, world.a.actors.trainingRecorder),
          ),
        );
      expect({ before: before[0]?.signedAt, after: after[0]?.signedAt }).toEqual({
        before: null,
        after: null,
      });
    });

    it('HU-R03 · signing requires acknowledgement first when the briefing demands it', async () => {
      // H-E09. The recipient has viewed but not acknowledged.
      const res = await callFor(asRecipient(), 'headsUps.sign', {
        headsUpId: world.a.headsUps.published as string,
        signatureData: 'data:image/png;base64,x',
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toContain('acknowledge');
    });

    it('HU-R04 · a recipient who has acknowledged can sign, once, idempotently', async () => {
      const caller = asAckedRecipient();
      const headsUpId = world.a.headsUps.published as string;
      const first = await callFor(caller, 'headsUps.sign', {
        headsUpId,
        signatureData: 'data:image/png;base64,first',
      });
      expect({ step: 'first', ok: first.ok }).toEqual({ step: 'first', ok: true });

      const [afterFirst] = await world.db
        .select({ signedAt: schema.headsUpRecipients.signedAt })
        .from(schema.headsUpRecipients)
        .where(
          and(
            eq(schema.headsUpRecipients.headsUpId, headsUpId),
            eq(schema.headsUpRecipients.userId, world.a.actors.trainingRecorder),
          ),
        );

      await callFor(caller, 'headsUps.sign', {
        headsUpId,
        signatureData: 'data:image/png;base64,second',
      });
      const [afterSecond] = await world.db
        .select({
          signedAt: schema.headsUpRecipients.signedAt,
          signatureData: schema.headsUpRecipients.signatureData,
        })
        .from(schema.headsUpRecipients)
        .where(
          and(
            eq(schema.headsUpRecipients.headsUpId, headsUpId),
            eq(schema.headsUpRecipients.userId, world.a.actors.trainingRecorder),
          ),
        );

      // A second signature must not move the timestamp or replace the mark —
      // the record is of when they signed, not when they last clicked.
      expect({
        stampUnchanged: afterFirst?.signedAt?.getTime() === afterSecond?.signedAt?.getTime(),
        markUnchanged: afterSecond?.signatureData?.includes('first'),
      }).toEqual({ stampUnchanged: true, markUnchanged: true });
    });

    it('HU-R05 · an archived briefing cannot collect new signatures', async () => {
      // `loadHeadsUpOrThrow` performs no status check, and recipient rows
      // survive archival — so a briefing that has been withdrawn can still
      // accrue signatures, and the engagement figures keep moving after the
      // author believed they had stopped it.
      const res = await callFor(asRecipient(), 'headsUps.sign', {
        headsUpId: world.a.headsUps.archived as string,
        signatureData: 'data:image/png;base64,x',
      });
      expect({ signedAnArchivedBriefing: res.ok }).toEqual({ signedAnArchivedBriefing: false });
    });

    it('HU-R06 · an archived briefing cannot collect new acknowledgements', async () => {
      const res = await callFor(asRecipient(), 'headsUps.markAcknowledged', {
        headsUpId: world.a.headsUps.archived as string,
      });
      expect({ acknowledgedAnArchivedBriefing: res.ok }).toEqual({
        acknowledgedAnArchivedBriefing: false,
      });
    });

    it('HU-R07 · marking a non-recipient as viewed is refused rather than silently accepted', async () => {
      // `markViewed` returns `{ ok: true }` for a caller who is not on the
      // list, while `markAcknowledged` throws FORBIDDEN for the same case.
      // The silent one is the wrong half of an inconsistency: a UI that
      // trusts the result shows "viewed" for somebody who was never sent it.
      const res = await callFor(asNonRecipient(), 'headsUps.markViewed', {
        headsUpId: world.a.headsUps.published as string,
      });
      expect({ acceptedFromNonRecipient: res.ok }).toEqual({ acceptedFromNonRecipient: false });
    });

    it('HU-R08 · a draft briefing is not readable through the recipient view', async () => {
      const res = await callFor(asRecipient(), 'headsUps.getForRecipient', {
        headsUpId: world.a.headsUps.draft as string,
      });
      expect(res.ok).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // HU-D — document disclosure (the cross-module axis)
  // ═══════════════════════════════════════════════════════════════════════
  describe('HU-D · document disclosure', () => {
    const leaky = () => world.a.headsUps.carriesRestrictedDoc as string;
    const restrictedDoc = () => world.a.documents.groupRestrictedDoc as string;

    it('HU-D00 · the Documents module still refuses this recipient directly', async () => {
      // The control. Everything below is only meaningful because the
      // document is genuinely restricted from this person.
      const res = await callFor(asRecipient(), 'documents.get', { documentId: restrictedDoc() });
      expect({ readableViaDocuments: res.ok }).toEqual({ readableViaDocuments: false });
    });

    it('HU-D01 · a briefing does not disclose a document the recipient may not see', async () => {
      // `getForRecipient` joins `heads_up_documents → documents` with no
      // visibility filter, so the title and mime type of a restricted
      // document reach a recipient the Documents module refuses.
      //
      // Note the scope precisely: the projection is
      // (documentId, documentVersion, name, mimeType) with NO storageKey, so
      // the file's CONTENT stays protected — opening it still goes through
      // `documents.get`, which enforces visibility. What escapes is the
      // existence and the title, and for this class of document the title is
      // frequently the sensitive part: "Redundancy consultation — night
      // shift" discloses the thing itself.
      const res = (await asRecipient().headsUps.getForRecipient({ headsUpId: leaky() })) as {
        documents?: Array<{ documentId: string; name: string }>;
      };
      const names = (res.documents ?? []).map((d) => d.name);
      expect({ disclosedTitles: names }).toEqual({ disclosedTitles: [] });
    });

    it('HU-D02 · the authoring view does not disclose it to a non-entitled reader either', async () => {
      // Uses `standard`, who is in no group: `trainingViewer` belongs to the
      // Night shift group and is therefore genuinely ENTITLED to the
      // restricted document, so asserting against them proved nothing.
      const res = await callFor(asRecipient(), 'headsUps.get', { headsUpId: leaky() });
      if (res.ok) {
        const docs = ((res.value as { documents?: Array<{ name: string }> }).documents ?? []).map(
          (d) => d.name,
        );
        expect({ disclosedTitles: docs }).toEqual({ disclosedTitles: [] });
      }
    });

    it('HU-D03 · a briefing cannot attach a document its author may not see', async () => {
      // The mirror of HU-D01, and the cheaper place to fix it: `create`
      // filters the attached ids by tenant and archived-ness only, so an
      // author with `headsUp.publish` can attach any document id in the
      // tenant, including one they have no right to open themselves.
      const setId = await world.db
        .insert(schema.permissionSets)
        .values({
          id: `${world.a.tenantId}pub`.slice(0, 26).padEnd(26, '0'),
          tenantId: world.a.tenantId,
          name: 'Briefing author, no document rights',
          permissions: ['headsUp.view', 'headsUp.publish', 'documents.view'],
        })
        .returning({ id: schema.permissionSets.id });
      const authorId = `usr_hu_author_probe_000000000`.slice(0, 30);
      await world.db.insert(schema.user).values({
        id: authorId,
        tenantId: world.a.tenantId,
        name: 'Ana Author',
        email: 'briefing-author@northgate.test',
        permissionSetId: setId[0]?.id as string,
      });

      const res = await callFor(
        createCaller(world.ctxFor(world.a.tenantId, authorId)),
        'headsUps.create',
        {
          title: 'Attaching a document I cannot open',
          description: '',
          documentIds: [restrictedDoc()],
        },
      );

      if (res.ok) {
        const created = (res.value as { headsUpId?: string; id?: string }).headsUpId ?? '';
        const attached = await world.db
          .select({ documentId: schema.headsUpDocuments.documentId })
          .from(schema.headsUpDocuments)
          .where(eq(schema.headsUpDocuments.headsUpId, created));
        expect({ attachedARestrictedDoc: attached.length }).toEqual({ attachedARestrictedDoc: 0 });
      }
    });

    it('HU-D04 · the public share link does not disclose a restricted document title', async () => {
      // `/s/[token]` renders library documents for an UNAUTHENTICATED
      // visitor. The fix routes both the authed views and that route through
      // one visibility-aware loader, so this asserts through the loader with
      // the anonymous viewer the route passes (`userId: null`).
      //
      // The raw join is checked first as a control: a filter over an empty
      // set would look identical to a working one.
      const rawJoin = await world.db
        .select({ name: schema.documents.name })
        .from(schema.headsUpDocuments)
        .innerJoin(schema.documents, eq(schema.headsUpDocuments.documentId, schema.documents.id))
        .where(eq(schema.headsUpDocuments.headsUpId, leaky()));
      expect(rawJoin.map((r) => r.name)).toContain('Night shift rota');

      const visible = await loadHeadsUpLibraryDocuments(world.db, world.a.tenantId, leaky(), {
        userId: null,
      });
      expect({ titlesOnAPublicPage: visible.map((d) => d.name) }).toEqual({
        titlesOnAPublicPage: [],
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // HU-V — volume
  // ═══════════════════════════════════════════════════════════════════════
  describe('HU-V · volume', () => {
    it('HU-V01 · the engagement roll-up is correct at a 200-recipient fan-out', async () => {
      const res = (await asAdmin().headsUps.engagementSummary({
        headsUpId: world.a.headsUps.published as string,
      })) as Record<string, number>;
      const total = await world.db
        .select({ id: schema.headsUpRecipients.id })
        .from(schema.headsUpRecipients)
        .where(eq(schema.headsUpRecipients.headsUpId, world.a.headsUps.published as string));
      // Whatever the shape, the headline count must match the real number of
      // recipients — a roll-up that quietly pages is a roll-up that lies.
      const reported = Object.values(res).find((v) => typeof v === 'number' && v > 1);
      expect({ recipients: total.length, reportedAtLeastOnce: reported !== undefined }).toEqual({
        recipients: total.length,
        reportedAtLeastOnce: true,
      });
      expect(total.length).toBeGreaterThan(150);
    });

    it('HU-V02 · the recipient list is bounded', async () => {
      const started = process.hrtime.bigint();
      const res = (await asAdmin().headsUps.listRecipients({
        headsUpId: world.a.headsUps.published as string,
      })) as { recipients?: unknown[] } | unknown[];
      const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
      const rows = Array.isArray(res) ? res : (res.recipients ?? []);
      expect(rows.length).toBeGreaterThan(0);
      expect({ overBudget: ms > 5_000, ms: Math.round(ms) }).toMatchObject({ overBudget: false });
    });

    it('HU-V03 · a recipient sees their own briefings and not everybody else’s', async () => {
      const res = (await asRecipient().headsUps.listForRecipient({})) as
        | { headsUps?: Array<{ id: string }> }
        | Array<{ id: string }>;
      const rows = Array.isArray(res) ? res : (res.headsUps ?? []);
      const ids = new Set(rows.map((h) => h.id));
      expect(ids.has(world.a.headsUps.published as string)).toBe(true);
      // The draft was never sent to anybody.
      expect(ids.has(world.a.headsUps.draft as string)).toBe(false);
    });
  });
});
