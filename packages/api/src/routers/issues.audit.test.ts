/**
 * Observations module — the audit suite (FreeHS).
 *
 * (The router is `issues`; the product calls it Observations and the web
 * route is `/observations`. PF-12 already fixed one round of emails that
 * linked to `/issues`, a page which never existed.)
 *
 * Twelfth module through the runbook, and the only one with an
 * **unauthenticated write**. Every other public surface in the product is
 * a read: a RAMS pack served to a client, an inspection behind a share
 * link. Observations puts a QR code on a wall and lets whoever scans it
 * create a row inside a tenant with no account, no session and no
 * identity. That inverts the usual question. Elsewhere the risk is *what
 * can a stranger see*; here it is also *what can a stranger put in, and
 * what does the poster on the wall tell them before they do*.
 *
 * The second axis is the one this series keeps finding. Observations has a
 * genuine data-level access boundary that is not a permission: external
 * contractor portal users hold tenant-wide `issues.view` but must only see
 * observations their own company reported. `loadContractorScope` is the
 * mechanism, and PF-19 states plainly that *"every contractor-scoped read
 * runs through here"*. This suite takes that sentence literally — the
 * observation's comments, its timeline and its photographs are all reads.
 *
 * Five axes: OB-P (permissions), OB-Q (the anonymous QR path), OB-S
 * (contractor scoping), OB-X (cross-module), OB-T (tenancy).
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
import { createCallerFactory } from '../trpc';
import { bootWorld, type World } from './__fixtures__/world';

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

function issueProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('issues.'))
    .sort();
}

/**
 * The two `issues.*` procedures that are deliberately unauthenticated —
 * the QR landing page and the anonymous submission. Declared here so the
 * permission matrix can exempt exactly these two and nothing else: a third
 * public procedure appearing later fails OB-P01 rather than joining a
 * silent allowlist.
 */
const PUBLIC_BY_DESIGN = [
  'issues.categories.publicGetByShareToken',
  'issues.issues.createFromShareToken',
];

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

