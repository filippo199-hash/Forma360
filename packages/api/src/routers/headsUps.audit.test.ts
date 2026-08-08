/**
 * Heads-Up / Briefings — audit fix verification (8 August 2026).
 *
 * The audit found seven defects in two clusters. These tests prove each is
 * fixed and stays fixed. Every one of them fails on the pre-fix code.
 *
 * The document boundary — four defects, one root cause. The
 * `heads_up_documents → documents` join was never visibility-aware, so a
 * briefing disclosed an attached document's existence and title to readers
 * Documents itself would refuse. The projection carries no `storageKey`, so
 * the file's content was never exposed; what escaped was metadata, and for
 * this class of document the title is frequently the sensitive part.
 *
 *   - HU-D00  control: `documents.get` refuses the outsider outright, so the
 *             fixture is a real restriction and not a mislabelled actor.
 *   - HU-D01  `getForRecipient` no longer hands a restricted document's title
 *             to a recipient in no group.
 *   - HU-D02  `get` no longer does the same for any `headsUp.view` holder —
 *             a key every employee holds, because everybody gets briefings.
 *   - HU-D03  `create` refuses an author attaching a document they cannot
 *             open, so the disclosure is never created in the first place.
 *   - HU-D04  the public share link, which has no viewer at all, renders
 *             only genuinely unrestricted documents.
 *
 * The engagement record — three defects.
 *
 *   - HU-R05  an archived briefing no longer collects signatures.
 *   - HU-R06  nor acknowledgements.
 *   - HU-R07  `markViewed` refuses a non-recipient, matching its sibling
 *             `markAcknowledged`, instead of answering `{ ok: true }`.
 *
 * On the fixture: the audit's own most useful lesson was that three times a
 * named actor did not mean what its name said, and two of the seven findings
 * were hidden behind that. So every actor here is asserted to be what it
 * claims — the outsider really holds `headsUp.view`, the recipient really is
 * a recipient — before anything is concluded from a refusal.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { and, eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
import { loadHeadsUpLibraryDocuments } from '../heads-up-documents';
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
  createLogger({ service: 'headsup-audit', level: 'fatal', nodeEnv: 'test' });

/** The title is the payload: this is what must not escape. */
const RESTRICTED_TITLE = 'Redundancy consultation — night shift';
const OPEN_TITLE = 'Fire evacuation plan';

