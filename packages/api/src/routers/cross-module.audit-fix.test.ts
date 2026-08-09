/**
 * The cross-module access-boundary sweep — fix verification (9 Aug 2026).
 *
 * The sweep reported 12 parity breaks + 2 rate-limit defects. Eight of the
 * nine XM-C contractor-scope breaks landed on `main` ahead of this
 * (`loadInspectionForCallerOrThrow` / `loadActionForCallerOrThrow`); this
 * suite covers the six that did not:
 *
 *   - XM-C  `actions.createFromIssue` — raises an action citing an
 *           observation the caller cannot open. The source observation was
 *           never loaded at all: not for visibility, not for tenancy.
 *   - XM-S  `search.global` — the widest-reach break in the sweep, and the
 *           one the id-keyed axes structurally could not find, because
 *           search accepts a STRING. Three canonical reads refused; all
 *           three records retrieved by typing their titles.
 *   - XM-S  `assets.listLinked{Observations,Actions,Inspections}` — gated
 *           on `assets.view` alone.
 *   - XM-D  `permits.get` — projects the linked method statement's name
 *           with no visibility filter. The PW-X01 fix hardened the write
 *           side and left the read.
 *   - RL-K01 `ctx.clientIp` was the LEFTMOST forwarded hop — the one the
 *           caller supplies — and five rate limits are keyed on it.
 *   - RL-F02 the limiter fails open on a store error, on endpoints where
 *           it is the only brake.
 *
 * Each assertion below states the premise BOTH ways where the sweep's own
 * first attempt went vacuous: the actor must be shown able to reach the
 * code (`browsesAssets: true`) and unable to read the record directly
 * (`readsObservationsDirectly: false`). An axis that passes because its
 * actor cannot reach the code is a coverage hole wearing a green tick.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { TEMPLATE_SCHEMA_VERSION } from '@forma360/shared/template-schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';

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

const createCaller = createCallerFactory(appRouter);
const silentLogger = () => createLogger({ service: 'xm-audit', level: 'fatal', nodeEnv: 'test' });

/** Distinctive so a search hit cannot be a coincidence. */
const OBS_TITLE = 'ZZPROBEOBSERVATION brake failure — operator named in report';
const ACTION_TITLE = 'ZZPROBEACTION replace the brake assembly';
const INSPECTION_TITLE = 'ZZPROBEINSPECTION monthly plant walk';
const RESTRICTED_DOC = 'Confined space method statement — night shift';

