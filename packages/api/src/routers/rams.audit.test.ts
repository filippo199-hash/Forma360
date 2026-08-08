/**
 * RAMS — audit fix verification (8 August 2026).
 *
 * The audit found one defect in the largest module in the product, and it
 * is the sixth appearance of the same mistake the previous audits kept
 * finding: a module reading another module's records without applying that
 * module's access rule.
 *
 *   - RS-X00  control: `documents.get` refuses the author outright, so the
 *             fixture is a real restriction and not a mislabelled actor.
 *   - RS-X01  `packs.addDocument` refuses an author attaching a library
 *             document they cannot themselves open.
 *
 * Why attach time is the only fix here, and not merely the cheapest. In
 * Heads-Up the equivalent defect had two possible places to intervene —
 * refuse at attach, or filter at render — and the shipped fix did both. A
 * RAMS pack has no second chance:
 *
 *   1. it snapshots its documents into an IMMUTABLE issued version, and
 *   2. serves that version to an UNAUTHENTICATED client over a share link,
 *   3. and `rams_pack_documents.title` is denormalised at attach time, so
 *      even re-joining `documents` at render would not undo the disclosure.
 *
 * Point 3 is asserted below, because it is the part that makes the other
 * two irreversible and it is not obvious from reading the router.
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
const silentLogger = () => createLogger({ service: 'rams-audit', level: 'fatal', nodeEnv: 'test' });

/** The title is the payload: this is what must not reach a client's inbox. */
const RESTRICTED_TITLE = 'Redundancy consultation — night shift';
const OPEN_TITLE = 'Site induction pack';

