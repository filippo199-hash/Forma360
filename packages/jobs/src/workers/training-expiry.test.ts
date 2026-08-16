/**
 * Unit tests for the training-expiry chase (FreeHS B7).
 *
 * The review found this was the only reminder worker in the repository
 * without a test, so its one genuinely correct safety property —
 * notify-then-stamp — was pinned by nothing.
 *
 * Edge cases:
 *   - TR-W01: notify-then-stamp — the stamp only lands after a successful
 *     send, so a failed send is retried rather than silently swallowed
 *   - TR-W02: dedup — a stamped record is never chased twice
 *   - TR-W03: the window is the requirement's OWN lead time
 *   - TR-W04: quiet when clean — an empty run sends and logs nothing
 *   - TR-W05: TR-A6 — account-less people (contractors, agency) are chased
 *     via whoever recorded the card, instead of being silently skipped
 *   - TR-W06: TR-A9 — the recipient's locale rides along with the chase
 *   - TR-W07: superseded and archived rows are never chased
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { and, eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTrainingExpiryReminders, type DueTrainingReminder } from './training-expiry';

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
const NOW = new Date('2026-08-06T00:00:00Z');
const dayOf = (n: number): Date => new Date(NOW.getTime() + n * 86_400_000);

describe('training-expiry worker', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let holderId: string;
  let recorderId: string;
  let setId: string;

  /** A requirement with its own chase window. */
  async function requirement(leadDays: number): Promise<string> {
    const id = newId();
    await db.insert(schema.trainingRequirements).values({
      id,
      tenantId,
      name: `Req ${id.slice(-6)}`,
      validityMonths: 12,
      renewalLeadDays: leadDays,
    });
    return id;
  }

  async function record(opts: {
    requirementId: string;
    expiresInDays: number;
    userId?: string | null;
    personName?: string;
    reminderSentAt?: Date | null;
    supersededAt?: Date | null;
  }): Promise<string> {
    const id = newId();
    await db.insert(schema.trainingRecords).values({
      id,
      tenantId,
      requirementId: opts.requirementId,
      userId: opts.userId === undefined ? holderId : opts.userId,
      personName: opts.personName ?? 'Dave Mullins',
      achievedAt: dayOf(-400),
      expiresAt: dayOf(opts.expiresInDays),
      recordedByUserId: recorderId,
      ...(opts.reminderSentAt != null ? { reminderSentAt: opts.reminderSentAt } : {}),
      ...(opts.supersededAt != null ? { supersededAt: opts.supersededAt } : {}),
    });
    return id;
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    holderId = newId();
    recorderId = newId();
    setId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme-tr' });
    await db.insert(schema.permissionSets).values({
      id: setId,
      tenantId,
      name: 'Standard',
      permissions: ['training.view'],
      isSystem: true,
    });
    await db.insert(schema.user).values([
      {
        id: holderId,
        tenantId,
        name: 'Dave Mullins',
        email: 'dave@acme.test',
        emailVerified: true,
        permissionSetId: setId,
        locale: 'it',
      },
      {
        id: recorderId,
        tenantId,
        name: 'Sarah Yeung',
        email: 'sarah@acme.test',
        emailVerified: true,
        permissionSetId: setId,
        locale: 'fr',
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  function bellRows(userId: string) {
    return db
      .select()
      .from(schema.notifications)
      .where(
        and(eq(schema.notifications.userId, userId), eq(schema.notifications.tenantId, tenantId)),
      );
  }

  function setPrefs(userId: string, prefs: Record<string, boolean>) {
    return db
      .update(schema.user)
      .set({ notificationPrefs: prefs })
      .where(eq(schema.user.id, userId));
  }

  function runOk(notify = vi.fn().mockResolvedValue(undefined)) {
    return runTrainingExpiryReminders({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://x.test',
      notify,
      now: () => NOW,
    });
  }

  it('TR-W01: stamps only AFTER a successful send, so a failure is retried', async () => {
    const reqId = await requirement(60);
    const recordId = await record({ requirementId: reqId, expiresInDays: 10 });

    // First run: the send throws, so the row must stay unstamped.
    const failing = vi.fn().mockRejectedValue(new Error('smtp down'));
    const sent = await runTrainingExpiryReminders({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://x.test',
      notify: failing,
      now: () => NOW,
    });
    expect(sent).toBe(0);
    expect(failing).toHaveBeenCalledTimes(1);
    let row = await db
      .select()
      .from(schema.trainingRecords)
      .where(eq(schema.trainingRecords.id, recordId));
    expect(row[0]?.reminderSentAt).toBeNull();

    // Second run: it succeeds, and now the stamp lands.
    const ok = vi.fn().mockResolvedValue(undefined);
    expect(
      await runTrainingExpiryReminders({
        db: db as unknown as Database,
        logger,
        appUrl: 'https://x.test',
        notify: ok,
        now: () => NOW,
      }),
    ).toBe(1);
    row = await db
      .select()
      .from(schema.trainingRecords)
      .where(eq(schema.trainingRecords.id, recordId));
    expect(row[0]?.reminderSentAt).not.toBeNull();
  });

  it('TR-W02: a stamped record is never chased twice', async () => {
    const reqId = await requirement(60);
    await record({ requirementId: reqId, expiresInDays: 5, reminderSentAt: dayOf(-1) });
    const notify = vi.fn().mockResolvedValue(undefined);
    expect(
      await runTrainingExpiryReminders({
        db: db as unknown as Database,
        logger,
        appUrl: 'https://x.test',
        notify,
        now: () => NOW,
      }),
    ).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('TR-W03: the chase window is the requirement’s own lead time', async () => {
    // 30 days out: inside a 60-day lead, outside a 14-day one.
    const wide = await requirement(60);
    const narrow = await requirement(14);
    await record({ requirementId: wide, expiresInDays: 30 });
    await record({ requirementId: narrow, expiresInDays: 30 });

    const notify = vi.fn().mockResolvedValue(undefined);
    expect(
      await runTrainingExpiryReminders({
        db: db as unknown as Database,
        logger,
        appUrl: 'https://x.test',
        notify,
        now: () => NOW,
      }),
    ).toBe(1);
    const chased = notify.mock.calls[0]?.[0] as DueTrainingReminder;
    expect(chased.requirementName).toBeDefined();
  });

  it('TR-W04: quiet when clean — nothing due sends nothing', async () => {
    const reqId = await requirement(30);
    await record({ requirementId: reqId, expiresInDays: 900 });
    const notify = vi.fn().mockResolvedValue(undefined);
    expect(
      await runTrainingExpiryReminders({
        db: db as unknown as Database,
        logger,
        appUrl: 'https://x.test',
        notify,
        now: () => NOW,
      }),
    ).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('TR-W05 (TR-A6): an account-less person is chased via whoever recorded the card', async () => {
    const reqId = await requirement(60);
    // A contractor's operative: no user row, so nothing to email directly.
    await record({
      requirementId: reqId,
      expiresInDays: 3,
      userId: null,
      personName: 'Agency Alan',
    });

    const notify = vi.fn().mockResolvedValue(undefined);
    expect(
      await runTrainingExpiryReminders({
        db: db as unknown as Database,
        logger,
        appUrl: 'https://x.test',
        notify,
        now: () => NOW,
      }),
    ).toBe(1);
    const chased = notify.mock.calls[0]?.[0] as DueTrainingReminder;
    // Addressed to the recorder, and flagged as such.
    expect(chased.email).toBe('sarah@acme.test');
    expect(chased.viaRecorder).toBe(true);
    expect(chased.personName).toBe('Agency Alan');
  });

  it('TR-W06 (TR-A9): the recipient’s locale rides along and localises the link', async () => {
    const reqId = await requirement(60);
    await record({ requirementId: reqId, expiresInDays: 7 });
    const notify = vi.fn().mockResolvedValue(undefined);
    await runTrainingExpiryReminders({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://x.test',
      notify,
      now: () => NOW,
    });
    const [reminder, url] = notify.mock.calls[0] as [DueTrainingReminder, string];
    expect(reminder.locale).toBe('it');
    expect(url).toBe('https://x.test/it/training');
  });

  it('TR-W07: superseded records and archived requirements are never chased', async () => {
    const reqId = await requirement(60);
    await record({ requirementId: reqId, expiresInDays: 4, supersededAt: dayOf(-1) });

    const archivedReq = await requirement(60);
    await db
      .update(schema.trainingRequirements)
      .set({ archivedAt: dayOf(-2) })
      .where(eq(schema.trainingRequirements.id, archivedReq));
    await record({ requirementId: archivedReq, expiresInDays: 4 });

    const notify = vi.fn().mockResolvedValue(undefined);
    expect(
      await runTrainingExpiryReminders({
        db: db as unknown as Database,
        logger,
        appUrl: 'https://x.test',
        notify,
        now: () => NOW,
      }),
    ).toBe(0);
  });
  it('TR-B9: a deactivated holder’s cards are not chased at all', async () => {
    const reqId = await requirement(60);
    await record({ requirementId: reqId, expiresInDays: 5 });
    // The holder leaves.
    await db
      .update(schema.user)
      .set({ deactivatedAt: dayOf(-1) })
      .where(eq(schema.user.id, holderId));

    const notify = vi.fn().mockResolvedValue(undefined);
    // Previously this fell through to the RECORDER, so for a month after
    // someone left, whoever recorded their tickets got a chase per lapsing
    // card for a person who no longer works there — the code did the
    // opposite of the comment directly above it.
    expect(
      await runTrainingExpiryReminders({
        db: db as unknown as Database,
        logger,
        appUrl: 'https://x.test',
        notify,
        now: () => NOW,
      }),
    ).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('NP-TR1: default prefs — holder gets the email AND a training_expiry bell row', async () => {
    const reqId = await requirement(60);
    await record({ requirementId: reqId, expiresInDays: 7 });

    const notify = vi.fn().mockResolvedValue(undefined);
    expect(await runOk(notify)).toBe(1);
    const chased = notify.mock.calls[0]?.[0] as DueTrainingReminder;
    expect(chased.email).toBe('dave@acme.test');

    const rows = await bellRows(holderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('training_expiry');
    expect(rows[0]?.href).toBe('/training');
  });

  it('NP-TR2: email:training_expiry muted — no email, bell row written, stamp lands; others still chased', async () => {
    await setPrefs(holderId, { 'email:training_expiry': false });
    const reqId = await requirement(60);
    const mutedRecord = await record({ requirementId: reqId, expiresInDays: 7 });
    // A second, account-less record chases the (unmuted) recorder.
    await record({
      requirementId: reqId,
      expiresInDays: 3,
      userId: null,
      personName: 'Agency Alan',
    });

    const notify = vi.fn().mockResolvedValue(undefined);
    expect(await runOk(notify)).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect((notify.mock.calls[0]?.[0] as DueTrainingReminder).email).toBe('sarah@acme.test');

    // The muted holder still gets the bell row…
    const rows = await bellRows(holderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('training_expiry');

    // …and the muted record still stamps: muted = handled, or it re-chases daily.
    const [row] = await db
      .select()
      .from(schema.trainingRecords)
      .where(eq(schema.trainingRecords.id, mutedRecord));
    expect(row?.reminderSentAt).not.toBeNull();
  });

  it('NP-TR3: inapp:training_expiry muted — email still sent, no bell row', async () => {
    await setPrefs(holderId, { 'inapp:training_expiry': false });
    const reqId = await requirement(60);
    await record({ requirementId: reqId, expiresInDays: 7 });

    const notify = vi.fn().mockResolvedValue(undefined);
    expect(await runOk(notify)).toBe(1);
    expect(await bellRows(holderId)).toHaveLength(0);
  });

  it('NP-TR4: recorder variant — email plus a training_expiry_recorder bell row for the recorder', async () => {
    const reqId = await requirement(60);
    await record({
      requirementId: reqId,
      expiresInDays: 3,
      userId: null,
      personName: 'Agency Alan',
    });

    const notify = vi.fn().mockResolvedValue(undefined);
    expect(await runOk(notify)).toBe(1);
    expect((notify.mock.calls[0]?.[0] as DueTrainingReminder).viaRecorder).toBe(true);

    const rows = await bellRows(recorderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('training_expiry_recorder');
    expect(rows[0]?.title).toContain('Agency Alan');
  });

  it('NP-TR5: email:training_expiry_recorder muted — no email, bell row written, stamp lands', async () => {
    await setPrefs(recorderId, { 'email:training_expiry_recorder': false });
    const reqId = await requirement(60);
    const recordId = await record({
      requirementId: reqId,
      expiresInDays: 3,
      userId: null,
      personName: 'Agency Alan',
    });

    const notify = vi.fn().mockResolvedValue(undefined);
    expect(await runOk(notify)).toBe(0);
    expect(notify).not.toHaveBeenCalled();

    const rows = await bellRows(recorderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('training_expiry_recorder');

    const [row] = await db
      .select()
      .from(schema.trainingRecords)
      .where(eq(schema.trainingRecords.id, recordId));
    expect(row?.reminderSentAt).not.toBeNull();
  });

  it('NP-TR6: inapp:training_expiry_recorder muted — email still sent, no bell row', async () => {
    await setPrefs(recorderId, { 'inapp:training_expiry_recorder': false });
    const reqId = await requirement(60);
    await record({
      requirementId: reqId,
      expiresInDays: 3,
      userId: null,
      personName: 'Agency Alan',
    });

    const notify = vi.fn().mockResolvedValue(undefined);
    expect(await runOk(notify)).toBe(1);
    expect(await bellRows(recorderId)).toHaveLength(0);
  });
});
