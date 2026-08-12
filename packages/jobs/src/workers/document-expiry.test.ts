/**
 * Unit tests for document expiry reminders (platform review PF-16).
 *
 * Edge cases:
 *   - DOC-J01: a document crossing a reminderDays threshold reminds the
 *     uploader + documents.manage holders once (stamped); the next
 *     threshold (or expiry itself) re-reminds; far-future and archived
 *     documents never remind
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDocumentExpiry, type ExpiringDocument } from './document-expiry';

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

const logger = createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
const NOW = new Date('2026-08-03T06:15:00Z');
const DAY_MS = 86_400_000;

describe('document-expiry', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let adminEmail: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    adminId = `usr_${newId()}`;
    adminEmail = `alice-${tenantId}@acme.test`;
    await db.insert(schema.user).values({
      id: adminId,
      name: 'Alice Admin',
      email: adminEmail,
      tenantId,
      permissionSetId: sets.administrator,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  async function anySetId(): Promise<string> {
    const [row] = await db
      .select({ id: schema.permissionSets.id })
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.tenantId, tenantId))
      .limit(1);
    if (row === undefined) throw new Error('expected a seeded permission set');
    return row.id;
  }

  async function seedDocument(
    over: Partial<typeof schema.documents.$inferInsert>,
  ): Promise<string> {
    const id = newId();
    await db.insert(schema.documents).values({
      id,
      tenantId,
      name: over.name ?? 'Public liability certificate',
      storageKey: `${tenantId}/documents/${id}`,
      filename: 'cert.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      uploadedByUserId: adminId,
      ...over,
    });
    return id;
  }

  function run(sent: Array<{ to: string; doc: ExpiringDocument; viewUrl?: string }>, now: Date) {
    return runDocumentExpiry({
      db: db as never,
      logger,
      appUrl: 'https://app.test',
      notify: (recipient, doc, viewUrl) => {
        sent.push({ to: recipient.email, doc, viewUrl });
        return Promise.resolve();
      },
      now: () => now,
    });
  }

  it('DOC-J01: reminds at each threshold once; skips far-future and archived', async () => {
    const certId = await seedDocument({
      expiresAt: new Date(NOW.getTime() + 20 * DAY_MS),
      reminderDays: [30, 7],
    });
    await seedDocument({
      name: 'Far future',
      expiresAt: new Date(NOW.getTime() + 200 * DAY_MS),
      reminderDays: [30],
    });
    await seedDocument({
      name: 'Archived',
      expiresAt: new Date(NOW.getTime() - DAY_MS),
      archivedAt: NOW,
    });

    // 20 days out: the 30-day threshold has crossed → one reminder.
    const sent1: Array<{ to: string; doc: ExpiringDocument }> = [];
    const first = await run(sent1, NOW);
    expect(first.reminded).toBe(1);
    expect(sent1.every((s) => s.doc.documentId === certId)).toBe(true);
    expect(sent1.map((s) => s.to)).toContain(adminEmail);

    // Next day: still inside the same threshold — silent.
    const sent2: Array<{ to: string; doc: ExpiringDocument }> = [];
    expect((await run(sent2, new Date(NOW.getTime() + DAY_MS))).reminded).toBe(0);

    // 14 days later (6 days to expiry): the 7-day threshold crossed → again.
    const sent3: Array<{ to: string; doc: ExpiringDocument }> = [];
    expect((await run(sent3, new Date(NOW.getTime() + 14 * DAY_MS))).reminded).toBe(1);
    expect(sent3[0]?.doc.expired).toBe(false);

    // Past expiry: the at-expiry notice fires once more.
    const sent4: Array<{ to: string; doc: ExpiringDocument }> = [];
    expect((await run(sent4, new Date(NOW.getTime() + 21 * DAY_MS))).reminded).toBe(1);
    expect(sent4[0]?.doc.expired).toBe(true);
  });

  it('DOC-J02: per-channel prefs — all-muted email still stamps; muted inapp keeps the email', async () => {
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'email:document_expiry': false } })
      .where(eq(schema.user.id, adminId));
    await seedDocument({
      expiresAt: new Date(NOW.getTime() + 20 * DAY_MS),
      reminderDays: [30],
    });

    // The only recipient muted email: no send, but the bell row lands AND
    // the reminder stamps — an unstamped doc would re-bell every day.
    const sent1: Array<{ to: string; doc: ExpiringDocument }> = [];
    const first = await run(sent1, NOW);
    expect(first.reminded).toBe(1);
    expect(sent1).toHaveLength(0);
    const bells = await db.select().from(schema.notifications);
    expect(bells.map((r) => r.kind)).toEqual(['document_expiry']);
    expect(bells[0]?.userId).toBe(adminId);

    // Next day: stamped — silent, no duplicate bell row.
    const sent2: Array<{ to: string; doc: ExpiringDocument }> = [];
    expect((await run(sent2, new Date(NOW.getTime() + DAY_MS))).reminded).toBe(0);
    expect(await db.select().from(schema.notifications)).toHaveLength(1);

    // Flip: inapp muted, email restored → email sent, no new bell row.
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'inapp:document_expiry': false } })
      .where(eq(schema.user.id, adminId));
    await seedDocument({
      name: 'Second doc',
      expiresAt: new Date(NOW.getTime() + 20 * DAY_MS),
      reminderDays: [30],
    });
    const sent3: Array<{ to: string; doc: ExpiringDocument }> = [];
    expect((await run(sent3, NOW)).reminded).toBe(1);
    expect(sent3.map((s) => s.to)).toEqual([adminEmail]);
    expect(await db.select().from(schema.notifications)).toHaveLength(1);
  });

  it('DC-S06: the named responsible party is told — user and group', async () => {
    // `responsibleUserId` / `responsibleGroupId` are collected on the upload
    // form, stored, and rendered on the detail page — and the notification
    // engine ignored both. The reminder went to whoever dragged the PDF in
    // (possibly a leaver) plus a broadcast of every manage holder: the one
    // field that names an accountable human was the one field unread.
    const janeId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: janeId,
      name: 'Jane Facilities',
      email: `jane-${tenantId}@acme.test`,
      tenantId,
      locale: 'fr',
      permissionSetId: await anySetId(),
    });

    const certId = await seedDocument({
      name: 'Fire alarm service certificate',
      expiresAt: new Date(NOW.getTime() - DAY_MS),
      responsibleUserId: janeId,
    });

    const sent: Array<{ to: string; doc: ExpiringDocument; viewUrl?: string }> = [];
    expect((await run(sent, NOW)).reminded).toBe(1);
    expect(sent.map((s) => s.to)).toContain(`jane-${tenantId}@acme.test`);
    expect(sent.every((s) => s.doc.documentId === certId)).toBe(true);
    // DOC-A01: and Jane's link is in Jane's language.
    expect(sent.find((s) => s.to === `jane-${tenantId}@acme.test`)?.viewUrl).toBe(
      `https://app.test/fr/documents/${certId}`,
    );

    // A responsible GROUP reaches its members.
    const groupId = newId();
    await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'Facilities' });
    const bobId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: bobId,
      name: 'Bob',
      email: `bob-${tenantId}@acme.test`,
      tenantId,
      permissionSetId: await anySetId(),
    });
    await db.insert(schema.groupMembers).values({ tenantId, groupId, userId: bobId });
    await seedDocument({
      name: 'Lift inspection',
      expiresAt: new Date(NOW.getTime() - DAY_MS),
      responsibleGroupId: groupId,
    });

    const sent2: Array<{ to: string; doc: ExpiringDocument; viewUrl?: string }> = [];
    await run(sent2, NOW);
    expect(sent2.map((s) => s.to)).toContain(`bob-${tenantId}@acme.test`);
  });
});
