/**
 * Permits — audit fix verification (8 August 2026).
 *
 * The audit found four defects in the best-defended module in the series.
 * All four are in the two places a suite written from inside a module
 * systematically cannot reach: the joins outward, and the physical
 * register.
 *
 *   - PW-X03  HIGH. The competence gate was satisfied by a namesake. For a
 *             worker with no linked account the match was
 *             `personName.toLowerCase()`, so an untrained "john smith"
 *             passed on a ticket belonging to a different John Smith — and
 *             appeared in NO shortfall list, so the permit page showed him
 *             as competent.
 *   - PW-S01  HIGH. The same person could be logged into the entry
 *             register twice. Two open rows for one body: the board reads
 *             two inside when one is, and exiting one leaves the register
 *             claiming somebody is still in the space.
 *   - PW-X01  A method statement the issuer cannot open could be linked.
 *   - PW-X02  An ARCHIVED method statement could be cited as the safe
 *             system of work.
 *
 * On PW-X03 and the shape of these tests. The audit's own version of this
 * test was green for the wrong reason: `issue` did refuse, but with
 * `training-missing` for the *acceptor*, who had no ticket of his own. The
 * namesake sailed through and the assertion was satisfied by an unrelated
 * failure. So here the acceptor is made fully compliant first, and the
 * assertion is on the shortfall list naming the namesake — not on `issue`
 * throwing something.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
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
const silentLogger = () =>
  createLogger({ service: 'permits-audit', level: 'fatal', nodeEnv: 'test' });

const HOUR = 3_600_000;
const RESTRICTED_TITLE = 'Confined space method statement — night shift';

describe('permits — audit fixes (8 August 2026)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  /** The acceptor. Made fully compliant so he is never the blocker. */
  let acceptorId: string;
  /** The REAL John Smith — has an account and holds the ticket. */
  let realJohnId: string;
  /** Plans permits; holds `documents.view` and NOT `documents.manage`. */
  let plannerId: string;
  let siteA: string;
  let nightShiftId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@acme.test`, tenantId: tenantId as never },
    });
  }
  const callerFor = (userId: string) => createCaller(ctxFor(userId));

  function window(offsetHours = 0, lengthHours = 6) {
    const from = new Date(Date.now() + offsetHours * HOUR);
    return { validFrom: from, validTo: new Date(from.getTime() + lengthHours * HOUR) };
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db
      .insert(schema.tenants)
      .values({ id: tenantId, name: 'Acme', slug: `acme-${tenantId.slice(-8).toLowerCase()}` });
    const sets = await seedDefaultPermissionSets(db as unknown as Database, tenantId);

    // A permit planner who is not a document manager — the separation
    // PW-X01 turns on. `permits.create` plans; `documents.manage` is a
    // different authority entirely.
    const plannerSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: plannerSetId,
      tenantId,
      name: 'Permit planner',
      description: 'Plans permits; reads documents but does not manage them.',
      permissions: ['permits.view', 'permits.create', 'documents.view', 'sites.view'],
      isSystem: false,
    });

    adminId = `usr_${newId()}`;
    acceptorId = `usr_${newId()}`;
    realJohnId = `usr_${newId()}`;
    plannerId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Alice Admin',
        email: `alice-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: acceptorId,
        name: 'Sam Standard',
        email: `sam-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.standard,
      },
      {
        id: realJohnId,
        name: 'John Smith',
        email: `john-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.standard,
      },
      {
        id: plannerId,
        name: 'Pat Planner',
        email: `pat-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: plannerSetId,
      },
    ]);

    siteA = newId();
    await db.insert(schema.sites).values({ id: siteA, tenantId, name: 'Refinery' });

    nightShiftId = newId();
    await db
      .insert(schema.groups)
      .values({ id: nightShiftId, tenantId, name: 'Night shift', membershipMode: 'manual' });
  });

  afterEach(async () => {
    await client.close();
  });

  /** A requirement plus in-date records for the people named. */
  async function gatedType(): Promise<{ typeId: string; requirementId: string }> {
    const admin = callerFor(adminId);
    const { id: requirementId } = await admin.training.createRequirement({
      name: 'Confined space entry',
      validityMonths: 36,
    });
    const { typeId } = await admin.permits.types.create({
      category: 'confined_space',
      name: 'Confined space entry permit',
      maxDurationHours: 12,
      preconditions: [{ id: 'area_ready', label: 'Work area prepared' }],
      requiredTrainingIds: [requirementId],
    });
    return { typeId, requirementId };
  }

  async function giveTicket(requirementId: string, userId: string | null, personName: string) {
    await callerFor(adminId).training.addRecord({
      requirementId,
      userId,
      personName,
      achievedAt: new Date(Date.now() - 30 * 24 * HOUR).toISOString().slice(0, 10),
    });
  }

  async function draftPermit(typeId: string): Promise<string> {
    const { permitId } = await callerFor(adminId).permits.create({
      permitTypeId: typeId,
      title: 'Vessel entry',
      siteId: siteA,
      locationText: 'Tank 4',
      acceptorUserId: acceptorId,
      ...window(),
    });
    return permitId;
  }

  async function checkAll(permitId: string): Promise<void> {
    const admin = callerFor(adminId);
    const detail = await admin.permits.get({ permitId });
    for (const p of detail.preconditions) {
      await admin.permits.checkPrecondition({ permitId, preconditionId: p.id, checked: true });
    }
  }

  // ── PW-X03 — the competence gate ──────────────────────────────────────

  it('PW-X03: an unlinked namesake does not inherit the real John Smith’s ticket', async () => {
    const admin = callerFor(adminId);
    const { typeId, requirementId } = await gatedType();

    // The acceptor is fully compliant, so he can never be the blocker —
    // this is the exact trap the audit's own version of this test fell
    // into, where a green result came from an unrelated failure.
    await giveTicket(requirementId, acceptorId, 'Sam Standard');
    // The REAL John Smith holds the ticket, linked to his account.
    await giveTicket(requirementId, realJohnId, 'John Smith');

    const permitId = await draftPermit(typeId);
    // A DIFFERENT, untrained John Smith is typed onto the gang as free text.
    await admin.permits.setWorkers({
      permitId,
      workers: [{ name: 'john smith', userId: null, role: 'entrant' }],
    });

    // The permit page must NAME him. Before the fix he appeared in no
    // shortfall list at all, so the page showed him as competent.
    const detail = await admin.permits.get({ permitId });
    expect(detail.trainingShortfalls).toEqual([
      {
        personLabel: 'john smith',
        requirementId,
        requirementName: 'Confined space entry',
        reason: 'training-unverifiable-identity',
      },
    ]);

    // And issue refuses — for HIM, not for somebody else.
    await checkAll(permitId);
    await expect(
      admin.permits.issue({ permitId, acknowledgeConflicts: true }),
    ).rejects.toMatchObject({ message: 'training-unverifiable-identity' });
  });

  it('PW-X03: the gate is a gate — the real John Smith, linked, passes', async () => {
    const admin = callerFor(adminId);
    const { typeId, requirementId } = await gatedType();
    await giveTicket(requirementId, acceptorId, 'Sam Standard');
    await giveTicket(requirementId, realJohnId, 'John Smith');

    const permitId = await draftPermit(typeId);
    await admin.permits.setWorkers({
      permitId,
      workers: [{ name: 'John Smith', userId: realJohnId, role: 'entrant' }],
    });

    const detail = await admin.permits.get({ permitId });
    expect(detail.trainingShortfalls).toEqual([]);

    await checkAll(permitId);
    await expect(
      admin.permits.issue({ permitId, acknowledgeConflicts: true }),
    ).resolves.toBeDefined();
  });

  it('PW-X03: a type demanding no training still accepts a free-text gang', async () => {
    // The narrow fix: unlinked names stay available everywhere the gate is
    // not load-bearing, which is what the training module's design allows
    // for contractors with no account.
    const admin = callerFor(adminId);
    const { typeId } = await admin.permits.types.create({
      category: 'other',
      name: 'General high-risk',
      maxDurationHours: 12,
      preconditions: [{ id: 'area_ready', label: 'Work area prepared' }],
    });
    const permitId = await draftPermit(typeId);
    await admin.permits.setWorkers({
      permitId,
      workers: [{ name: 'Agency Andy', userId: null, role: 'worker' }],
    });

    const detail = await admin.permits.get({ permitId });
    expect(detail.trainingShortfalls).toEqual([]);
    await checkAll(permitId);
    await expect(
      admin.permits.issue({ permitId, acknowledgeConflicts: true }),
    ).resolves.toBeDefined();
  });

  it('PW-X03: preview parity holds — the page previews exactly what issue enforces', async () => {
    // RS-A11: a preview that says "ready" over a gate that refuses is
    // worse than no preview, because the issuer stops checking.
    const admin = callerFor(adminId);
    const { typeId, requirementId } = await gatedType();
    await giveTicket(requirementId, acceptorId, 'Sam Standard');
    const permitId = await draftPermit(typeId);
    await admin.permits.setWorkers({
      permitId,
      workers: [{ name: 'john smith', userId: null, role: 'entrant' }],
    });
    await checkAll(permitId);

    const previewed = (await admin.permits.get({ permitId })).trainingShortfalls;
    expect(previewed.length).toBeGreaterThan(0);
    const enforced = await admin.permits
      .issue({ permitId, acknowledgeConflicts: true })
      .then(() => null)
      .catch((e: { message: string }) => e.message);
    expect(previewed.map((s) => s.reason)).toContain(enforced);
  });

  // ── PW-S01 — the entry register ───────────────────────────────────────

  async function activeGatelessPermit(): Promise<string> {
    const admin = callerFor(adminId);
    const { typeId } = await admin.permits.types.create({
      category: 'other',
      name: 'General high-risk',
      maxDurationHours: 12,
      preconditions: [{ id: 'area_ready', label: 'Work area prepared' }],
    });
    const permitId = await draftPermit(typeId);
    await checkAll(permitId);
    await admin.permits.issue({ permitId, acknowledgeConflicts: true });
    await callerFor(acceptorId).permits.accept({ permitId });
    return permitId;
  }

  it('PW-S01: one body, one open row — a linked worker cannot be logged in twice', async () => {
    const admin = callerFor(adminId);
    const permitId = await activeGatelessPermit();
    await admin.permits.setWorkers({
      permitId,
      workers: [{ name: 'John Smith', userId: realJohnId, role: 'entrant' }],
    });
    const workerId = (await admin.permits.get({ permitId })).workers[0]?.id ?? '';

    await admin.permits.logEntry({ permitId, workerId });
    await expect(admin.permits.logEntry({ permitId, workerId })).rejects.toMatchObject({
      message: 'already-inside',
    });

    // The count the standby person reads, and the closure check enforces.
    const detail = await admin.permits.get({ permitId });
    expect(detail.insideCount).toBe(1);
    expect(detail.entryLog.filter((r) => r.exitedAt === null)).toHaveLength(1);
  });

  it('PW-S01: a free-text name cannot be double-logged either', async () => {
    const admin = callerFor(adminId);
    const permitId = await activeGatelessPermit();

    await admin.permits.logEntry({ permitId, name: 'Agency Andy' });
    // Case and padding must not be a way around it — the register is read
    // by a human counting bodies, not by a string comparator.
    await expect(
      admin.permits.logEntry({ permitId, name: '  agency andy ' }),
    ).rejects.toMatchObject({ message: 'already-inside' });
    expect((await admin.permits.get({ permitId })).insideCount).toBe(1);
  });

  it('PW-S01: exiting frees the person to re-enter, and closure unblocks', async () => {
    // The other half of the failure: a phantom open row used to leave
    // closure blocked by a count nobody could reconcile.
    const admin = callerFor(adminId);
    const permitId = await activeGatelessPermit();

    await admin.permits.logEntry({ permitId, name: 'Agency Andy' });
    const entryId = (await admin.permits.get({ permitId })).entryLog[0]?.id ?? '';
    await admin.permits.logExit({ permitId, entryId });
    expect((await admin.permits.get({ permitId })).insideCount).toBe(0);

    // Same person, second shift — a legitimate re-entry is still allowed.
    await expect(admin.permits.logEntry({ permitId, name: 'Agency Andy' })).resolves.toBeDefined();
    expect((await admin.permits.get({ permitId })).insideCount).toBe(1);

    const secondId = (await admin.permits.get({ permitId })).entryLog.find(
      (r) => r.exitedAt === null,
    )?.id;
    await admin.permits.logExit({ permitId, entryId: secondId ?? '' });
    await expect(
      admin.permits.close({
        permitId,
        checks: {
          workComplete: true,
          areaMadeSafe: true,
          isolationsRemoved: true,
          personnelClear: true,
        },
      }),
    ).resolves.toBeDefined();
  });

  // ── PW-X01 / PW-X02 — the method-statement loader ─────────────────────

  async function restrictedDocument(): Promise<string> {
    const admin = callerFor(adminId);
    const { documentId } = await admin.documents.create({
      name: RESTRICTED_TITLE,
      storageKey: `${tenantId}/documents/ms.pdf`,
      filename: 'ms.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    await db
      .update(schema.documents)
      .set({ visibleToGroupIds: [nightShiftId] })
      .where(eq(schema.documents.id, documentId));
    return documentId;
  }

  it('PW-X01: a method statement the issuer cannot open cannot be linked', async () => {
    const documentId = await restrictedDocument();
    const admin = callerFor(adminId);
    const { typeId } = await admin.permits.types.create({
      category: 'other',
      name: 'General high-risk',
      maxDurationHours: 12,
      preconditions: [],
    });

    // Control: Documents itself refuses this caller. The planner holds
    // `documents.view` and no `documents.manage`, and is in no group.
    await expect(callerFor(plannerId).documents.get({ documentId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // A permit planner without `documents.manage` cannot cite it, so its
    // name never reaches `permits.get` for every `permits.view` holder.
    await expect(
      callerFor(plannerId).permits.create({
        permitTypeId: typeId,
        title: 'Vessel entry',
        siteId: siteA,
        locationText: 'Tank 4',
        methodStatementDocumentId: documentId,
        ...window(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'document-not-visible' });

    // An admin holding `documents.manage` sees the whole library anyway.
    await expect(
      admin.permits.create({
        permitTypeId: typeId,
        title: 'Vessel entry',
        siteId: siteA,
        locationText: 'Tank 4',
        methodStatementDocumentId: documentId,
        ...window(),
      }),
    ).resolves.toBeDefined();
  });

  it('PW-X02: an archived method statement cannot be cited as the safe system of work', async () => {
    const admin = callerFor(adminId);
    const { documentId } = await admin.documents.create({
      name: 'Superseded method statement',
      storageKey: `${tenantId}/documents/old-ms.pdf`,
      filename: 'old-ms.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    const { typeId } = await admin.permits.types.create({
      category: 'other',
      name: 'General high-risk',
      maxDurationHours: 12,
      preconditions: [],
    });

    // While live, an admin can cite it.
    await expect(
      admin.permits.create({
        permitTypeId: typeId,
        title: 'Before withdrawal',
        siteId: siteA,
        locationText: 'Tank 4',
        methodStatementDocumentId: documentId,
        ...window(),
      }),
    ).resolves.toBeDefined();

    // Withdrawal is how the library says "do not work to this".
    await admin.documents.archive({ documentId });

    await expect(
      admin.permits.create({
        permitTypeId: typeId,
        title: 'After withdrawal',
        siteId: siteA,
        locationText: 'Tank 4',
        methodStatementDocumentId: documentId,
        ...window(),
      }),
    ).rejects.toMatchObject({ message: 'unknown-document' });
  });

  it('PW-X01 / PW-X02: update is guarded the same as create', async () => {
    // Two call sites share the loader; a fix applied to one only would be
    // the same defect one procedure over.
    const admin = callerFor(adminId);
    const documentId = await restrictedDocument();
    const { typeId } = await admin.permits.types.create({
      category: 'other',
      name: 'General high-risk',
      maxDurationHours: 12,
      preconditions: [],
    });
    const { permitId } = await callerFor(plannerId).permits.create({
      permitTypeId: typeId,
      title: 'Vessel entry',
      siteId: siteA,
      locationText: 'Tank 4',
      ...window(),
    });

    await expect(
      callerFor(plannerId).permits.update({ permitId, methodStatementDocumentId: documentId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'document-not-visible' });

    const archived = await admin.documents.create({
      name: 'Superseded',
      storageKey: `${tenantId}/documents/old.pdf`,
      filename: 'old.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    await admin.documents.archive({ documentId: archived.documentId });
    await expect(
      admin.permits.update({ permitId, methodStatementDocumentId: archived.documentId }),
    ).rejects.toMatchObject({ message: 'unknown-document' });
  });
});
