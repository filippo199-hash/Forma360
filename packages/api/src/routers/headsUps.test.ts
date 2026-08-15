/**
 * Integration tests for the Heads Up router (Phase 5A).
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
import { __authStubMailbox, appRouter } from '../router';
import { createCallerFactory } from '../trpc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');
/**
 * Every migration in the directory, in order.
 *
 * This used to be a CURATED list — the subset a given suite needed, for
 * speed. The cost was a manual chore CLAUDE.md had to document ("add the
 * next migration to that list"), and missing it left a table half-built:
 * Drizzle writes every column it knows about, so the first insert failed
 * with `column does not exist`, in a suite unrelated to the change that
 * caused it. Sixteen lists had drifted.
 *
 * Applying all of them costs about two seconds, which is not worth a
 * recurring footgun on a schema that changes every week. `MIG-L01` pins
 * that the lists and the ORM agree.
 */
async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
}

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of await migrationFiles()) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { client, db };
}

const createCaller = createCallerFactory(appRouter);

function silentLogger() {
  return createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
}

describe('Heads Up router (Phase 5A)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let memberUserId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tenantId as never },
    });
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = newId();
    memberUserId = newId();
    await db.insert(schema.user).values([
      {
        id: adminUserId,
        name: 'Admin',
        email: 'admin@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
      {
        id: memberUserId,
        name: 'Member',
        email: 'member@acme.test',
        tenantId,
        permissionSetId: seeded.standard,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('creates a draft heads-up and lists it', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { headsUpId } = await caller.headsUps.create({
      title: 'Safety briefing',
      description: 'All staff must attend.',
      engagementLevel: 'acknowledge',
    });

    const list = await caller.headsUps.list({});
    expect(list.some((h) => h.id === headsUpId)).toBe(true);

    const { headsUp } = await caller.headsUps.get({ headsUpId });
    expect(headsUp.title).toBe('Safety briefing');
    expect(headsUp.status).toBe('draft');
    expect(headsUp.engagementLevel).toBe('acknowledge');
  });

  it('publishes a heads-up and adds individual recipients', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { headsUpId } = await caller.headsUps.create({
      title: 'Q1 Update',
      engagementLevel: 'view',
    });

    const { recipientCount } = await caller.headsUps.publish({
      headsUpId,
      userIds: [memberUserId],
    });

    expect(recipientCount).toBe(1);

    const { headsUp } = await caller.headsUps.get({ headsUpId });
    expect(headsUp.status).toBe('published');
  });

  it('NP-HU1: heads_up prefs — muted email still stamps the reminder and keeps the bell; muted inapp keeps the email', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    // Member mutes the heads_up EMAIL: publish still writes their bell
    // row; a reminder is stamped but not sent.
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'email:heads_up': false } })
      .where(eq(schema.user.id, memberUserId));
    const first = await caller.headsUps.create({ title: 'Muted mail', engagementLevel: 'view' });
    await caller.headsUps.publish({ headsUpId: first.headsUpId, userIds: [memberUserId] });
    let bells = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, 'heads_up'));
    expect(bells.map((b) => b.userId)).toEqual([memberUserId]);

    __authStubMailbox.length = 0;
    const reminded = await caller.headsUps.sendReminder({ headsUpId: first.headsUpId });
    expect(reminded.count).toBe(1);
    expect(__authStubMailbox.filter((m) => m.templateKey === 'heads-up-reminder')).toHaveLength(0);
    const stamped = await db
      .select()
      .from(schema.headsUpRecipients)
      .where(eq(schema.headsUpRecipients.headsUpId, first.headsUpId));
    expect(stamped[0]?.reminderLastSentAt).toBeInstanceOf(Date);

    // Member mutes the heads_up BELL instead: publish writes no row; the
    // reminder email goes out.
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'inapp:heads_up': false } })
      .where(eq(schema.user.id, memberUserId));
    const second = await caller.headsUps.create({ title: 'Muted bell', engagementLevel: 'view' });
    await caller.headsUps.publish({ headsUpId: second.headsUpId, userIds: [memberUserId] });
    bells = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, 'heads_up'));
    expect(bells).toHaveLength(1); // still only the first one
    __authStubMailbox.length = 0;
    await caller.headsUps.sendReminder({ headsUpId: second.headsUpId });
    expect(
      __authStubMailbox.filter((m) => m.templateKey === 'heads-up-reminder').map((m) => m.to),
    ).toEqual(['member@acme.test']);
  });

  it('#4: attaches a library document and surfaces sign-offs on the document page', async () => {
    const adminCaller = createCaller(ctxFor(adminUserId));
    const memberCaller = createCaller(ctxFor(memberUserId));

    const { documentId } = await adminCaller.documents.create({
      name: 'Safety Policy',
      storageKey: `${tenantId}/documents/policy.pdf`,
      filename: 'policy.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    const { headsUpId } = await adminCaller.headsUps.create({
      title: 'Please sign the policy',
      engagementLevel: 'sign',
      requireAcknowledgement: true,
      requireSignature: true,
      documentIds: [documentId],
    });
    await adminCaller.headsUps.publish({ headsUpId, userIds: [memberUserId] });

    // The document is linked, version-anchored, recipient pending.
    let reqs = await adminCaller.documents.signatureRequests({ documentId });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.documentVersion).toBe(1);
    expect(reqs[0]?.recipients).toHaveLength(1);
    expect(reqs[0]?.recipients[0]?.signedAt).toBeNull();

    // The recipient acknowledges + signs; the sign-off shows on the doc page.
    await memberCaller.headsUps.markAcknowledged({ headsUpId });
    await memberCaller.headsUps.sign({ headsUpId, signatureData: 'sig' });

    reqs = await adminCaller.documents.signatureRequests({ documentId });
    expect(reqs[0]?.recipients[0]?.signedAt).not.toBeNull();
  });

  it('tracks view engagement correctly', async () => {
    const adminCaller = createCaller(ctxFor(adminUserId));
    const memberCaller = createCaller(ctxFor(memberUserId));

    const { headsUpId } = await adminCaller.headsUps.create({
      title: 'Test view tracking',
      engagementLevel: 'view',
    });
    await adminCaller.headsUps.publish({ headsUpId, userIds: [memberUserId] });

    // Not viewed yet.
    const before = await adminCaller.headsUps.engagementSummary({ headsUpId });
    expect(before.viewed).toBe(0);
    expect(before.notViewed).toBe(1);

    // Mark viewed.
    await memberCaller.headsUps.markViewed({ headsUpId });

    const after = await adminCaller.headsUps.engagementSummary({ headsUpId });
    expect(after.viewed).toBe(1);
    expect(after.notViewed).toBe(0);
  });

  it('H-E09: requires acknowledgement before signing', async () => {
    const adminCaller = createCaller(ctxFor(adminUserId));
    const memberCaller = createCaller(ctxFor(memberUserId));

    const { headsUpId } = await adminCaller.headsUps.create({
      title: 'Must sign',
      engagementLevel: 'sign',
      requireAcknowledgement: true,
      requireSignature: true,
    });
    await adminCaller.headsUps.publish({ headsUpId, userIds: [memberUserId] });

    // Attempt to sign without acknowledging first.
    await expect(
      memberCaller.headsUps.sign({ headsUpId, signatureData: 'sig-data' }),
    ).rejects.toThrow('must-acknowledge-before-sign');

    // Acknowledge first, then sign.
    await memberCaller.headsUps.markAcknowledged({ headsUpId });
    await memberCaller.headsUps.sign({ headsUpId, signatureData: 'sig-data' });

    const summary = await adminCaller.headsUps.engagementSummary({ headsUpId });
    expect(summary.signed).toBe(1);
  });

  it('archives a heads-up', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { headsUpId } = await caller.headsUps.create({ title: 'Archive me' });
    await caller.headsUps.archive({ headsUpId });

    const { headsUp } = await caller.headsUps.get({ headsUpId });
    expect(headsUp.status).toBe('archived');
  });

  it('creates and lists comments', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { headsUpId } = await caller.headsUps.create({ title: 'Comment test' });
    await caller.headsUps.comments.create({ headsUpId, body: 'Great briefing!' });

    const comments = await caller.headsUps.comments.list({ headsUpId });
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe('Great briefing!');
  });

  it('listForRecipient + getForRecipient: recipient inbox with engagement', async () => {
    const adminCaller = createCaller(ctxFor(adminUserId));
    const memberCaller = createCaller(ctxFor(memberUserId));

    const { headsUpId } = await adminCaller.headsUps.create({
      title: 'Please sign',
      engagementLevel: 'sign',
      requireAcknowledgement: true,
      requireSignature: true,
    });
    await adminCaller.headsUps.publish({ headsUpId, userIds: [memberUserId] });

    // Recipient sees it, pending (not yet signed).
    const list = await memberCaller.headsUps.listForRecipient();
    const row = list.find((h) => h.id === headsUpId);
    expect(row).toBeDefined();
    expect(row?.pending).toBe(true);
    expect(row?.creatorName).toBe('Admin');

    // pending filter includes it; done filter excludes it.
    const pendingList = await memberCaller.headsUps.listForRecipient({ filter: 'pending' });
    expect(pendingList.some((h) => h.id === headsUpId)).toBe(true);
    const doneList = await memberCaller.headsUps.listForRecipient({ filter: 'done' });
    expect(doneList.some((h) => h.id === headsUpId)).toBe(false);

    // getForRecipient returns it with engagement state.
    const detail = await memberCaller.headsUps.getForRecipient({ headsUpId });
    expect(detail.headsUp.title).toBe('Please sign');
    expect(detail.creatorName).toBe('Admin');
    expect(detail.engagement.signedAt).toBeNull();

    // A non-recipient (the admin creator) cannot read it → NOT_FOUND.
    await expect(adminCaller.headsUps.getForRecipient({ headsUpId })).rejects.toThrow(
      'heads-up-not-found',
    );

    // Engagement mutations flip the returned fields.
    await memberCaller.headsUps.markViewed({ headsUpId });
    await memberCaller.headsUps.markAcknowledged({ headsUpId });
    await memberCaller.headsUps.sign({ headsUpId, signatureData: 'sig' });

    const afterSign = await memberCaller.headsUps.getForRecipient({ headsUpId });
    expect(afterSign.engagement.viewedAt).not.toBeNull();
    expect(afterSign.engagement.acknowledgedAt).not.toBeNull();
    expect(afterSign.engagement.signedAt).not.toBeNull();

    // Now done filter includes it (pending flipped false); pending excludes it.
    const afterPending = await memberCaller.headsUps.listForRecipient({ filter: 'pending' });
    expect(afterPending.some((h) => h.id === headsUpId)).toBe(false);
    const afterDone = await memberCaller.headsUps.listForRecipient({ filter: 'done' });
    expect(afterDone.some((h) => h.id === headsUpId && h.pending === false)).toBe(true);
  });

  it('recipient views exclude draft heads-ups', async () => {
    const adminCaller = createCaller(ctxFor(adminUserId));
    const memberCaller = createCaller(ctxFor(memberUserId));

    // A draft with a recipient row must not surface — the status guard, not
    // just the absence of recipients, is what protects it.
    const { headsUpId } = await adminCaller.headsUps.create({ title: 'Draft only' });
    await db.insert(schema.headsUpRecipients).values({
      id: newId(),
      tenantId,
      headsUpId,
      userId: memberUserId,
    });

    const list = await memberCaller.headsUps.listForRecipient();
    expect(list.some((h) => h.id === headsUpId)).toBe(false);

    await expect(memberCaller.headsUps.getForRecipient({ headsUpId })).rejects.toThrow(
      'heads-up-not-found',
    );
  });
});
