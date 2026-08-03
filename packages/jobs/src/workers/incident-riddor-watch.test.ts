/**
 * Unit tests for the RIDDOR deadline watch (FreeHS module B5).
 *
 * Edge cases:
 *   - IN-J01: the ladder fires warning5 → warning2 → escalation exactly
 *     once each, notify-then-stamp (a failed send leaves the stamp clear
 *     so the next tick retries), and skips not-reportable / submitted /
 *     cancelled incidents. The 2-day pass suppresses a same-tick 5-day
 *     duplicate.
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
import {
  runIncidentRiddorWatch,
  type RiddorWatchDeps,
  type RiddorWatchKind,
} from './incident-riddor-watch';

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
const NOW = new Date('2026-07-11T09:00:00Z');
const DAY_MS = 86_400_000;

describe('incident-riddor-watch', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let managerId: string;
  let sent: Array<{ kind: RiddorWatchKind; ref: string; to: string }>;

  function deps(failFor?: string): RiddorWatchDeps {
    return {
      db: db as never,
      logger,
      appUrl: 'https://freehs.test',
      notify: async (kind, incident, recipient) => {
        if (failFor !== undefined && incident.referenceNumber === failFor) {
          throw new Error('smtp down');
        }
        sent.push({ kind, ref: incident.referenceNumber, to: recipient.email });
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
      referenceNumber: patch.referenceNumber ?? `IN-${id.slice(-6)}`,
      title: 'Watch test',
      kind: 'injury',
      status: 'triaged',
      occurredAt: new Date(NOW.getTime() - 10 * DAY_MS),
      reportedByUserId: managerId,
      riddorCategory: 'over_7_day',
      riddorDeadlineAt: new Date(NOW.getTime() + 4 * DAY_MS),
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
    managerId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: managerId,
      name: 'Mark Manager',
      email: `mark-${tenantId}@acme.test`,
      tenantId,
      permissionSetId: sets.manager,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('IN-J01: ladder fires once per rung with correct bucketing', async () => {
    const w5 = await seedIncident({
      referenceNumber: 'IN-000001',
      riddorDeadlineAt: new Date(NOW.getTime() + 4 * DAY_MS),
    });
    await seedIncident({
      referenceNumber: 'IN-000002',
      riddorDeadlineAt: new Date(NOW.getTime() + 1 * DAY_MS),
    });
    await seedIncident({
      referenceNumber: 'IN-000003',
      riddorDeadlineAt: new Date(NOW.getTime() - 1 * DAY_MS),
    });
    // Out of scope: negative determination, already submitted, cancelled.
    await seedIncident({ referenceNumber: 'IN-000004', riddorCategory: 'not_reportable', riddorDeadlineAt: null });
    await seedIncident({ referenceNumber: 'IN-000005', riddorSubmittedAt: NOW });
    await seedIncident({
      referenceNumber: 'IN-000006',
      status: 'cancelled',
      riddorDeadlineAt: new Date(NOW.getTime() - 1 * DAY_MS),
    });

    const result = await runIncidentRiddorWatch(deps(), NOW);
    expect(result).toEqual({ warned5: 1, warned2: 1, escalated: 1 });
    expect(sent.map((s) => `${s.kind}:${s.ref}`).sort()).toEqual([
      'escalation:IN-000003',
      'warning2:IN-000002',
      'warning5:IN-000001',
    ]);

    // Stamps written; a second tick is quiet.
    const row = await db
      .select({ w5: schema.incidents.riddorWarning5SentAt })
      .from(schema.incidents)
      .where(eq(schema.incidents.id, w5));
    expect(row[0]?.w5).not.toBeNull();
    sent = [];
    const second = await runIncidentRiddorWatch(deps(), NOW);
    expect(second).toEqual({ warned5: 0, warned2: 0, escalated: 0 });
    expect(sent).toHaveLength(0);

    // Events logged by the system actor.
    const events = await db
      .select()
      .from(schema.incidentEvents)
      .where(eq(schema.incidentEvents.tenantId, tenantId));
    expect(events.filter((e) => e.kind === 'riddor_escalated')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'riddor_warning_sent')).toHaveLength(2);
    expect(events.every((e) => e.actorUserId === 'system')).toBe(true);
  });

  it('IN-J01b: notify-then-stamp — a failed send retries next tick', async () => {
    await seedIncident({
      referenceNumber: 'IN-000007',
      riddorDeadlineAt: new Date(NOW.getTime() - 1 * DAY_MS),
    });
    const first = await runIncidentRiddorWatch(deps('IN-000007'), NOW);
    expect(first.escalated).toBe(0); // every send failed → no stamp
    const retry = await runIncidentRiddorWatch(deps(), NOW);
    expect(retry.escalated).toBe(1); // clear stamp → retried and delivered
    expect(sent.some((s) => s.kind === 'escalation' && s.ref === 'IN-000007')).toBe(true);
  });
});
