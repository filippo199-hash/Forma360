/**
 * Observations — audit fix verification (8 August 2026).
 *
 * (The router is `issues`; the product calls it Observations.)
 *
 * The audit found five defects. Four are one omission with four doors,
 * and the fifth is a loaded trap rather than an outage.
 *
 *   - OB-S03  HIGH. A contractor portal user could list the attachments of
 *             an observation they cannot open — and `attachments.list`
 *             mints a signed download URL per row. The leak is the FILE,
 *             not the metadata: working links to another company's site
 *             photography.
 *   - OB-S02  HIGH. The same user could read its timeline, which selects
 *             `actorName` AND `actorEmail` — the internal staff directory
 *             for the thread along with its history.
 *   - OB-S01  HIGH. And its comment thread.
 *   - OB-S04  They could also post into it — an outside company's words in
 *             an internal evidential record.
 *   - OB-Q07  The URL the router hands out for the QR poster resolves to a
 *             signed-in page with no `[token]` segment, not to the public
 *             form.
 *
 * OB-S01..S04 are a shape the earlier audits had not seen: not a module
 * reading another module's records without its rule, but a module not
 * applying its OWN rule to its own sub-routers. `issues.get` and
 * `issues.comments.list` are forty lines apart in the same file and one of
 * them checked. So the fix is one canonical read (`loadIssueForCallerOrThrow`)
 * that all of them call, and the tests below assert parity with `get`
 * rather than each door in isolation.
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
  createLogger({ service: 'issues-audit', level: 'fatal', nodeEnv: 'test' });

describe('observations — audit fixes (8 August 2026)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  /** Portal user for contractor A — reports their own observations. */
  let subAId: string;
  /** Portal user for contractor B — must see nothing of A's or ours. */
  let subBId: string;
  let categoryId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tenantId as never },
    });
  }
  const callerFor = (userId: string) => createCaller(ctxFor(userId));

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db
      .insert(schema.tenants)
      .values({ id: tenantId, name: 'Acme', slug: `acme-${tenantId.slice(-8).toLowerCase()}` });
    const sets = await seedDefaultPermissionSets(db as unknown as Database, tenantId);

    adminId = `usr_${newId()}`;
    subAId = `usr_${newId()}`;
    subBId = `usr_${newId()}`;

    // The portal set mirrors what a contractor activity grant produces:
    // tenant-wide `issues.view` + `issues.report`. The whole point of
    // `loadContractorScope` is that the permission is NOT the boundary.
    const portalSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: portalSetId,
      tenantId,
      name: 'Contractor portal',
      permissions: ['issues.view', 'issues.report'],
    });

    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Alice Admin',
        email: `alice-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: subAId,
        name: 'Sub A',
        email: `a-${tenantId}@sub.test`,
        tenantId,
        permissionSetId: portalSetId,
      },
      {
        id: subBId,
        name: 'Sub B',
        email: `b-${tenantId}@sub.test`,
        tenantId,
        permissionSetId: portalSetId,
      },
    ]);

    const contractorA = newId();
    const contractorB = newId();
    await db.insert(schema.contractors).values([
      { id: contractorA, tenantId, name: 'Acme Sub' },
      { id: contractorB, tenantId, name: 'Beta Sub' },
    ]);
    // Induction acknowledged: this suite is about data scoping, not the
    // PF-19 gate. The gate is asserted separately at the end, because the
    // fix restores it on three paths that never checked it.
    await db.insert(schema.contractorUsers).values([
      {
        id: newId(),
        tenantId,
        contractorId: contractorA,
        userId: subAId,
        acknowledgedAt: new Date(),
        acknowledgedVersion: 1,
      },
      {
        id: newId(),
        tenantId,
        contractorId: contractorB,
        userId: subBId,
        acknowledgedAt: new Date(),
        acknowledgedVersion: 1,
      },
    ]);

    ({ categoryId } = await callerFor(adminId).issues.categories.create({ name: 'Hazard' }));
  });

  afterEach(async () => {
    await client.close();
  });

  /** An observation reported by contractor A, with a comment, a photo and history. */
  async function subAObservation(): Promise<string> {
    const subA = callerFor(subAId);
    const { issueId } = await subA.issues.issues.create({
      categoryId,
      title: 'Cable tray loose in riser 3',
      description: 'Photographed on the second floor.',
    });
    await subA.issues.comments.create({ issueId, body: 'Reported to the site manager.' });
    await subA.issues.attachments.create({
      issueId,
      storageKey: `${tenantId}/issues/${issueId}/riser.jpg`,
      filename: 'riser.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
    });
    return issueId;
  }

  // ── Fixture integrity ─────────────────────────────────────────────────

  it('fixture: the portal user genuinely holds tenant-wide issues.view', async () => {
    // If they did not, every refusal below would be the permission check
    // rather than the scope, and this suite would prove nothing.
    await expect(callerFor(subBId).issues.issues.list({})).resolves.toBeDefined();
  });

  it('fixture: get already refused — that is the parity the siblings broke', async () => {
    const issueId = await subAObservation();
    await expect(callerFor(subBId).issues.issues.get({ issueId })).rejects.toThrow(/NOT_FOUND/i);
    // ...and contractor A, who reported it, can still open it.
    await expect(callerFor(subAId).issues.issues.get({ issueId })).resolves.toBeDefined();
  });

  // ── OB-S01..S04 — the four doors ──────────────────────────────────────

  it('OB-S01: the comment thread is refused to a contractor who cannot open the observation', async () => {
    const issueId = await subAObservation();
    await expect(callerFor(subBId).issues.comments.list({ issueId })).rejects.toThrow(/NOT_FOUND/i);
    // The reporter still reads their own thread.
    await expect(callerFor(subAId).issues.comments.list({ issueId })).resolves.toHaveLength(1);
  });

  it('OB-S02: the timeline is refused — it carries actorEmail as well as actorName', async () => {
    const issueId = await subAObservation();
    await expect(callerFor(subBId).issues.activity.list({ issueId })).rejects.toThrow(/NOT_FOUND/i);

    // The internal staff directory really is in that projection, which is
    // what makes the refusal worth having rather than tidy.
    const own = await callerFor(subAId).issues.activity.list({ issueId });
    expect(own.length).toBeGreaterThan(0);
    expect(own.some((r) => r.actorEmail !== null)).toBe(true);
  });

  it('OB-S03: the photo gallery is refused — and it hands out signed download URLs', async () => {
    const issueId = await subAObservation();
    await expect(callerFor(subBId).issues.attachments.list({ issueId })).rejects.toThrow(
      /NOT_FOUND/i,
    );

    // The control that makes OB-S03 the serious one: these rows carry a
    // working link to the file, not merely its name.
    const own = await callerFor(subAId).issues.attachments.list({ issueId });
    expect(own).toHaveLength(1);
    expect(own[0]?.signedUrl).toContain('riser.jpg');
  });

  it('OB-S04: posting into another company’s thread is refused, and writes nothing', async () => {
    const issueId = await subAObservation();
    await expect(
      callerFor(subBId).issues.comments.create({ issueId, body: 'Not our incident.' }),
    ).rejects.toThrow(/NOT_FOUND/i);

    const comments = await db
      .select({ body: schema.issueComments.body })
      .from(schema.issueComments)
      .where(eq(schema.issueComments.issueId, issueId));
    expect(comments).toHaveLength(1);
    expect(JSON.stringify(comments)).not.toContain('Not our incident');
  });

  it('OB-S04 (same omission): attaching a photo to another company’s observation is refused', async () => {
    // Not named in the audit, but the identical check one procedure over.
    const issueId = await subAObservation();
    await expect(
      callerFor(subBId).issues.attachments.create({
        issueId,
        storageKey: `${tenantId}/issues/${issueId}/theirs.jpg`,
        filename: 'theirs.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(/NOT_FOUND/i);

    const rows = await db
      .select({ id: schema.issueAttachments.id })
      .from(schema.issueAttachments)
      .where(eq(schema.issueAttachments.issueId, issueId));
    expect(rows).toHaveLength(1);
  });

  it('OB-S01..S04: an internal observation is invisible through every door', async () => {
    // The anonymous/internal case: `reportedByUserId` belongs to staff, so
    // no contractor scope can ever match it.
    const { issueId } = await callerFor(adminId).issues.issues.create({
      categoryId,
      title: 'Internal only',
    });
    const subB = callerFor(subBId);
    for (const call of [
      () => subB.issues.issues.get({ issueId }),
      () => subB.issues.comments.list({ issueId }),
      () => subB.issues.activity.list({ issueId }),
      () => subB.issues.attachments.list({ issueId }),
      () => subB.issues.comments.create({ issueId, body: 'x' }),
    ]) {
      await expect(call()).rejects.toThrow(/NOT_FOUND/i);
    }
  });

  it('OB-S01..S04: internal staff are unrestricted by this mechanism', async () => {
    // The scope must not leak into ordinary use — an admin reads everything.
    const issueId = await subAObservation();
    const admin = callerFor(adminId);
    await expect(admin.issues.issues.get({ issueId })).resolves.toBeDefined();
    await expect(admin.issues.comments.list({ issueId })).resolves.toHaveLength(1);
    await expect(admin.issues.activity.list({ issueId })).resolves.toBeDefined();
    await expect(admin.issues.attachments.list({ issueId })).resolves.toHaveLength(1);
  });

  it('PF-19: the induction gate is restored on the paths that never checked it', async () => {
    // The second consequence the audit names. `loadContractorScope` is the
    // server-side induction gate; three paths never called it, so three
    // paths never checked induction. Un-acknowledge contractor A and their
    // OWN observation must close too — not with NOT_FOUND, but with the
    // marker the portal shell redirects on.
    const issueId = await subAObservation();
    await db
      .update(schema.contractorUsers)
      .set({ acknowledgedAt: null, acknowledgedVersion: null })
      .where(eq(schema.contractorUsers.userId, subAId));

    const subA = callerFor(subAId);
    for (const call of [
      () => subA.issues.issues.get({ issueId }),
      () => subA.issues.comments.list({ issueId }),
      () => subA.issues.activity.list({ issueId }),
      () => subA.issues.attachments.list({ issueId }),
    ]) {
      await expect(call()).rejects.toMatchObject({ message: 'induction_required' });
    }
  });

  // ── OB-Q07 — the QR URL ───────────────────────────────────────────────

  it('OB-Q07: the QR URL points at the public form, unlocalised', async () => {
    const admin = callerFor(adminId);
    const minted = await admin.issues.categories.generateShareToken({ categoryId });

    expect(minted.url).toBe(`http://localhost:3000/scan/${minted.token}`);
    // The two things that were wrong: a locale segment on a route that has
    // none, and `/report/` — a signed-in chooser page with no `[token]`.
    expect(minted.url).not.toMatch(/\/[a-z]{2}\/scan\//);
    expect(minted.url).not.toContain('/report/');
  });

  it('OB-Q07: rotation returns the same shape, and generate stays idempotent', async () => {
    const admin = callerFor(adminId);
    const first = await admin.issues.categories.generateShareToken({ categoryId });
    // Idempotent — rotating silently would kill every QR code on a wall.
    const again = await admin.issues.categories.generateShareToken({ categoryId });
    expect(again.token).toBe(first.token);
    expect(again.url).toBe(`http://localhost:3000/scan/${first.token}`);

    const rotated = await admin.issues.categories.rotateShareToken({ categoryId });
    expect(rotated.token).not.toBe(first.token);
    expect(rotated.url).toBe(`http://localhost:3000/scan/${rotated.token}`);
  });

  it('OB-Q07: the URL the router returns actually resolves the token', async () => {
    // The assertion that would have caught this: take the router's own
    // answer, pull the last path segment off it, and submit with that.
    // Before the fix the segment was still the token — but the PATH was a
    // page that cannot accept it, so this test pins both halves.
    const admin = callerFor(adminId);
    const { url } = await admin.issues.categories.generateShareToken({ categoryId });
    const [, path, token] = /^https?:\/\/[^/]+\/([^/]+)\/(.+)$/.exec(url) ?? [];
    expect(path).toBe('scan');

    const meta = await createCaller(ctxFor(adminId)).issues.categories.publicGetByShareToken({
      token: token ?? '',
    });
    expect(meta?.categoryName).toBe('Hazard');
  });
});