describe('heads-ups — audit fixes (8 August 2026)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let nightShiftId: string;

  /** Administrator. Holds `documents.manage`, so sees the whole library. */
  let adminId: string;
  /** Publishes briefings; holds no `documents.manage`; in no group. */
  let authorId: string;
  /** In the Night shift group — entitled to the restricted document. */
  let nightWorkerId: string;
  /** In no group — a briefing recipient, but not entitled to the document. */
  let dayWorkerId: string;
  /** In no group and on no briefing — the non-recipient. */
  let outsiderId: string;

  let restrictedDocId: string;
  let openDocId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@northgate.test`, tenantId: tenantId as never },
    });
  }
  const callerFor = (userId: string) => createCaller(ctxFor(userId));

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());

    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Northgate', slug: 'northgate' });
    const sets = await seedDefaultPermissionSets(db as unknown as Database, tenantId);

    // A briefing author who is NOT a document manager. This separation is the
    // whole point of HU-D03: the person who composes briefings is routinely
    // not the person entrusted with the document library.
    const authorSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: authorSetId,
      tenantId,
      name: 'Briefing author',
      description: 'Publishes briefings; reads documents but does not manage them.',
      permissions: [
        'headsUp.view',
        'headsUp.publish',
        'headsUp.manage',
        'headsUp.analytics.view',
        'documents.view',
      ],
      isSystem: false,
    });

    adminId = newId();
    authorId = newId();
    nightWorkerId = newId();
    dayWorkerId = newId();
    outsiderId = newId();
    await db.insert(schema.user).values([
      {
        id: adminId,
        tenantId,
        name: 'Priya Nair',
        email: 'priya@northgate.test',
        permissionSetId: sets.administrator,
      },
      {
        id: authorId,
        tenantId,
        name: 'Tom Beckett',
        email: 'tom@northgate.test',
        permissionSetId: authorSetId,
      },
      {
        id: nightWorkerId,
        tenantId,
        name: 'Ola Sinclair',
        email: 'ola@northgate.test',
        permissionSetId: sets.standard,
      },
      {
        id: dayWorkerId,
        tenantId,
        name: 'Dev Rao',
        email: 'dev@northgate.test',
        permissionSetId: sets.standard,
      },
      {
        id: outsiderId,
        tenantId,
        name: 'Sam Okafor',
        email: 'sam@northgate.test',
        permissionSetId: sets.standard,
      },
    ]);

    nightShiftId = newId();
    await db
      .insert(schema.groups)
      .values({ id: nightShiftId, tenantId, name: 'Night shift', membershipMode: 'manual' });
    await db
      .insert(schema.groupMembers)
      .values({ tenantId, groupId: nightShiftId, userId: nightWorkerId });

    // Two library documents: one restricted to the night shift, one open.
    const adminCaller = callerFor(adminId);
    ({ documentId: restrictedDocId } = await adminCaller.documents.create({
      name: RESTRICTED_TITLE,
      storageKey: `${tenantId}/documents/redundancy.pdf`,
      filename: 'redundancy.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    }));
    ({ documentId: openDocId } = await adminCaller.documents.create({
      name: OPEN_TITLE,
      storageKey: `${tenantId}/documents/evacuation.pdf`,
      filename: 'evacuation.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    }));
    await db
      .update(schema.documents)
      .set({ visibleToGroupIds: [nightShiftId] })
      .where(eq(schema.documents.id, restrictedDocId));
  });

  afterEach(async () => {
    await client.close();
  });

  // ── Fixture integrity ─────────────────────────────────────────────────
  // The audit's own lesson: a passing test is evidence only if you know why
  // it passes. Everything below concludes something from a refusal, so first
  // prove the refusal cannot be coming from the permission check.

  it('fixture: every non-admin actor really holds headsUp.view', async () => {
    for (const id of [authorId, nightWorkerId, dayWorkerId, outsiderId]) {
      // Throws FORBIDDEN if the caller lacks `headsUp.view`; returns [] if
      // they simply have no briefings. Reaching a value proves the key.
      await expect(callerFor(id).headsUps.listForRecipient()).resolves.toEqual([]);
    }
  });

  it('fixture: the author holds documents.view but not documents.manage', async () => {
    // documents.list is gated on `documents.view` — reaching a value proves it.
    await expect(callerFor(authorId).documents.list({})).resolves.toBeDefined();
    // documents.create is gated on `documents.manage` — this must refuse.
    await expect(
      callerFor(authorId).documents.create({
        name: 'Nope',
        storageKey: `${tenantId}/documents/nope.pdf`,
        filename: 'nope.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // ── The document boundary ─────────────────────────────────────────────

  it('HU-D00 (control): documents.get refuses the restricted document to a non-member', async () => {
    await expect(
      callerFor(dayWorkerId).documents.get({ documentId: restrictedDocId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // And admits the night-shift member, so the restriction is a real
    // group rule rather than a blanket refusal.
    await expect(
      callerFor(nightWorkerId).documents.get({ documentId: restrictedDocId }),
    ).resolves.toBeDefined();
  });

  it('HU-D01: getForRecipient hides a document the recipient may not see', async () => {
    const admin = callerFor(adminId);
    const { headsUpId } = await admin.headsUps.create({
      title: 'Shift changes',
      documentIds: [restrictedDocId, openDocId],
    });
    await admin.headsUps.publish({ headsUpId, userIds: [dayWorkerId, nightWorkerId] });

    // The outsider-to-the-group recipient sees only the open document.
    const asDayWorker = await callerFor(dayWorkerId).headsUps.getForRecipient({ headsUpId });
    expect(asDayWorker.documents.map((d) => d.name)).toEqual([OPEN_TITLE]);
    expect(JSON.stringify(asDayWorker)).not.toContain(RESTRICTED_TITLE);

    // The night-shift member still sees both — the fix filters, it does not
    // blanket-hide, so the feature still works for the people it is for.
    const asNightWorker = await callerFor(nightWorkerId).headsUps.getForRecipient({ headsUpId });
    expect(asNightWorker.documents.map((d) => d.name).sort()).toEqual(
      [OPEN_TITLE, RESTRICTED_TITLE].sort(),
    );
  });

  it('HU-D02: get hides it from an ordinary headsUp.view holder, but not from a manager', async () => {
    const admin = callerFor(adminId);
    const { headsUpId } = await admin.headsUps.create({
      title: 'Shift changes',
      documentIds: [restrictedDocId, openDocId],
    });
    await admin.headsUps.publish({ headsUpId, userIds: [dayWorkerId] });

    // Every employee holds `headsUp.view`, so `get` is effectively public
    // inside the tenant. It must not be a side door into the library.
    const asDayWorker = await callerFor(dayWorkerId).headsUps.get({ headsUpId });
    expect(asDayWorker.documents.map((d) => d.name)).toEqual([OPEN_TITLE]);
    expect(JSON.stringify(asDayWorker)).not.toContain(RESTRICTED_TITLE);

    // A `documents.manage` holder sees the whole library anyway — hiding it
    // here would only misrepresent the briefing to the person maintaining it.
    const asAdmin = await admin.headsUps.get({ headsUpId });
    expect(asAdmin.documents.map((d) => d.name).sort()).toEqual(
      [OPEN_TITLE, RESTRICTED_TITLE].sort(),
    );
  });

  it('HU-D03: create refuses an author attaching a document they cannot open', async () => {
    const author = callerFor(authorId);

    await expect(
      author.headsUps.create({ title: 'Leaky briefing', documentIds: [restrictedDocId] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'document-not-visible' });

    // The refusal happens before anything is written: no orphaned draft.
    const drafts = await db
      .select({ id: schema.headsUps.id })
      .from(schema.headsUps)
      .where(eq(schema.headsUps.tenantId, tenantId));
    expect(drafts).toHaveLength(0);

    // A document the author CAN see still attaches, and a mixed request is
    // refused whole rather than silently dropping the restricted half.
    await expect(
      author.headsUps.create({ title: 'Mixed', documentIds: [openDocId, restrictedDocId] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const { headsUpId } = await author.headsUps.create({
      title: 'Fine briefing',
      documentIds: [openDocId],
    });
    const rows = await db
      .select({ documentId: schema.headsUpDocuments.documentId })
      .from(schema.headsUpDocuments)
      .where(eq(schema.headsUpDocuments.headsUpId, headsUpId));
    expect(rows.map((r) => r.documentId)).toEqual([openDocId]);
  });

  it('HU-D04: the public share link renders only unrestricted documents', async () => {
    const admin = callerFor(adminId);
    const { headsUpId } = await admin.headsUps.create({
      title: 'Shift changes',
      documentIds: [restrictedDocId, openDocId],
    });
    await admin.headsUps.publish({ headsUpId, userIds: [dayWorkerId] });
    await admin.headsUps.createShareLink({ headsUpId });

    // Control: the raw join the route used to run — the exact shape of the
    // pre-fix query — does carry the restricted title. Without this, a
    // filter over an empty set would look identical to a working one.
    const rawJoin = await db
      .select({ name: schema.documents.name })
      .from(schema.headsUpDocuments)
      .innerJoin(schema.documents, eq(schema.headsUpDocuments.documentId, schema.documents.id))
      .where(eq(schema.headsUpDocuments.headsUpId, headsUpId));
    expect(rawJoin.map((r) => r.name).sort()).toEqual([OPEN_TITLE, RESTRICTED_TITLE].sort());

    // `userId: null` is the anonymous viewer the /s/[token] route passes:
    // in nobody's group, on nobody's site, holding no grant.
    const publicDocs = await loadHeadsUpLibraryDocuments(db, tenantId, headsUpId, {
      userId: null,
    });
    expect(publicDocs.map((d) => d.name)).toEqual([OPEN_TITLE]);

    // Restricting the open document AFTER the link was minted takes effect
    // immediately — the filter runs per render, not at mint time.
    await db
      .update(schema.documents)
      .set({ visibleToGroupIds: [nightShiftId] })
      .where(eq(schema.documents.id, openDocId));
    await expect(
      loadHeadsUpLibraryDocuments(db, tenantId, headsUpId, { userId: null }),
    ).resolves.toEqual([]);
  });

  it('HU-D04: a folder restriction on the ancestor is honoured for the public viewer', async () => {
    const admin = callerFor(adminId);
    const { folderId } = await admin.documentFolders.create({
      name: 'HR confidential',
      visibleToGroupIds: [nightShiftId],
    });
    // The document itself carries no restriction — only its folder does.
    await db
      .update(schema.documents)
      .set({ folderId, visibleToGroupIds: [] })
      .where(eq(schema.documents.id, openDocId));

    const { headsUpId } = await admin.headsUps.create({
      title: 'Filed under HR',
      documentIds: [openDocId],
    });
    await admin.headsUps.publish({ headsUpId, userIds: [dayWorkerId] });

    await expect(
      loadHeadsUpLibraryDocuments(db, tenantId, headsUpId, { userId: null }),
    ).resolves.toEqual([]);
  });

  // ── The engagement record ─────────────────────────────────────────────

  it('HU-R05: an archived briefing no longer collects signatures', async () => {
    const admin = callerFor(adminId);
    const { headsUpId } = await admin.headsUps.create({
      title: 'Sign this',
      engagementLevel: 'sign',
      requireAcknowledgement: true,
      requireSignature: true,
    });
    await admin.headsUps.publish({ headsUpId, userIds: [dayWorkerId] });

    const recipient = callerFor(dayWorkerId);
    await recipient.headsUps.markAcknowledged({ headsUpId });

    // The author withdraws the briefing.
    await admin.headsUps.archive({ headsUpId });

    await expect(
      recipient.headsUps.sign({ headsUpId, signatureData: 'forged-after-withdrawal' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'heads-up-archived' });

    const [row] = await db
      .select({ signedAt: schema.headsUpRecipients.signedAt })
      .from(schema.headsUpRecipients)
      .where(
        and(
          eq(schema.headsUpRecipients.headsUpId, headsUpId),
          eq(schema.headsUpRecipients.userId, dayWorkerId),
        ),
      );
    expect(row?.signedAt).toBeNull();
  });

  it('HU-R06: an archived briefing no longer collects acknowledgements or views', async () => {
    const admin = callerFor(adminId);
    const { headsUpId } = await admin.headsUps.create({
      title: 'Acknowledge this',
      engagementLevel: 'acknowledge',
      requireAcknowledgement: true,
    });
    await admin.headsUps.publish({ headsUpId, userIds: [dayWorkerId] });
    await admin.headsUps.archive({ headsUpId });

    const recipient = callerFor(dayWorkerId);
    await expect(recipient.headsUps.markAcknowledged({ headsUpId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'heads-up-archived',
    });
    await expect(recipient.headsUps.markViewed({ headsUpId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'heads-up-archived',
    });

    // The engagement figures stayed where the author left them.
    const summary = await admin.headsUps.engagementSummary({ headsUpId });
    expect(summary.acknowledged).toBe(0);
    expect(summary.viewed).toBe(0);
  });

  it('HU-R06: a draft briefing collects nothing either', async () => {
    const admin = callerFor(adminId);
    const { headsUpId } = await admin.headsUps.create({ title: 'Not sent yet' });
    // Fabricate a recipient row against the unpublished draft — the shape a
    // stale client or a replayed request would produce.
    await db.insert(schema.headsUpRecipients).values({
      id: newId(),
      tenantId,
      headsUpId,
      userId: dayWorkerId,
    });

    await expect(callerFor(dayWorkerId).headsUps.markViewed({ headsUpId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'heads-up-not-published',
    });
  });

  it('HU-R07: markViewed refuses a non-recipient, matching markAcknowledged', async () => {
    const admin = callerFor(adminId);
    const { headsUpId } = await admin.headsUps.create({ title: 'For the day shift only' });
    await admin.headsUps.publish({ headsUpId, userIds: [dayWorkerId] });

    // The outsider is genuinely not on the list — otherwise this proves nothing.
    const enrolled = await db
      .select({ userId: schema.headsUpRecipients.userId })
      .from(schema.headsUpRecipients)
      .where(eq(schema.headsUpRecipients.headsUpId, headsUpId));
    expect(enrolled.map((r) => r.userId)).toEqual([dayWorkerId]);

    const outsider = callerFor(outsiderId);
    await expect(outsider.headsUps.markViewed({ headsUpId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'not-a-recipient',
    });
    // Its sibling already behaved this way; the two now agree.
    await expect(outsider.headsUps.markAcknowledged({ headsUpId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'not-a-recipient',
    });

    // No row was conjured for them, and the real recipient still works.
    const after = await db
      .select({ userId: schema.headsUpRecipients.userId })
      .from(schema.headsUpRecipients)
      .where(eq(schema.headsUpRecipients.headsUpId, headsUpId));
    expect(after).toHaveLength(1);

    await expect(callerFor(dayWorkerId).headsUps.markViewed({ headsUpId })).resolves.toEqual({
      ok: true,
    });
    const summary = await admin.headsUps.engagementSummary({ headsUpId });
    expect(summary.viewed).toBe(1);
  });

  // ── Regression guard ──────────────────────────────────────────────────

  it('the happy path is untouched: publish, view, acknowledge, sign', async () => {
    const admin = callerFor(adminId);
    const { headsUpId } = await admin.headsUps.create({
      title: 'Toolbox talk',
      engagementLevel: 'sign',
      requireAcknowledgement: true,
      requireSignature: true,
      documentIds: [openDocId],
    });
    await admin.headsUps.publish({ headsUpId, userIds: [dayWorkerId] });

    const recipient = callerFor(dayWorkerId);
    const detail = await recipient.headsUps.getForRecipient({ headsUpId });
    expect(detail.documents.map((d) => d.name)).toEqual([OPEN_TITLE]);

    await recipient.headsUps.markViewed({ headsUpId });
    await recipient.headsUps.markAcknowledged({ headsUpId });
    await recipient.headsUps.sign({ headsUpId, signatureData: 'a-real-signature' });

    const summary = await admin.headsUps.engagementSummary({ headsUpId });
    expect(summary.viewed).toBe(1);
    expect(summary.acknowledged).toBe(1);
    expect(summary.signed).toBe(1);
  });
});