describe('rams — audit fixes (8 August 2026)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let nightShiftId: string;
  let siteA: string;

  /** Administrator. Holds `documents.manage`, so sees the whole library. */
  let adminId: string;
  /** Authors packs; holds no `documents.manage`; in no group. */
  let authorId: string;
  /** In the Night shift group — entitled to the restricted document. */
  let nightAuthorId: string;

  let restrictedDocId: string;
  let openDocId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@acme.test`, tenantId: tenantId as never },
    });
  }
  const callerFor = (userId: string) => createCaller(ctxFor(userId));

  async function newPack(userId: string): Promise<string> {
    const { packId } = await callerFor(userId).rams.packs.create({
      title: 'AHU filter replacement — Riverside',
      clientName: 'Riverside Estates',
      siteId: siteA,
      locationText: 'Plant room 3',
      supervisorName: 'Tom Whitfield',
    });
    return packId;
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());

    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const sets = await seedDefaultPermissionSets(db as unknown as Database, tenantId);

    // A pack author who is NOT a document manager. That separation is the
    // whole point: the person writing method statements is routinely not the
    // person entrusted with the document library.
    const authorSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: authorSetId,
      tenantId,
      name: 'RAMS author',
      description: 'Authors packs; reads documents but does not manage them.',
      permissions: ['rams.view', 'rams.create', 'rams.brief', 'documents.view', 'sites.view'],
      isSystem: false,
    });

    adminId = newId();
    authorId = newId();
    nightAuthorId = newId();
    await db.insert(schema.user).values([
      {
        id: adminId,
        tenantId,
        name: 'Priya Nair',
        email: 'priya@acme.test',
        permissionSetId: sets.administrator,
      },
      {
        id: authorId,
        tenantId,
        name: 'Tom Whitfield',
        email: 'tom@acme.test',
        permissionSetId: authorSetId,
      },
      {
        id: nightAuthorId,
        tenantId,
        name: 'Ola Sinclair',
        email: 'ola@acme.test',
        permissionSetId: authorSetId,
      },
    ]);

    nightShiftId = newId();
    await db
      .insert(schema.groups)
      .values({ id: nightShiftId, tenantId, name: 'Night shift', membershipMode: 'manual' });
    await db
      .insert(schema.groupMembers)
      .values({ tenantId, groupId: nightShiftId, userId: nightAuthorId });

    siteA = newId();
    await db.insert(schema.sites).values({
      id: siteA,
      tenantId,
      name: 'Riverside Plaza',
      kind: 'site',
      path: siteA,
      depth: 0,
    });

    const admin = callerFor(adminId);
    ({ documentId: restrictedDocId } = await admin.documents.create({
      name: RESTRICTED_TITLE,
      storageKey: `${tenantId}/documents/redundancy.pdf`,
      filename: 'redundancy.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    }));
    ({ documentId: openDocId } = await admin.documents.create({
      name: OPEN_TITLE,
      storageKey: `${tenantId}/documents/induction.pdf`,
      filename: 'induction.pdf',
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
  // Everything below concludes something from a refusal, so first prove the
  // refusal cannot be coming from the permission check instead.

  it('fixture: the author holds rams.create and documents.view, but not documents.manage', async () => {
    const author = callerFor(authorId);
    // Reaching a value on either proves the key is held.
    await expect(author.documents.list({})).resolves.toBeDefined();
    await expect(newPack(authorId)).resolves.toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // `documents.manage` gates create — this must refuse.
    await expect(
      author.documents.create({
        name: 'Nope',
        storageKey: `${tenantId}/documents/nope.pdf`,
        filename: 'nope.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // ── The defect ────────────────────────────────────────────────────────

  it('RS-X00 (control): documents.get refuses the restricted document to the author', async () => {
    await expect(
      callerFor(authorId).documents.get({ documentId: restrictedDocId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // And admits the night-shift author, so the restriction is a real group
    // rule rather than a blanket refusal.
    await expect(
      callerFor(nightAuthorId).documents.get({ documentId: restrictedDocId }),
    ).resolves.toBeDefined();
  });

  it('RS-X01: addDocument refuses a document the author cannot open', async () => {
    const packId = await newPack(authorId);

    await expect(
      callerFor(authorId).rams.packs.addDocument({ packId, documentId: restrictedDocId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'document-not-visible' });

    // Refused means not written: nothing to snapshot, nothing to mail out.
    const rows = await db
      .select({ id: schema.ramsPackDocuments.id })
      .from(schema.ramsPackDocuments)
      .where(
        and(
          eq(schema.ramsPackDocuments.tenantId, tenantId),
          eq(schema.ramsPackDocuments.packId, packId),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it('RS-X01: the gate is a gate, not a wall — entitled authors still attach', async () => {
    // The same author, a document they can see.
    const packId = await newPack(authorId);
    await expect(
      callerFor(authorId).rams.packs.addDocument({ packId, documentId: openDocId }),
    ).resolves.toMatchObject({ documentRowId: expect.any(String) });

    // The night-shift author, the restricted document they are entitled to.
    const nightPackId = await newPack(nightAuthorId);
    await expect(
      callerFor(nightAuthorId).rams.packs.addDocument({
        packId: nightPackId,
        documentId: restrictedDocId,
      }),
    ).resolves.toMatchObject({ documentRowId: expect.any(String) });

    // And a `documents.manage` holder, who sees the whole library anyway.
    const adminPackId = await newPack(adminId);
    await expect(
      callerFor(adminId).rams.packs.addDocument({
        packId: adminPackId,
        documentId: restrictedDocId,
      }),
    ).resolves.toMatchObject({ documentRowId: expect.any(String) });
  });

  it('RS-X01: a folder restriction on the ancestor is honoured too', async () => {
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

    const packId = await newPack(authorId);
    await expect(
      callerFor(authorId).rams.packs.addDocument({ packId, documentId: openDocId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'document-not-visible' });
  });

  it('RS-X01: direct uploads are unaffected — they were put on the pack on purpose', async () => {
    const packId = await newPack(authorId);
    await expect(
      callerFor(authorId).rams.packs.addDocument({
        packId,
        storageKey: `${tenantId}/rams/${packId}/site-plan.pdf`,
        filename: 'site-plan.pdf',
        title: 'Site plan',
      }),
    ).resolves.toMatchObject({ documentRowId: expect.any(String) });
  });

  it('RS-X01: why attach time is the only fix — the title is denormalised onto the pack row', async () => {
    // This is the assertion that justifies the shape of the fix. A later
    // filter over the `documents` join could not undo the disclosure,
    // because the title is copied onto `rams_pack_documents` at attach time
    // and travels with the pack from then on.
    const packId = await newPack(adminId);
    await callerFor(adminId).rams.packs.addDocument({ packId, documentId: restrictedDocId });

    const [row] = await db
      .select({ title: schema.ramsPackDocuments.title })
      .from(schema.ramsPackDocuments)
      .where(
        and(
          eq(schema.ramsPackDocuments.tenantId, tenantId),
          eq(schema.ramsPackDocuments.packId, packId),
        ),
      );
    expect(row?.title).toBe(RESTRICTED_TITLE);
  });
});
