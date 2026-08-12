/**
 * Notification centre + audit feed tests (platform review PF-23 / PF-31).
 *
 * Edge cases:
 *   - NT-E01: list/unreadCount/markRead/markAllRead operate strictly on
 *     the caller's own rows
 *   - NT-E02: notification prefs round-trip; unknown keys rejected
 *   - AU-E01: admin.auditLog requires org.audit.view, merges module event
 *     tables newest-first and honours the module filter
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import {
  NOTIFICATION_KINDS,
  notificationPrefKey,
} from '@forma360/shared/notification-catalogue';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import { notifyInApp, notifyInAppMany } from '../notify';
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

const silentLogger = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

describe('notifications + audit (PF-23 / PF-31)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let colleagueId: string;

  function callerFor(userId: string) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'n@x.test', tenantId: tenantId as never },
      }),
    );
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    adminId = `usr_${newId()}`;
    colleagueId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Alice Admin',
        email: `alice-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: colleagueId,
        name: 'Carl Colleague',
        email: `carl-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.standard,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('NT-E01: rows are strictly the caller own; mark-read flows work', async () => {
    await notifyInApp(db as never, {
      tenantId,
      userId: adminId,
      kind: 'action_assigned',
      title: 'Fix the door',
      href: '/actions/x',
    });
    await notifyInApp(db as never, {
      tenantId,
      userId: colleagueId,
      kind: 'heads_up',
      title: 'Storm warning',
    });

    const admin = callerFor(adminId);
    const colleague = callerFor(colleagueId);
    expect((await admin.notifications.unreadCount()).count).toBe(1);
    const adminList = await admin.notifications.list({ limit: 20, unreadOnly: false });
    expect(adminList.rows).toHaveLength(1);
    expect(adminList.rows[0]?.title).toBe('Fix the door');

    // Marking the other user's row is a silent no-op (scoped update).
    const colleagueRowId = (await colleague.notifications.list({ limit: 5, unreadOnly: false }))
      .rows[0]?.id;
    expect(colleagueRowId).toBeDefined();
    await admin.notifications.markRead({ id: colleagueRowId ?? '' });
    expect((await colleague.notifications.unreadCount()).count).toBe(1);

    await admin.notifications.markAllRead();
    expect((await admin.notifications.unreadCount()).count).toBe(0);
    expect((await colleague.notifications.unreadCount()).count).toBe(1);
  });

  it('NT-E02: prefs matrix defaults to all-enabled and round-trips per (kind, channel)', async () => {
    const caller = callerFor(adminId);
    const before = await caller.notifications.prefs();
    for (const kind of NOTIFICATION_KINDS) {
      expect(before.matrix[kind]).toEqual({ email: true, inapp: true });
    }

    await caller.notifications.setPref({ kind: 'action_due', channel: 'email', enabled: false });
    const after = await caller.notifications.prefs();
    // Only the one cell flips — the sibling channel and every other kind hold.
    expect(after.matrix['action_due']).toEqual({ email: false, inapp: true });
    expect(after.matrix['action_assigned']).toEqual({ email: true, inapp: true });

    await caller.notifications.setPref({ kind: 'action_due', channel: 'inapp', enabled: false });
    expect((await caller.notifications.prefs()).matrix['action_due']).toEqual({
      email: false,
      inapp: false,
    });
    await caller.notifications.setPref({ kind: 'action_due', channel: 'email', enabled: true });
    expect((await caller.notifications.prefs()).matrix['action_due']).toEqual({
      email: true,
      inapp: false,
    });

    await expect(
      // @ts-expect-error unknown kinds must be rejected at the boundary
      caller.notifications.setPref({ kind: 'not_a_kind', channel: 'email', enabled: false }),
    ).rejects.toThrow();
  });

  it('NT-E03: legacy PF-23 pref keys still resolve into the matrix', async () => {
    await db
      .update(schema.user)
      .set({ notificationPrefs: { emailScheduleMissed: false } })
      .where(eq(schema.user.id, adminId));
    const matrix = (await callerFor(adminId).notifications.prefs()).matrix;
    expect(matrix['schedule_missed']).toEqual({ email: false, inapp: true });
  });

  it('NT-E04: a muted inapp pref suppresses the bell row; muted email leaves it intact', async () => {
    await db
      .update(schema.user)
      .set({
        notificationPrefs: {
          [notificationPrefKey('heads_up', 'inapp')]: false,
          [notificationPrefKey('action_assigned', 'email')]: false,
        },
      })
      .where(eq(schema.user.id, adminId));

    await notifyInApp(db as never, {
      tenantId,
      userId: adminId,
      kind: 'heads_up',
      title: 'Muted kind',
    });
    await notifyInApp(db as never, {
      tenantId,
      userId: adminId,
      kind: 'action_assigned',
      title: 'Email muted only — bell still rings',
    });
    await notifyInAppMany(db as never, [adminId, colleagueId], {
      tenantId,
      kind: 'heads_up',
      title: 'Fan-out respects each recipient',
    });

    const adminRows = (
      await callerFor(adminId).notifications.list({ limit: 20, unreadOnly: false })
    ).rows;
    expect(adminRows.map((r) => r.kind)).toEqual(['action_assigned']);
    // The colleague has no mutes — the fan-out reached them.
    const colleagueRows = (
      await callerFor(colleagueId).notifications.list({ limit: 20, unreadOnly: false })
    ).rows;
    expect(colleagueRows.map((r) => r.kind)).toEqual(['heads_up']);
  });

  it('AU-E01: auditLog gated by org.audit.view; merges modules newest-first; filter works', async () => {
    // Standard set does NOT hold org.audit.view.
    await expect(callerFor(colleagueId).admin.auditLog()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // Seed one action-activity and one fire event.
    const actionId = newId();
    await db.insert(schema.actions).values({
      id: actionId,
      tenantId,
      sourceType: 'standalone',
      title: 'Task',
      status: 'open',
      createdBy: adminId,
    });
    await db.insert(schema.actionActivity).values({
      id: newId(),
      tenantId,
      actionId,
      actorUserId: adminId,
      kind: 'created',
      createdAt: new Date(Date.now() - 60_000),
    });
    await db.insert(schema.fireEvents).values({
      id: newId(),
      tenantId,
      entityType: 'building',
      entityId: newId(),
      actorUserId: adminId,
      kind: 'created',
      detail: 'Unit 4',
      createdAt: new Date(),
    });

    const admin = callerFor(adminId);
    const feed = await admin.admin.auditLog({ limit: 50, module: 'all' });
    const modules = feed.rows.map((r) => r.module);
    expect(modules).toContain('actions');
    expect(modules).toContain('fireSafety');
    // Newest first: the fire event is younger.
    expect(feed.rows[0]?.module).toBe('fireSafety');
    expect(feed.rows[0]?.actorName).toBe('Alice Admin');

    const onlyFire = await admin.admin.auditLog({ limit: 50, module: 'fireSafety' });
    expect(onlyFire.rows.every((r) => r.module === 'fireSafety')).toBe(true);
    expect(onlyFire.rows).toHaveLength(1);
  });
});
