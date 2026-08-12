/**
 * Unit tests for the incident immediate alert (FreeHS module B5).
 *
 * Edge cases:
 *   - IN-J02: routing — serious severity or an always-alert kind fans
 *     out to `incidents.manage` holders; the payload is confidential-
 *     safe (no title/description); site-curated teams narrow the
 *     audience with a safe fallback; the stamp dedupes replays.
 *   - IN-J02d (HSE review IN-A1): total delivery failure leaves the
 *     stamp clear and throws (BullMQ retries); the retry that succeeds
 *     stamps; partial delivery stamps rather than duplicating.
 *   - IN-J02f..h: per-user notification prefs gate each channel
 *     (`incident_alert`); a muted email counts as handled — an all-muted
 *     audience stamps instead of throwing — and the bell row stays as
 *     confidential-safe as the email.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIncidentAlert, type AlertIncident, type IncidentAlertDeps } from './incident-alert';

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

describe('incident-alert', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let managerId: string;
  let siteId: string;
  let sent: Array<{ to: string; incident: AlertIncident }>;

  function deps(): IncidentAlertDeps {
    return {
      db: db as never,
      logger,
      appUrl: 'https://freehs.test',
      notify: async (recipient, incident) => {
        sent.push({ to: recipient.email, incident });
      },
    };
  }

  async function seedIncident(
    patch: Partial<typeof schema.incidents.$inferInsert> = {},
  ): Promise<string> {
    const id = newId();
    await db.insert(schema.incidents).values({
      id,
      tenantId,
      referenceNumber: `IN-${id.slice(-6)}`,
      title: 'SECRET TITLE — must never appear in alert payloads',
      kind: 'injury',
      severity: 'serious',
      status: 'reported',
      occurredAt: new Date('2026-07-10T08:00:00Z'),
      reportedByUserId: managerId,
      siteId,
      confidential: true,
      ...patch,
    });
    return id;
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    sent = [];
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    adminId = `usr_${newId()}`;
    managerId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Alice Admin',
        email: `alice-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: managerId,
        name: 'Mark Manager',
        email: `mark-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.manager,
      },
    ]);
    siteId = newId();
    await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'Refinery' });
  });

  afterEach(async () => {
    await client.close();
  });

  it('IN-J02: fans out to manage holders with a confidential-safe payload', async () => {
    const id = await seedIncident();
    const result = await runIncidentAlert(deps(), { tenantId, incidentId: id });
    expect(result.notified).toBe(2); // admin + manager both hold incidents.manage
    // Confidential-safe: the AlertIncident surface has no title field at all.
    for (const call of sent) {
      expect(JSON.stringify(call.incident)).not.toContain('SECRET TITLE');
      expect(call.incident.referenceNumber).toMatch(/^IN-/);
    }
    // Stamp + event written; a replayed job is a no-op.
    const row = await db
      .select({ alertSentAt: schema.incidents.alertSentAt })
      .from(schema.incidents)
      .where(eq(schema.incidents.id, id));
    expect(row[0]?.alertSentAt).not.toBeNull();
    sent = [];
    const replay = await runIncidentAlert(deps(), { tenantId, incidentId: id });
    expect(replay.notified).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('IN-J02b: re-checks routing against the current row', async () => {
    const calm = await seedIncident({ severity: 'minor', kind: 'injury' });
    const result = await runIncidentAlert(deps(), { tenantId, incidentId: calm });
    expect(result.notified).toBe(0);
    // Always-alert kind fires even at negligible severity.
    const sharps = await seedIncident({ severity: 'negligible', kind: 'sharps_exposure' });
    const result2 = await runIncidentAlert(deps(), { tenantId, incidentId: sharps });
    expect(result2.notified).toBe(2);
  });

  it('IN-J02c: a curated site team narrows the audience, with fallback', async () => {
    await db.insert(schema.siteMembers).values({ tenantId, siteId, userId: managerId });
    const id = await seedIncident();
    await runIncidentAlert(deps(), { tenantId, incidentId: id });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toContain('mark-');

    // A team with no manage-holders falls back to every holder.
    const otherSite = newId();
    await db.insert(schema.sites).values({ id: otherSite, tenantId, name: 'Depot' });
    const stranger = `usr_${newId()}`;
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    await db.insert(schema.user).values({
      id: stranger,
      name: 'Standard Sam',
      email: `sam-${tenantId}@acme.test`,
      tenantId,
      permissionSetId: sets.standard,
    });
    await db.insert(schema.siteMembers).values({ tenantId, siteId: otherSite, userId: stranger });
    sent = [];
    const id2 = await seedIncident({ siteId: otherSite });
    await runIncidentAlert(deps(), { tenantId, incidentId: id2 });
    expect(sent).toHaveLength(2); // fallback: both manage holders
  });

  it('IN-J02d: total delivery failure never stamps — the retry delivers (IN-A1)', async () => {
    const id = await seedIncident();
    const failing: IncidentAlertDeps = {
      ...deps(),
      notify: async () => {
        throw new Error('smtp 451 temporarily unavailable');
      },
    };
    // Every send fails → the run throws (so BullMQ retries) and the
    // stamp + event stay unwritten.
    await expect(runIncidentAlert(failing, { tenantId, incidentId: id })).rejects.toThrow(
      /all 2 deliveries failed/,
    );
    const after = await db
      .select({ alertSentAt: schema.incidents.alertSentAt })
      .from(schema.incidents)
      .where(eq(schema.incidents.id, id));
    expect(after[0]?.alertSentAt).toBeNull();
    const events = await db
      .select({ kind: schema.incidentEvents.kind })
      .from(schema.incidentEvents)
      .where(eq(schema.incidentEvents.incidentId, id));
    expect(events.filter((e) => e.kind === 'alert_sent')).toHaveLength(0);

    // The retry (working transport) fans out and stamps exactly once.
    const result = await runIncidentAlert(deps(), { tenantId, incidentId: id });
    expect(result.notified).toBe(2);
    const stamped = await db
      .select({ alertSentAt: schema.incidents.alertSentAt })
      .from(schema.incidents)
      .where(eq(schema.incidents.id, id));
    expect(stamped[0]?.alertSentAt).not.toBeNull();
  });

  it('IN-J02f: default prefs — every holder gets the email AND a confidential-safe bell row', async () => {
    const id = await seedIncident();
    const result = await runIncidentAlert(deps(), { tenantId, incidentId: id });
    expect(result.notified).toBe(2);
    const bells = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, 'incident_alert'));
    expect(bells.map((b) => b.userId).sort()).toEqual([adminId, managerId].sort());
    for (const bell of bells) {
      // Same confidential-safe fields as the email — never the title.
      expect(bell.title).not.toContain('SECRET TITLE');
      expect(bell.body).not.toContain('SECRET TITLE');
      expect(bell.title).toMatch(/IN-/);
      expect(bell.href).toBe(`/incidents/${id}`);
    }
  });

  it('IN-J02g: email:incident_alert=false mutes that holder only; bell + stamp still land', async () => {
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'email:incident_alert': false } })
      .where(eq(schema.user.id, managerId));
    const id = await seedIncident();
    const result = await runIncidentAlert(deps(), { tenantId, incidentId: id });
    expect(result.notified).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toContain('alice-');
    // The muted holder still gets the bell row…
    const managerBells = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, managerId));
    expect(managerBells).toHaveLength(1);
    // …and the stamp lands (dedupe holds).
    const row = await db
      .select({ alertSentAt: schema.incidents.alertSentAt })
      .from(schema.incidents)
      .where(eq(schema.incidents.id, id));
    expect(row[0]?.alertSentAt).not.toBeNull();

    // EVERY holder muted: handled, not failed — no IN-A1 throw, and the
    // stamp lands so the alert never re-enqueues forever.
    await db.update(schema.user).set({ notificationPrefs: { 'email:incident_alert': false } });
    const allMuted = await seedIncident();
    sent = [];
    const result2 = await runIncidentAlert(deps(), { tenantId, incidentId: allMuted });
    expect(result2.notified).toBe(0);
    expect(sent).toHaveLength(0);
    const mutedRow = await db
      .select({ alertSentAt: schema.incidents.alertSentAt })
      .from(schema.incidents)
      .where(eq(schema.incidents.id, allMuted));
    expect(mutedRow[0]?.alertSentAt).not.toBeNull();
  });

  it('IN-J02h: inapp:incident_alert=false suppresses the bell row; the email still sends', async () => {
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'inapp:incident_alert': false } })
      .where(eq(schema.user.id, managerId));
    const id = await seedIncident();
    const result = await runIncidentAlert(deps(), { tenantId, incidentId: id });
    expect(result.notified).toBe(2);
    const managerBells = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, managerId));
    expect(managerBells).toHaveLength(0);
    const adminBells = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, adminId));
    expect(adminBells).toHaveLength(1);
  });

  it('IN-J02e: partial delivery stamps — a re-send would duplicate for the delivered', async () => {
    const id = await seedIncident();
    let calls = 0;
    const flaky: IncidentAlertDeps = {
      ...deps(),
      notify: async (recipient, incident) => {
        calls += 1;
        if (calls === 1) throw new Error('one mailbox bounced');
        sent.push({ to: recipient.email, incident });
      },
    };
    const result = await runIncidentAlert(flaky, { tenantId, incidentId: id });
    expect(result.notified).toBe(1);
    const row = await db
      .select({ alertSentAt: schema.incidents.alertSentAt })
      .from(schema.incidents)
      .where(eq(schema.incidents.id, id));
    expect(row[0]?.alertSentAt).not.toBeNull();
  });
});