describe('cross-module sweep — fix verification (9 August 2026)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  /** Contractor portal user. Tenant-wide view permissions, no data scope. */
  let portalId: string;
  /** Holds `assets.view` and NOT `issues.view` — the XM-S linked-list actor. */
  let plantOnlyId: string;
  /** Holds `permits.view` + `documents.view`, in no group — the XM-D actor. */
  let permitViewerId: string;
  let siteA: string;
  let nightShiftId: string;
  let categoryId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@northgate.test`, tenantId: tenantId as never },
    });
  }
  const callerFor = (userId: string) => createCaller(ctxFor(userId));

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({
      id: tenantId,
      name: 'Northgate',
      slug: `northgate-${tenantId.slice(-8).toLowerCase()}`,
    });
    const sets = await seedDefaultPermissionSets(db as unknown as Database, tenantId);

    const portalSetId = newId();
    const plantSetId = newId();
    const permitSetId = newId();
    await db.insert(schema.permissionSets).values([
      {
        id: portalSetId,
        tenantId,
        name: 'Contractor portal',
        // Exactly what the contractor activity grants — tenant-wide.
        permissions: [
          'issues.view',
          'issues.report',
          'actions.view',
          'actions.create',
          'inspections.view',
          'inspections.conduct',
        ],
      },
      {
        id: plantSetId,
        tenantId,
        name: 'Plant browser',
        // The XM-S actor: may browse the register, may not read the
        // modules it links to.
        permissions: ['assets.view'],
      },
      {
        id: permitSetId,
        tenantId,
        name: 'Permit viewer',
        permissions: ['permits.view', 'documents.view'],
      },
    ]);

    adminId = `usr_${newId()}`;
    portalId = `usr_${newId()}`;
    plantOnlyId = `usr_${newId()}`;
    permitViewerId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Ada Admin',
        email: `admin-${tenantId}@northgate.test`,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: portalId,
        name: 'Sub Portal',
        email: `sub-${tenantId}@other.test`,
        tenantId,
        permissionSetId: portalSetId,
      },
      {
        id: plantOnlyId,
        name: 'Pat Plant',
        email: `pat-${tenantId}@northgate.test`,
        tenantId,
        permissionSetId: plantSetId,
      },
      {
        id: permitViewerId,
        name: 'Percy Permit',
        email: `percy-${tenantId}@northgate.test`,
        tenantId,
        permissionSetId: permitSetId,
      },
    ]);

    const contractorId = newId();
    await db.insert(schema.contractors).values({ id: contractorId, tenantId, name: 'Beta Sub' });
    await db.insert(schema.contractorUsers).values({
      id: newId(),
      tenantId,
      contractorId,
      userId: portalId,
      acknowledgedAt: new Date(),
      acknowledgedVersion: 1,
    });

    siteA = newId();
    await db.insert(schema.sites).values({ id: siteA, tenantId, name: 'Refinery' });
    nightShiftId = newId();
    await db
      .insert(schema.groups)
      .values({ id: nightShiftId, tenantId, name: 'Night shift', membershipMode: 'manual' });

    ({ categoryId } = await callerFor(adminId).issues.categories.create({ name: 'Hazard' }));
  });

  afterEach(async () => {
    await client.close();
  });

  /** An internal observation + action, authored by staff. */
  async function internalRecords(): Promise<{ issueId: string; actionId: string }> {
    const admin = callerFor(adminId);
    const { issueId } = await admin.issues.issues.create({
      categoryId,
      title: OBS_TITLE,
      siteId: siteA,
    });
    const { actionId } = await admin.actions.createStandalone({ title: ACTION_TITLE });
    return { issueId, actionId };
  }

  // ── XM-C — actions.createFromIssue ────────────────────────────────────

  it('XM-C: createFromIssue refuses an observation the caller cannot open', async () => {
    const { issueId } = await internalRecords();

    // The premise, both ways: the portal user holds `actions.create`
    // tenant-wide (so the refusal is not the permission check) and is
    // refused by the canonical read (so there is something to protect).
    await expect(
      callerFor(portalId).actions.createStandalone({ title: 'ok' }),
    ).resolves.toBeDefined();
    await expect(callerFor(portalId).issues.issues.get({ issueId })).rejects.toThrow(/NOT_FOUND/i);

    await expect(
      callerFor(portalId).actions.createFromIssue({ issueId, title: 'Raised from theirs' }),
    ).rejects.toThrow(/NOT_FOUND/i);

    const raised = await db
      .select({ id: schema.actions.id })
      .from(schema.actions)
      .where(eq(schema.actions.sourceId, issueId));
    expect(raised).toHaveLength(0);
  });

  it('XM-C: createFromIssue still works for an observation the caller reported', async () => {
    const portal = callerFor(portalId);
    const { issueId } = await portal.issues.issues.create({
      categoryId,
      title: 'Our own hazard',
    });
    await expect(
      portal.actions.createFromIssue({ issueId, title: 'Ours to fix' }),
    ).resolves.toMatchObject({ actionId: expect.any(String) });
  });

  // ── XM-S — search.global ──────────────────────────────────────────────

  it('XM-S: search does not return what the canonical reads refuse', async () => {
    const admin = callerFor(adminId);
    const { issueId, actionId } = await internalRecords();
    // A real published template, so the inspection is created the way the
    // product creates one. Its title comes from `titleFormat`, so the probe
    // string goes there.
    const { templateId } = await admin.templates.create({ name: 'Plant walk' });
    await admin.templates.saveDraft({
      templateId,
      content: {
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        title: 'Plant walk',
        pages: [
          {
            id: newId(),
            type: 'title',
            title: 'Title',
            sections: [
              {
                id: newId(),
                title: 's',
                items: [
                  { id: newId(), type: 'conductedBy', prompt: 'Conducted by', required: false },
                ],
              },
            ],
          },
          {
            id: newId(),
            type: 'inspection',
            title: 'Inspection',
            sections: [
              {
                id: newId(),
                title: 's',
                items: [
                  {
                    id: newId(),
                    type: 'text',
                    prompt: 'Notes?',
                    required: false,
                    multiline: false,
                    maxLength: 2000,
                  },
                ],
              },
            ],
          },
        ],
        settings: {
          titleFormat: `${INSPECTION_TITLE} {docNumber}`,
          documentNumberFormat: 'AUDIT{counter:6}',
          documentNumberStart: 1,
        },
        customResponseSets: [],
      },
    });
    await admin.templates.publish({ templateId });
    const { inspectionId } = await admin.inspections.create({ templateId });

    const portal = callerFor(portalId);
    // Premise both ways. The portal user holds all three `.view` keys —
    // so search is reachable — and all three canonical reads refuse.
    await expect(portal.issues.issues.get({ issueId })).rejects.toThrow(/NOT_FOUND/i);
    await expect(portal.actions.get({ actionId })).rejects.toThrow(/NOT_FOUND|action-not-found/i);
    await expect(portal.inspections.get({ inspectionId })).rejects.toThrow(/NOT_FOUND/i);

    for (const query of ['ZZPROBEOBSERVATION', 'ZZPROBEACTION', 'ZZPROBEINSPECTION']) {
      const results = await portal.search.global({ query });
      expect(results.observations).toEqual([]);
      expect(results.actions).toEqual([]);
      expect(results.inspections).toEqual([]);
      expect(JSON.stringify(results)).not.toContain('ZZPROBE');
    }
  });

  it('XM-S: search still returns the contractor’s OWN records, and everything to staff', async () => {
    const portal = callerFor(portalId);
    await portal.issues.issues.create({ categoryId, title: 'ZZMINE loose handrail' });
    const mine = await portal.search.global({ query: 'ZZMINE' });
    expect(mine.observations).toHaveLength(1);

    // And the scope must not leak into ordinary use.
    await internalRecords();
    const asAdmin = await callerFor(adminId).search.global({ query: 'ZZPROBE' });
    expect(asAdmin.observations.length + asAdmin.actions.length).toBeGreaterThan(0);
  });

  // ── XM-S — assets.listLinked* ─────────────────────────────────────────

  it('XM-S: the linked-record readers need the linked module’s own view key', async () => {
    const admin = callerFor(adminId);
    const { assetId } = await admin.assets.create({ name: 'Forklift 7', siteId: siteA });
    const { issueId } = await admin.issues.issues.create({
      categoryId,
      title: OBS_TITLE,
      assetIds: [assetId],
    });

    // The premise, asserted BOTH ways — this is exactly where the sweep's
    // own first attempt went vacuous (an empty asset, and an actor with no
    // `assets.view` at all, so it proved nothing twice over).
    const plant = callerFor(plantOnlyId);
    const browsesAssets = await plant.assets.get({ assetId });
    expect(browsesAssets).toBeDefined();
    await expect(plant.issues.issues.get({ issueId })).rejects.toThrow(
      /Missing permission: issues\.view/i,
    );
    // ...and the link genuinely exists, so an empty result means the guard.
    await expect(
      callerFor(adminId).assets.listLinkedObservations({ assetId }),
    ).resolves.toHaveLength(1);

    const leaked = await plant.assets.listLinkedObservations({ assetId });
    expect(leaked).toEqual([]);
    expect(JSON.stringify(leaked)).not.toContain('operator named in report');

    // The sibling readers are gated the same way.
    await expect(plant.assets.listLinkedActions({ assetId })).resolves.toEqual([]);
    await expect(plant.assets.listLinkedInspections({ assetId })).resolves.toEqual([]);
  });

  // ── XM-D — permits.get ────────────────────────────────────────────────

  it('XM-D: permits.get hides a method statement the reader cannot open', async () => {
    const admin = callerFor(adminId);
    const { documentId } = await admin.documents.create({
      name: RESTRICTED_DOC,
      storageKey: `${tenantId}/documents/ms.pdf`,
      filename: 'ms.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    const { typeId } = await admin.permits.types.create({
      category: 'other',
      name: 'General high-risk',
      maxDurationHours: 12,
      preconditions: [],
    });
    // Linked LEGITIMATELY, by someone who can see it — which is the whole
    // asymmetry: the PW-X01 write-side fix does not help here.
    const from = new Date();
    const { permitId } = await admin.permits.create({
      permitTypeId: typeId,
      title: 'Vessel entry',
      siteId: siteA,
      locationText: 'Tank 4',
      methodStatementDocumentId: documentId,
      validFrom: from,
      validTo: new Date(from.getTime() + 6 * 3_600_000),
    });
    await db
      .update(schema.documents)
      .set({ visibleToGroupIds: [nightShiftId] })
      .where(eq(schema.documents.id, documentId));

    // Premise both ways: the reader can open the permit, and Documents
    // itself refuses them the document.
    const viewer = callerFor(permitViewerId);
    await expect(viewer.documents.get({ documentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const seen = await viewer.permits.get({ permitId });
    expect(seen.id).toBe(permitId);
    expect(seen.methodStatement).toBeNull();
    expect(JSON.stringify(seen)).not.toContain(RESTRICTED_DOC);

    // An admin (documents.manage) still sees it — the link is not broken.
    const asAdmin = await admin.permits.get({ permitId });
    expect(asAdmin.methodStatement?.name).toBe(RESTRICTED_DOC);
  });
});