describe('observations (issues) — audit suite', () => {
  let world: World;
  let client: PGlite;
  /** Internal user: `issues.view` + `issues.report`. */
  let reporterId: string;
  /** External contractor portal user for contractor A — holds `issues.view`. */
  let portalUserId: string;
  /** A category with a live public share token. */
  let qrCategoryId: string;
  let qrToken: string;
  /** An observation reported by an INTERNAL user — invisible to the portal user. */
  let internalObservationId: string;

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asPortalUser = () => createCaller(world.ctxFor(world.a.tenantId, portalUserId));
  const asPublic = () => createCaller(world.publicCtx());

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

    reporterId = await mk('Obs reporter', ['issues.view', 'issues.report']);

    // An external contractor portal user: tenant-wide `issues.view` by
    // activity grant, but a `contractor_users` row that scopes what they
    // may actually see. Induction acknowledged, so the PF-19 gate is open
    // and the only thing left constraining them is the scope itself.
    portalUserId = await mk('Contractor portal user', ['issues.view']);
    const contractorId = world.a.contractorIds[0] ?? '';
    await world.db.insert(schema.contractorUsers).values({
      id: newId(),
      tenantId: world.a.tenantId,
      contractorId,
      userId: portalUserId,
      activities: ['observations'] as never,
      acknowledgedAt: world.now,
      acknowledgedVersion: 1,
    });

    const admin = asAdmin();
    const { categoryId } = await admin.issues.categories.create({
      name: `QR hazard reporting ${newId().slice(-6)}`,
    });
    qrCategoryId = categoryId;
    const generated = await admin.issues.categories.generateShareToken({ categoryId });
    qrToken = generated.token;

    // Reported by an internal user — nothing to do with the contractor.
    const internal = createCaller(world.ctxFor(world.a.tenantId, reporterId));
    const { issueId } = await internal.issues.issues.create({
      categoryId,
      title: 'Damaged handrail on the north stair',
      description: 'Top fixing has pulled out of the wall.',
    });
    internalObservationId = issueId;
    await internal.issues.comments.create({
      issueId,
      body: 'ZZOBSCOMMENT-internal-only-thread',
    });
    await world.db.insert(schema.issueAttachments).values({
      id: newId(),
      tenantId: world.a.tenantId,
      issueId,
      storageKey: `${world.a.tenantId}/issues/${issueId}/handrail.jpg`,
      filename: 'ZZOBSPHOTO-handrail.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      uploadedByUserId: reporterId,
    });
  }, 240_000);

  afterAll(async () => {
    await client.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // OB-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('OB-P · permissions', () => {
    it('OB-P00 · the matrix covers every issues procedure the router exposes', () => {
      const procs = issueProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(25);
      expect(procs).toContain('issues.issues.createFromShareToken');
      expect(procs).toContain('issues.categories.rotateShareToken');
    });

    it('OB-P01 · exactly two procedures are public, and the rest refuse a keyless caller', async () => {
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.nobody));
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of issueProcedures()) {
        if (PUBLIC_BY_DESIGN.includes(path)) continue;
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('OB-P02 · issues.settings gates the QR token, not issues.manage', async () => {
      // The share token IS the public write capability. Minting one is a
      // decision about exposing the tenant to anonymous input, which is a
      // settings act — not something a day-to-day observation manager
      // should be able to do while triaging.
      const manager = createCaller(world.ctxFor(world.a.tenantId, reporterId));
      for (const path of [
        'issues.categories.generateShareToken',
        'issues.categories.rotateShareToken',
        'issues.categories.revokeShareToken',
      ]) {
        const res = await callFor(manager, path, { categoryId: qrCategoryId });
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // OB-Q — the anonymous QR path
  // ═══════════════════════════════════════════════════════════════════════
  describe('OB-Q · the anonymous QR path', () => {
    it('OB-Q01 · a stranger with the token can file an observation and nothing else', async () => {
      const res = await asPublic().issues.issues.createFromShareToken({
        token: qrToken,
        tenantId: world.a.tenantId,
        title: 'Spill by the loading bay door',
      });
      expect({ filed: typeof res.issueId === 'string' }).toEqual({ filed: true });

      const [row] = await world.db
        .select({
          reportedByUserId: schema.issues.reportedByUserId,
          reportedByName: schema.issues.reportedByName,
          reportedVia: schema.issues.reportedVia,
          status: schema.issues.status,
        })
        .from(schema.issues)
        .where(eq(schema.issues.id, res.issueId));
      expect(row).toEqual({
        reportedByUserId: null,
        reportedByName: 'Anonymous (QR)',
        reportedVia: 'qr',
        status: 'open',
      });

      // The same stranger cannot read anything back.
      for (const [path, input] of [
        ['issues.issues.list', {}],
        ['issues.issues.get', { issueId: res.issueId }],
        ['issues.comments.list', { issueId: res.issueId }],
        ['issues.attachments.list', { issueId: res.issueId }],
      ] as Array<[string, unknown]>) {
        const read = await callFor(asPublic(), path, input);
        expect({ path, ok: read.ok }).toEqual({ path, ok: false });
      }
    });

    it('OB-Q02 · the poster only ships the site register when the form asks for a site', async () => {
      // The QR landing page renders whatever `publicGetByShareToken`
      // returns, to anyone who scans a code that may be in a public
      // reception. Sites ARE needed when the category shows a site picker
      // — `site` is on by default — but a category that has turned the
      // picker off has no business shipping the tenant's site register to
      // the street.
      const admin = asAdmin();
      const { categoryId } = await admin.issues.categories.create({
        name: `No-site QR ${newId().slice(-6)}`,
      });
      // `enabledBuiltInFields` is settable on update, not create.
      await admin.issues.categories.update({
        categoryId,
        enabledBuiltInFields: ['description', 'media'],
      });
      const { token } = await admin.issues.categories.generateShareToken({ categoryId });

      const withoutPicker = await asPublic().issues.categories.publicGetByShareToken({ token });
      const withPicker = await asPublic().issues.categories.publicGetByShareToken({
        token: qrToken,
      });

      expect({
        sitesWhenPickerOff: withoutPicker?.sites.length,
        sitesWhenPickerOn: (withPicker?.sites.length ?? 0) > 0,
      }).toEqual({ sitesWhenPickerOff: 0, sitesWhenPickerOn: true });
    });

    it('OB-Q03 · a token from one tenant cannot be pointed at another', async () => {
      const res = await callFor(asPublic(), 'issues.issues.createFromShareToken', {
        token: qrToken,
        tenantId: world.b.tenantId,
        title: 'Cross-tenant QR probe',
      });
      expect({ acceptedForeignTenant: res.ok }).toEqual({ acceptedForeignTenant: false });
    });

    it('OB-Q04 · an anonymous submission cannot attach another tenant objects, or non-images', async () => {
      for (const [label, media] of [
        [
          'foreign-tenant key',
          [
            {
              key: `${world.b.tenantId}/issues/x/photo.jpg`,
              filename: 'photo.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 1024,
            },
          ],
        ],
        [
          'active content',
          [
            {
              key: `${world.a.tenantId}/issues/x/payload.html`,
              filename: 'payload.html',
              mimeType: 'text/html',
              sizeBytes: 1024,
            },
          ],
        ],
      ] as Array<[string, unknown]>) {
        const res = await callFor(asPublic(), 'issues.issues.createFromShareToken', {
          token: qrToken,
          tenantId: world.a.tenantId,
          title: `Media probe — ${label}`,
          media,
        });
        expect({ label, accepted: res.ok }).toEqual({ label, accepted: false });
      }
    });

    it('OB-Q05 · revoking the token closes both the read and the write', async () => {
      const admin = asAdmin();
      const { categoryId } = await admin.issues.categories.create({
        name: `Revocation probe ${newId().slice(-6)}`,
      });
      const { token } = await admin.issues.categories.generateShareToken({ categoryId });
      await admin.issues.categories.revokeShareToken({ categoryId });

      const config = await asPublic().issues.categories.publicGetByShareToken({ token });
      const write = await callFor(asPublic(), 'issues.issues.createFromShareToken', {
        token,
        tenantId: world.a.tenantId,
        title: 'Submission on a revoked token',
      });
      expect({ configAfterRevoke: config, writeAfterRevoke: write.ok }).toEqual({
        configAfterRevoke: null,
        writeAfterRevoke: false,
      });
    });

    it('OB-Q06 · rotating the token invalidates the printed one', async () => {
      const admin = asAdmin();
      const { categoryId } = await admin.issues.categories.create({
        name: `Rotation probe ${newId().slice(-6)}`,
      });
      const { token: original } = await admin.issues.categories.generateShareToken({ categoryId });
      const { token: rotated } = await admin.issues.categories.rotateShareToken({ categoryId });

      const oldWrite = await callFor(asPublic(), 'issues.issues.createFromShareToken', {
        token: original,
        tenantId: world.a.tenantId,
        title: 'Submission on the superseded token',
      });
      const newWrite = await callFor(asPublic(), 'issues.issues.createFromShareToken', {
        token: rotated,
        tenantId: world.a.tenantId,
        title: 'Submission on the current token',
      });
      expect({
        tokenChanged: original !== rotated,
        supersededTokenAccepted: oldWrite.ok,
        currentTokenAccepted: newWrite.ok,
      }).toEqual({
        tokenChanged: true,
        supersededTokenAccepted: false,
        currentTokenAccepted: true,
      });
    });

    it('OB-Q07 · the URL handed out for the QR code resolves to the reporting page', async () => {
      // `generateShareToken` returns `url` for whoever prints the code.
      // The unauthenticated landing page is `/scan/<token>`; `/report` is
      // a completely different, LOCALISED, signed-in page — the
      // harmed/not-harmed chooser — and it carries no `[token]` segment,
      // so the URL the router hands out does not resolve at all.
      //
      // Nothing prints it today: the QR page builds its own
      // `origin + /scan/{token}` and ignores this field. That makes it a
      // loaded trap rather than a live outage — the second consumer to
      // trust the router's own answer prints a dead QR code onto a wall.
      const admin = asAdmin();
      const { categoryId } = await admin.issues.categories.create({
        name: `URL probe ${newId().slice(-6)}`,
      });
      const { token, url } = await admin.issues.categories.generateShareToken({ categoryId });
      expect({ path: new URL(url).pathname }).toEqual({ path: `/scan/${token}` });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // OB-S — contractor scoping
  // ═══════════════════════════════════════════════════════════════════════
  describe('OB-S · contractor scoping', () => {
    it('OB-S00 · control · the portal user cannot open the internal observation', async () => {
      // Establishes the boundary the next three tests probe around. Without
      // it they could pass because there was no boundary in the first place.
      const res = await callFor(asPortalUser(), 'issues.issues.get', {
        issueId: internalObservationId,
      });
      expect({ portalUserOpenedIt: res.ok }).toEqual({ portalUserOpenedIt: false });

      const list = await asPortalUser().issues.issues.list({});
      expect({
        internalObservationInList: list.items.some((i) => i.id === internalObservationId),
      }).toEqual({ internalObservationInList: false });
    });

    it('OB-S01 · the comment thread is scoped like the observation it belongs to', async () => {
      // `loadContractorScope` is called in exactly two places in this
      // router — `list` and `get`. `comments.list` resolves the issue by
      // tenant and id only, so the door that `get` closes is open one
      // level down.
      const res = await callFor(asPortalUser(), 'issues.comments.list', {
        issueId: internalObservationId,
      });
      const leaked = res.ok && serialise(res.value).includes('ZZOBSCOMMENT');
      expect({ commentThreadLeaked: leaked }).toEqual({ commentThreadLeaked: false });
    });

    it('OB-S02 · the timeline is scoped, and does not hand over internal names and emails', async () => {
      // `activity.list` left-joins `user` and selects `actorName` AND
      // `actorEmail`. An external contractor reading it gets the staff
      // directory for that thread as well as the history.
      const res = await callFor(asPortalUser(), 'issues.activity.list', {
        issueId: internalObservationId,
      });
      expect({ timelineLeaked: res.ok }).toEqual({ timelineLeaked: false });
    });

    it('OB-S03 · the photographs are scoped — this is the one that hands over content', async () => {
      // `attachments.list` mints a signed download URL per row. Unscoped,
      // it gives an external contractor working links to another
      // company's site photography, which is the only place in this
      // module where the leak is the file rather than the metadata.
      const res = await callFor(asPortalUser(), 'issues.attachments.list', {
        issueId: internalObservationId,
      });
      const leaked = res.ok && serialise(res.value).includes('ZZOBSPHOTO');
      expect({ photosLeaked: leaked }).toEqual({ photosLeaked: false });
    });

    it('OB-S04 · a portal user cannot post into an internal observation thread', async () => {
      // `comments.create` is gated on `issues.view`, which the portal user
      // holds tenant-wide. Reading someone else's thread is a disclosure;
      // writing into it puts an outside company's words in an internal
      // record.
      const res = await callFor(asPortalUser(), 'issues.comments.create', {
        issueId: internalObservationId,
        body: 'Posted from outside the boundary.',
      });
      expect({ postedIntoInternalThread: res.ok }).toEqual({ postedIntoInternalThread: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // OB-X — cross-module
  // ═══════════════════════════════════════════════════════════════════════
  describe('OB-X · cross-module', () => {
    it('OB-X01 · promoting an observation to an incident links both ways', async () => {
      const admin = asAdmin();
      const { issueId } = await admin.issues.issues.create({
        categoryId: qrCategoryId,
        title: 'Near miss with a reversing FLT',
        description: 'Driver did not see the pedestrian crossing behind him.',
      });
      const { incidentId } = await admin.incidents.createFromObservation({
        observationId: issueId,
        kind: 'near_miss',
      });

      // The incident carries the observation id as a column; the
      // observation carries the incident on its activity timeline, which is
      // what its page renders.
      const [incidentRow] = await world.db
        .select({ fromObservation: schema.incidents.observationId })
        .from(schema.incidents)
        .where(eq(schema.incidents.id, incidentId));
      const activity = await world.db
        .select({ kind: schema.issueActivity.kind, payload: schema.issueActivity.payload })
        .from(schema.issueActivity)
        .where(eq(schema.issueActivity.issueId, issueId));
      const escalation = activity.find((a) => a.kind === 'escalated_to_incident');

      expect({
        incidentPointsAtObservation: incidentRow?.fromObservation === issueId,
        observationTimelineNamesTheIncident: serialise(escalation?.payload).includes(incidentId),
      }).toEqual({
        incidentPointsAtObservation: true,
        observationTimelineNamesTheIncident: true,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // OB-T — tenancy
  // ═══════════════════════════════════════════════════════════════════════
  describe('OB-T · tenancy', () => {
    it('OB-T01 · no issues procedure reaches another tenant observation', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { categoryId: foreignCategory } = await otherAdmin.issues.categories.create({
        name: 'Foreign category',
      });
      const { issueId: foreignIssue } = await otherAdmin.issues.issues.create({
        categoryId: foreignCategory,
        title: 'ZZFOREIGNOBSERVATION-do-not-disclose',
      });

      const reached: string[] = [];
      for (const path of issueProcedures()) {
        if (PUBLIC_BY_DESIGN.includes(path)) continue;
        const res = await callFor(asAdmin(), path, {
          issueId: foreignIssue,
          categoryId: foreignCategory,
        });
        if (res.ok && serialise(res.value).includes('ZZFOREIGNOBSERVATION')) reached.push(path);
      }
      expect(reached).toEqual([]);

      const [row] = await world.db
        .select({ title: schema.issues.title, archivedAt: schema.issues.archivedAt })
        .from(schema.issues)
        .where(eq(schema.issues.id, foreignIssue));
      expect({ title: row?.title, archivedAt: row?.archivedAt }).toEqual({
        title: 'ZZFOREIGNOBSERVATION-do-not-disclose',
        archivedAt: null,
      });
    });

    it('OB-T02 · an observation cannot be filed against another tenant site or category', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { categoryId: foreignCategory } = await otherAdmin.issues.categories.create({
        name: 'Foreign category for filing',
      });

      const foreignCat = await callFor(asAdmin(), 'issues.issues.create', {
        categoryId: foreignCategory,
        title: 'Cross-tenant category probe',
      });
      expect({ filedAgainstForeignCategory: foreignCat.ok }).toEqual({
        filedAgainstForeignCategory: false,
      });

      const foreignSite = await callFor(asAdmin(), 'issues.issues.create', {
        categoryId: qrCategoryId,
        title: 'Cross-tenant site probe',
        siteId: world.b.sites.primary,
      });
      expect({ filedAtForeignSite: foreignSite.ok }).toEqual({ filedAtForeignSite: false });
    });
  });
});
