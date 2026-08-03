/**
 * Unit tests for the action reminder digest (platform HSE review PF-4).
 *
 * Edge cases:
 *   - AC-J01: one digest per assignee covering overdue + due-soon;
 *     due-soon stamps once (no repeat tomorrow); overdue re-pings only
 *     after the weekly cadence; unassigned / undated / closed /
 *     archived actions never remind
 *   - AC-J02: a failed send withholds every stamp for that assignee
 *     (tomorrow retries); other assignees still get theirs
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runActionReminders, type DueActionRow } from './action-reminders';

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
const NOW = new Date('2026-08-03T06:30:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY_MS);

type Sent = Array<{ to: string; overdue: DueActionRow[]; dueSoon: DueActionRow[] }>;

describe('action-reminders', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let permissionSetId: string;
  let aliceId: string;
  let bobId: string;

  async function seedUser(name: string): Promise<string> {
    const id = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id,
      name,
      email: `${name.toLowerCase()}-${id}@acme.test`,
      tenantId,
      permissionSetId,
    });
    return id;
  }

  async function seedAction(over: Partial<typeof schema.actions.$inferInsert>): Promise<string> {
    const id = newId();
    await db.insert(schema.actions).values({
      id,
      tenantId,
      sourceType: 'standalone',
      title: over.title ?? 'Fix it',
      status: 'open',
      createdBy: aliceId,
      ...over,
    });
    return id;
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    permissionSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: permissionSetId,
      tenantId,
      name: 'Standard',
      permissions: ['actions.view'],
    });
    aliceId = await seedUser('Alice');
    bobId = await seedUser('Bob');
  });

  afterEach(async () => {
    await client.close();
  });

  function run(sent: Sent, failFor?: string) {
    return runActionReminders({
      db: db as never,
      logger,
      appUrl: 'https://app.test',
      notify: (recipient, payload) => {
        if (failFor !== undefined && recipient.email.startsWith(failFor)) {
          return Promise.reject(new Error('smtp down'));
        }
        sent.push({ to: recipient.email, overdue: payload.overdue, dueSoon: payload.dueSoon });
        return Promise.resolve();
      },
      now: () => NOW,
    });
  }

  it('AC-J01: digests per assignee; due-soon once; overdue weekly; noise excluded', async () => {
    const overdueId = await seedAction({
      title: 'Guard rail',
      assigneeUserId: aliceId,
      dueAt: daysAgo(2),
    });
    const dueSoonId = await seedAction({
      title: 'Sign SOP',
      assigneeUserId: aliceId,
      dueAt: daysAhead(2),
    });
    // Noise: no assignee / no due date / completed / archived / far future.
    await seedAction({ dueAt: daysAgo(5) });
    await seedAction({ assigneeUserId: aliceId });
    await seedAction({ assigneeUserId: aliceId, dueAt: daysAgo(1), status: 'completed' });
    await seedAction({ assigneeUserId: aliceId, dueAt: daysAgo(1), archivedAt: NOW });
    await seedAction({ assigneeUserId: aliceId, dueAt: daysAhead(10) });

    const sent: Sent = [];
    const first = await run(sent);
    expect(first.emails).toBe(1);
    expect(first.reminded).toBe(2);
    expect(sent[0]?.overdue.map((r) => r.actionId)).toEqual([overdueId]);
    expect(sent[0]?.dueSoon.map((r) => r.actionId)).toEqual([dueSoonId]);

    // Next day: due-soon already warned; overdue inside the weekly window.
    const tomorrow: Sent = [];
    const second = await runActionReminders({
      db: db as never,
      logger,
      appUrl: 'https://app.test',
      notify: (r, p) => {
        tomorrow.push({ to: r.email, overdue: p.overdue, dueSoon: p.dueSoon });
        return Promise.resolve();
      },
      now: () => new Date(NOW.getTime() + DAY_MS),
    });
    expect(second.emails).toBe(0);
    expect(tomorrow).toHaveLength(0);

    // Eight days on: the overdue action re-pings; due-soon (now overdue,
    // never overdue-pinged) joins it.
    const nextWeek: Sent = [];
    const third = await runActionReminders({
      db: db as never,
      logger,
      appUrl: 'https://app.test',
      notify: (r, p) => {
        nextWeek.push({ to: r.email, overdue: p.overdue, dueSoon: p.dueSoon });
        return Promise.resolve();
      },
      now: () => new Date(NOW.getTime() + 8 * DAY_MS),
    });
    expect(third.emails).toBe(1);
    expect(nextWeek[0]?.overdue.map((r) => r.actionId).sort()).toEqual(
      [overdueId, dueSoonId].sort(),
    );
  });

  it('AC-J02: a failed send withholds stamps; other assignees unaffected', async () => {
    const aliceAction = await seedAction({
      title: 'Alice task',
      assigneeUserId: aliceId,
      dueAt: daysAgo(1),
    });
    await seedAction({ title: 'Bob task', assigneeUserId: bobId, dueAt: daysAgo(1) });

    const sent: Sent = [];
    const result = await run(sent, 'alice');
    expect(result.emails).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to.startsWith('bob')).toBe(true);

    // Alice's action is unstamped — tomorrow retries her digest.
    const row = await db
      .select({ overdueRemindedAt: schema.actions.overdueRemindedAt })
      .from(schema.actions)
      .where(eq(schema.actions.id, aliceAction));
    expect(row[0]?.overdueRemindedAt).toBeNull();

    const retry: Sent = [];
    const second = await runActionReminders({
      db: db as never,
      logger,
      appUrl: 'https://app.test',
      notify: (r, p) => {
        retry.push({ to: r.email, overdue: p.overdue, dueSoon: p.dueSoon });
        return Promise.resolve();
      },
      now: () => new Date(NOW.getTime() + DAY_MS),
    });
    expect(second.emails).toBe(1);
    expect(retry[0]?.to.startsWith('alice')).toBe(true);
  });
});
