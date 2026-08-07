/**
 * Unit tests for the contractor overstay (>24h on site) alert.
 */
import { readFile, readdir } from 'node:fs/promises';
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runContractorOverstayAlerts,
  type OverstayRecipient,
  type OverstayVisit,
} from './contractor-overstay';

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
const NOW = new Date('2026-07-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('contractor-overstay', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let contractorId: string;
  let adminId: string;
  let adminSetId: string;

  async function seedVisit(opts: {
    checkedInHoursAgo: number;
    status?: 'checked_in' | 'checked_out';
    visitorName?: string;
    createdByUserId?: string;
    alerted?: boolean;
  }) {
    const id = newId();
    await db.insert(schema.contractorVisits).values({
      id,
      tenantId,
      contractorId,
      title: 'Rewire',
      visitorName: opts.visitorName ?? null,
      status: opts.status ?? 'checked_in',
      scheduledStart: hoursAgo(opts.checkedInHoursAgo),
      checkedInAt: hoursAgo(opts.checkedInHoursAgo),
      createdByUserId: opts.createdByUserId ?? null,
      overstayAlertedAt: opts.alerted ? NOW : null,
    });
    return id;
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    // An admin (org.settings) doubles as a gate guard recipient.
    adminId = newId();
    adminSetId = seeded.administrator;
    await db.insert(schema.user).values({
      id: adminId,
      name: 'Guard',
      email: 'guard@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
    contractorId = newId();
    await db.insert(schema.contractors).values({ id: contractorId, tenantId, name: 'Sparky' });
  });

  afterEach(async () => {
    await client.close();
  });

  it('alerts inviter + gate guard for a >24h visit, once, then dedupes', async () => {
    // Inviter is a separate user.
    const inviterId = newId();
    const [permissionSet] = await db
      .select({ id: schema.permissionSets.id })
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.tenantId, tenantId))
      .limit(1);
    if (!permissionSet) throw new Error('expected a seeded permission set for the tenant');
    await db.insert(schema.user).values({
      id: inviterId,
      name: 'Boss',
      email: 'boss@acme.test',
      tenantId,
      permissionSetId: permissionSet.id,
    });
    const visitId = await seedVisit({
      checkedInHoursAgo: 30,
      visitorName: 'Alice',
      createdByUserId: inviterId,
    });

    const notify = vi
      .fn<(v: OverstayVisit, r: OverstayRecipient, url: string) => Promise<void>>()
      .mockResolvedValue();
    const alerted = await runContractorOverstayAlerts({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    expect(alerted).toBe(1);
    const recipients = notify.mock.calls.map((c) => c[1].email).sort();
    // Inviter (boss) + gate guard (admin), de-duplicated.
    expect(recipients).toEqual(['boss@acme.test', 'guard@acme.test']);
    expect(notify.mock.calls[0]?.[0].visitorName).toBe('Alice');

    // Second run: already stamped → no further alerts.
    notify.mockClear();
    const again = await runContractorOverstayAlerts({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    expect(again).toBe(0);
    expect(notify).not.toHaveBeenCalled();

    const [row] = await db
      .select({ at: schema.contractorVisits.overstayAlertedAt })
      .from(schema.contractorVisits)
      .where(eq(schema.contractorVisits.id, visitId));
    expect(row?.at).not.toBeNull();
  });

  it('CT-O02: one failing recipient still reaches the rest, and still stamps', async () => {
    // The per-recipient loop had no inner catch, so the first rejection
    // threw past every remaining recipient AND past the stamp — and the
    // next hourly tick then re-mailed everyone who had already received it.
    const inviterId = newId();
    const [permissionSet] = await db
      .select({ id: schema.permissionSets.id })
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.tenantId, tenantId))
      .limit(1);
    if (!permissionSet) throw new Error('expected a seeded permission set for the tenant');
    await db.insert(schema.user).values({
      id: inviterId,
      name: 'Boss',
      email: 'boss@acme.test',
      tenantId,
      permissionSetId: permissionSet.id,
    });
    const visitId = await seedVisit({ checkedInHoursAgo: 30, createdByUserId: inviterId });

    const notify = vi
      .fn<(v: OverstayVisit, r: OverstayRecipient, url: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('550 mailbox unavailable'))
      .mockResolvedValue();
    const alerted = await runContractorOverstayAlerts({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    expect(alerted).toBe(1);
    expect(notify).toHaveBeenCalledTimes(2);
    const [row] = await db
      .select({ at: schema.contractorVisits.overstayAlertedAt })
      .from(schema.contractorVisits)
      .where(eq(schema.contractorVisits.id, visitId));
    expect(row?.at).not.toBeNull();
  });

  it('CT-O02: total delivery failure withholds the stamp so the next tick retries', async () => {
    const visitId = await seedVisit({ checkedInHoursAgo: 30 });
    const notify = vi
      .fn<(v: OverstayVisit, r: OverstayRecipient, url: string) => Promise<void>>()
      .mockRejectedValue(new Error('provider down'));
    const alerted = await runContractorOverstayAlerts({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    expect(alerted).toBe(0);
    const [row] = await db
      .select({ at: schema.contractorVisits.overstayAlertedAt })
      .from(schema.contractorVisits)
      .where(eq(schema.contractorVisits.id, visitId));
    expect(row?.at).toBeNull();
  });

  it('CT-O03: each recipient gets their own locale and a link in their own language', async () => {
    await db.update(schema.user).set({ locale: 'it' }).where(eq(schema.user.id, adminId));
    await seedVisit({ checkedInHoursAgo: 30 });

    const notify = vi
      .fn<(v: OverstayVisit, r: OverstayRecipient, url: string) => Promise<void>>()
      .mockResolvedValue();
    await runContractorOverstayAlerts({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    // The board link used to be hardcoded `/en/contractors` for everyone.
    const call = notify.mock.calls.find((c) => c[1].email === 'guard@acme.test');
    expect(call?.[1].locale).toBe('it');
    expect(call?.[2]).toBe('https://forma360.io/it/contractors');
  });

  it('CT-O04: a curated site team narrows the gate audience, and falls back when empty', async () => {
    // A second guard who is NOT on the site's team.
    const otherGuardId = newId();
    const [adminSet] = await db
      .select({ id: schema.permissionSets.id })
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.id, adminSetId));
    if (!adminSet) throw new Error('expected the seeded administrator set');
    await db.insert(schema.user).values({
      id: otherGuardId,
      name: 'Other guard',
      email: 'other@acme.test',
      tenantId,
      permissionSetId: adminSet.id,
    });

    const siteId = newId();
    await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'Depot' });
    await db.insert(schema.siteMembers).values({ tenantId, siteId, userId: adminId });

    const visitId = newId();
    await db.insert(schema.contractorVisits).values({
      id: visitId,
      tenantId,
      contractorId,
      siteId,
      title: 'Rewire',
      status: 'checked_in',
      scheduledStart: hoursAgo(30),
      checkedInAt: hoursAgo(30),
    });

    const notify = vi
      .fn<(v: OverstayVisit, r: OverstayRecipient, url: string) => Promise<void>>()
      .mockResolvedValue();
    await runContractorOverstayAlerts({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    // Only the guard who is actually on that site's team. Mailing every
    // holder in the tenant leaked which contractor was at which site.
    expect(notify.mock.calls.map((c) => c[1].email)).toEqual(['guard@acme.test']);

    // A site with no curated team falls back to every holder — a
    // mis-curated site must never swallow an overstay alert.
    const emptySiteId = newId();
    await db.insert(schema.sites).values({ id: emptySiteId, tenantId, name: 'Yard' });
    await db.insert(schema.contractorVisits).values({
      id: newId(),
      tenantId,
      contractorId,
      siteId: emptySiteId,
      title: 'Survey',
      status: 'checked_in',
      scheduledStart: hoursAgo(30),
      checkedInAt: hoursAgo(30),
    });
    notify.mockClear();
    await runContractorOverstayAlerts({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    expect(notify.mock.calls.map((c) => c[1].email).sort()).toEqual([
      'guard@acme.test',
      'other@acme.test',
    ]);
  });

  it('ignores recent visits, checked-out visits, and already-alerted visits', async () => {
    await seedVisit({ checkedInHoursAgo: 3 }); // still fresh
    await seedVisit({ checkedInHoursAgo: 40, status: 'checked_out' }); // left
    await seedVisit({ checkedInHoursAgo: 40, alerted: true }); // already alerted

    const notify = vi
      .fn<(v: OverstayVisit, r: OverstayRecipient, url: string) => Promise<void>>()
      .mockResolvedValue();
    const alerted = await runContractorOverstayAlerts({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    expect(alerted).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});
