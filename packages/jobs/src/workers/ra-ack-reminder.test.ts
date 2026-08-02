/**
 * Unit tests for the risk-assessment acknowledgement chase (A-3).
 *
 * Edge cases:
 *   - RA-J01: pending acks older than the grace period get one reminder,
 *     stamped so the next run skips them; acknowledged rows never remind
 *   - RA-J02: a close deadline skips the grace period; repeats fire only
 *     after the weekly cadence; inactive assessments never remind
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRaAckReminders, type PendingAckReminder } from './ra-ack-reminder';

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
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY_MS);

describe('ra-ack-reminder', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let permissionSetId: string;
  let assessmentId: string;

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

  async function seedAck(
    userId: string,
    patch: Partial<typeof schema.riskAssessmentAcknowledgements.$inferInsert> = {},
  ): Promise<void> {
    await db.insert(schema.riskAssessmentAcknowledgements).values({
      tenantId,
      assessmentId,
      userId,
      distributedAt: daysAgo(5),
      versionNumber: 1,
      ...patch,
    });
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    permissionSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: permissionSetId,
      tenantId,
      name: 'Standard',
      permissions: ['riskAssessments.view'],
    });
    assessmentId = newId();
    await db.insert(schema.riskAssessments).values({
      id: assessmentId,
      tenantId,
      referenceNumber: 'RA-0001',
      title: 'Manual handling',
      status: 'active',
      currentVersion: 1,
      publishedAt: daysAgo(10),
      createdBy: 'usr_creator',
    });
  });

  afterEach(async () => {
    await client.close();
  });

  function run(sentInto: PendingAckReminder[]) {
    return runRaAckReminders({
      db: db as never,
      logger,
      appUrl: 'https://app.test',
      notify: (r) => {
        sentInto.push(r);
        return Promise.resolve();
      },
      now: () => NOW,
    });
  }

  it('RA-J01: chases pending acks past the grace period exactly once per run', async () => {
    const pendingOld = await seedUser('Olga'); // distributed 5 days ago → due a chase
    const pendingFresh = await seedUser('Fred'); // distributed today → inside grace
    const acked = await seedUser('Anna'); // already acknowledged

    await seedAck(pendingOld);
    await seedAck(pendingFresh, { distributedAt: NOW });
    await seedAck(acked, { acknowledgedAt: daysAgo(1), acknowledgedVersion: 1 });

    const sent: PendingAckReminder[] = [];
    const count = await run(sent);
    expect(count).toBe(1);
    expect(sent[0]?.userId).toBe(pendingOld);
    expect(sent[0]?.title).toBe('Manual handling');

    // The stamp prevents a second send on the next run.
    const again: PendingAckReminder[] = [];
    expect(await run(again)).toBe(0);
    const row = await db
      .select()
      .from(schema.riskAssessmentAcknowledgements)
      .where(
        and(
          eq(schema.riskAssessmentAcknowledgements.userId, pendingOld),
          eq(schema.riskAssessmentAcknowledgements.assessmentId, assessmentId),
        ),
      );
    expect(row[0]?.lastReminderAt).not.toBeNull();
  });

  it('RA-J02: due-soon skips grace; weekly repeats; inactive assessments never remind', async () => {
    // Distributed today but due tomorrow → chased despite the grace period.
    const dueSoon = await seedUser('Dana');
    await seedAck(dueSoon, { distributedAt: NOW, dueAt: daysAhead(1) });

    // Reminded 8 days ago and still pending → repeat fires.
    const repeat = await seedUser('Rita');
    await seedAck(repeat, { distributedAt: daysAgo(20), lastReminderAt: daysAgo(8) });

    // Reminded 2 days ago → inside the weekly cadence, no send.
    const recent = await seedUser('Ricky');
    await seedAck(recent, { distributedAt: daysAgo(20), lastReminderAt: daysAgo(2) });

    // A pending ack on a draft assessment never reminds.
    const draftAssessment = newId();
    await db.insert(schema.riskAssessments).values({
      id: draftAssessment,
      tenantId,
      title: 'Draft one',
      status: 'draft',
      createdBy: 'usr_creator',
    });
    const draftUser = await seedUser('Drew');
    await db.insert(schema.riskAssessmentAcknowledgements).values({
      tenantId,
      assessmentId: draftAssessment,
      userId: draftUser,
      distributedAt: daysAgo(30),
      versionNumber: 1,
    });

    const sent: PendingAckReminder[] = [];
    const count = await run(sent);
    const sentIds = sent.map((s) => s.userId).sort();
    expect(count).toBe(2);
    expect(sentIds).toEqual([dueSoon, repeat].sort());
  });
});
