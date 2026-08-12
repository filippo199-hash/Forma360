/**
 * Unit tests for the observation-notify worker handler.
 *
 * Notification-preference edge cases (settings → notifications): the two
 * catalogue kinds this worker dispatches — `observation_notification` and
 * `observation_critical` — are each gated per recipient on both channels.
 * Only recipients with a user row are gated; a free-text address has no
 * preference to hold, so it is always emailed and never belled.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createObservationNotifyHandler } from './observation-notify';

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

describe('observation-notify worker', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let categoryId: string;
  let issueId: string;
  let userA: string;
  let userB: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme-ob' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    userA = `usr_${newId()}`;
    userB = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: userA,
        name: 'Ann',
        email: 'ann@acme.test',
        tenantId,
        permissionSetId: seeded.standard,
      },
      {
        id: userB,
        name: 'Ben',
        email: 'ben@acme.test',
        tenantId,
        permissionSetId: seeded.standard,
      },
    ]);
    categoryId = newId();
    const spec = { broadcastToAll: false, groupIds: [], siteIds: [], userIds: [userA, userB] };
    await db.insert(schema.issueCategories).values({
      id: categoryId,
      tenantId,
      name: 'Hazards',
      notificationRule: 'summary',
      criticalAlerts: true,
      notificationRecipientSpec: spec,
      criticalAlertRecipientSpec: spec,
      createdBy: userA,
    });
    issueId = newId();
    await db.insert(schema.issues).values({
      id: issueId,
      tenantId,
      categoryId,
      title: 'Leaking hydraulic line',
      referenceNumber: 'ISS-000007',
      categorySnapshot: { categoryId, name: 'Hazards', customFields: [], customQuestions: [] },
      accessSnapshot: {
        groupIds: [],
        siteIds: [],
        permissions: [],
        snapshotAt: new Date().toISOString(),
      },
    });
  });

  afterEach(async () => {
    await client.close();
  });

  function fakeJob(isCritical: boolean): Job<{
    tenantId: string;
    issueId: string;
    isCritical: boolean;
  }> {
    return {
      id: 'job-ob',
      queueName: 'forma360-observation-notify',
      data: { tenantId, issueId, isCritical },
    } as unknown as Job<{ tenantId: string; issueId: string; isCritical: boolean }>;
  }

  function makeHandler(sendTemplatedEmail: ReturnType<typeof vi.fn>) {
    return createObservationNotifyHandler({
      db: db as unknown as Database,
      logger,
      sendTemplatedEmail: sendTemplatedEmail as unknown as SendTemplatedEmail,
      appUrl: 'https://forma360.test',
    });
  }

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

  it('NP-OB1: default prefs — one email per recipient and an observation_notification bell row each', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await makeHandler(send)(fakeJob(false));
    expect(result.sent).toBe(2);
    expect(send.mock.calls.map((c) => (c[0] as { to: string }).to).sort()).toEqual([
      'ann@acme.test',
      'ben@acme.test',
    ]);
    expect((send.mock.calls[0]?.[0] as { templateKey: string }).templateKey).toBe(
      'observation-notification',
    );

    for (const userId of [userA, userB]) {
      const rows = await bellRows(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('observation_notification');
      expect(rows[0]?.title).toBe('Leaking hydraulic line');
      expect(rows[0]?.href).toBe(`/observations/${issueId}`);
    }
  });

  it('NP-OB2: email:observation_notification muted — no email for them, others still mailed, bell row written', async () => {
    await setPrefs(userA, { 'email:observation_notification': false });
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await makeHandler(send)(fakeJob(false));
    expect(result.sent).toBe(1);
    expect(send.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(['ben@acme.test']);

    const rows = await bellRows(userA);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('observation_notification');
  });

  it('NP-OB3: inapp:observation_notification muted — email still sent, no bell row', async () => {
    await setPrefs(userA, { 'inapp:observation_notification': false });
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await makeHandler(send)(fakeJob(false));
    expect(result.sent).toBe(2);
    expect(await bellRows(userA)).toHaveLength(0);
    expect(await bellRows(userB)).toHaveLength(1);
  });

  it('NP-OB4: critical path — critical template and observation_critical bell rows', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await makeHandler(send)(fakeJob(true));
    expect(result.sent).toBe(2);
    expect((send.mock.calls[0]?.[0] as { templateKey: string }).templateKey).toBe(
      'observation-critical-alert',
    );
    const rows = await bellRows(userA);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('observation_critical');
  });

  it('NP-OB5: email:observation_critical muted — no critical email for them, bell row written', async () => {
    // Muting routine observation email must NOT mute the critical alert —
    // the kinds are independent, so only the critical key silences it.
    await setPrefs(userA, {
      'email:observation_notification': false,
      'email:observation_critical': false,
    });
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await makeHandler(send)(fakeJob(true));
    expect(result.sent).toBe(1);
    expect(send.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(['ben@acme.test']);

    const rows = await bellRows(userA);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('observation_critical');
  });

  it('NP-OB6: inapp:observation_critical muted — email still sent, no bell row', async () => {
    await setPrefs(userA, { 'inapp:observation_critical': false });
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await makeHandler(send)(fakeJob(true));
    expect(result.sent).toBe(2);
    expect(await bellRows(userA)).toHaveLength(0);
  });

  it('NP-OB7: muting the routine kind does not mute the critical alert', async () => {
    await setPrefs(userA, {
      'email:observation_notification': false,
      'inapp:observation_notification': false,
    });
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await makeHandler(send)(fakeJob(true));
    expect(result.sent).toBe(2);
    const rows = await bellRows(userA);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('observation_critical');
  });
});
