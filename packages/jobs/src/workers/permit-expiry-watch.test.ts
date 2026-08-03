/**
 * Unit tests for the permit expiry watch (FreeHS module B3).
 *
 * Edge cases:
 *   - PW-J01: open permits past validTo escalate exactly once — stamped,
 *     event-logged, and every distinct party (issuer, acceptor,
 *     authoriser) notified; closed / cancelled / draft / future permits
 *     never escalate
 *   - PW-J02: the stamp dedupes the next run; deactivated parties are
 *     skipped; a notify failure still stamps (no double escalation)
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
import {
  runPermitExpiryWatch,
  type ExpiredOpenPermit,
  type PermitWatchKind,
} from './permit-expiry-watch';

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
const HOUR_MS = 3_600_000;
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * HOUR_MS);
const hoursAhead = (n: number) => new Date(NOW.getTime() + n * HOUR_MS);

describe('permit-expiry-watch', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let permissionSetId: string;
  let typeId: string;
  let issuerId: string;
  let acceptorId: string;
  let authoriserId: string;

  async function seedUser(name: string, deactivated = false): Promise<string> {
    const id = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id,
      name,
      email: `${name.toLowerCase()}-${id}@acme.test`,
      tenantId,
      permissionSetId,
      ...(deactivated ? { deactivatedAt: NOW } : {}),
    });
    return id;
  }

  async function seedPermit(
    patch: Partial<typeof schema.permits.$inferInsert> = {},
  ): Promise<string> {
    const id = newId();
    await db.insert(schema.permits).values({
      id,
      tenantId,
      permitTypeId: typeId,
      referenceNumber: 'PTW-0001',
      title: 'Vessel entry',
      status: 'active',
      validFrom: hoursAgo(6),
      validTo: hoursAgo(1),
      issuerUserId: issuerId,
      acceptorUserId: acceptorId,
      authoriserUserId: authoriserId,
      createdBy: issuerId,
      ...patch,
    });
    return id;
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
      permissions: ['permits.view'],
    });
    issuerId = await seedUser('Ivy');
    acceptorId = await seedUser('Adam');
    authoriserId = await seedUser('Axel');
    typeId = newId();
    await db.insert(schema.permitTypes).values({
      id: typeId,
      tenantId,
      category: 'confined_space',
      name: 'Confined space entry',
      createdBy: issuerId,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  function run(
    sentInto: Array<{ kind: PermitWatchKind; permit: ExpiredOpenPermit; email: string }>,
    failFor?: string,
  ) {
    return runPermitExpiryWatch({
      db: db as never,
      logger,
      appUrl: 'https://app.test',
      notify: (kind, permit, recipient) => {
        if (failFor !== undefined && recipient.email.startsWith(failFor)) {
          return Promise.reject(new Error('smtp down'));
        }
        sentInto.push({ kind, permit, email: recipient.email });
        return Promise.resolve();
      },
      now: () => NOW,
    });
  }

  type Sent = Array<{ kind: PermitWatchKind; permit: ExpiredOpenPermit; email: string }>;

  it('PW-J01: escalates open permits past validTo once, notifying every party', async () => {
    const expired = await seedPermit();
    await seedPermit({ status: 'closed', closedAt: NOW }); // closed → never
    await seedPermit({ status: 'cancelled', cancelledAt: NOW }); // cancelled → never
    await seedPermit({ status: 'draft' }); // draft → never
    await seedPermit({ validTo: hoursAhead(2) }); // still valid → never

    const sent: Sent = [];
    const { escalated } = await run(sent);
    expect(escalated).toBe(1);
    // Issuer + acceptor + authoriser, all distinct.
    expect(sent).toHaveLength(3);
    expect(sent.every((s) => s.permit.permitId === expired && s.kind === 'escalation')).toBe(true);

    const row = await db.select().from(schema.permits).where(eq(schema.permits.id, expired));
    expect(row[0]?.expiryEscalatedAt).not.toBeNull();

    const events = await db
      .select()
      .from(schema.permitEvents)
      .where(
        and(
          eq(schema.permitEvents.permitId, expired),
          eq(schema.permitEvents.kind, 'expiry_escalated'),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.actorUserId).toBe('system');
  });

  it('PW-J02: the stamp dedupes; deactivated parties skipped; notify failure still stamps', async () => {
    // A suspended permit past its window escalates too — suspension is
    // exactly the "changed conditions" case the practitioner worries about.
    const ghost = await seedUser('Ghost', true);
    const suspendedPermit = await seedPermit({
      status: 'suspended',
      acceptorUserId: ghost,
      // Issuer doubles as authoriser — recipients must dedupe.
      authoriserUserId: issuerId,
    });

    const sent: Sent = [];
    const first = await run(sent);
    expect(first.escalated).toBe(1);
    // Ghost is deactivated; issuer==authoriser dedupes → exactly one email.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.permit.permitId).toBe(suspendedPermit);

    // Second run: nothing new — the stamp holds.
    const sentAgain: Sent = [];
    expect((await run(sentAgain)).escalated).toBe(0);
    expect(sentAgain).toHaveLength(0);

    // A notify failure must not block the stamp (no re-escalation loop).
    const failing = await seedPermit({ title: 'Roof edge work' });
    const sentWithFailure: Sent = [];
    const { escalated } = await run(sentWithFailure, 'ivy');
    expect(escalated).toBe(1);
    const row = await db.select().from(schema.permits).where(eq(schema.permits.id, failing));
    expect(row[0]?.expiryEscalatedAt).not.toBeNull();
    // The other two parties still got their email.
    expect(sentWithFailure.filter((s) => s.permit.permitId === failing)).toHaveLength(2);
  });

  it('PW-J03: warns once inside the lead window; a warned permit still escalates later', async () => {
    // Closes in 30 min → inside the 60-min lead window.
    const closingSoon = await seedPermit({
      validTo: new Date(NOW.getTime() + 30 * 60_000),
    });
    // Closes in 2 h → outside the lead window, untouched.
    await seedPermit({ validTo: hoursAhead(2) });
    // Already overdue → escalation, never a warning.
    const overdue = await seedPermit({ validTo: hoursAgo(1) });

    const sent: Sent = [];
    const first = await run(sent);
    expect(first.warned).toBe(1);
    expect(first.escalated).toBe(1);
    const warnings = sent.filter((s) => s.kind === 'warning');
    expect(warnings).toHaveLength(3); // issuer + acceptor + authoriser
    expect(warnings.every((s) => s.permit.permitId === closingSoon)).toBe(true);
    expect(
      sent.filter((s) => s.kind === 'escalation').every((s) => s.permit.permitId === overdue),
    ).toBe(true);

    const row = await db.select().from(schema.permits).where(eq(schema.permits.id, closingSoon));
    expect(row[0]?.expiryWarningSentAt).not.toBeNull();
    const events = await db
      .select()
      .from(schema.permitEvents)
      .where(
        and(
          eq(schema.permitEvents.permitId, closingSoon),
          eq(schema.permitEvents.kind, 'expiry_warning'),
        ),
      );
    expect(events).toHaveLength(1);

    // Second run: warning stamp holds, nothing new.
    const sentAgain: Sent = [];
    const second = await run(sentAgain);
    expect(second.warned).toBe(0);
    expect(sentAgain.filter((s) => s.kind === 'warning')).toHaveLength(0);

    // Once the warned permit lapses, the escalation still fires (its own stamp).
    await db
      .update(schema.permits)
      .set({ validTo: hoursAgo(1) })
      .where(eq(schema.permits.id, closingSoon));
    const sentThird: Sent = [];
    const third = await run(sentThird);
    expect(third.escalated).toBe(1);
    expect(
      sentThird.filter((s) => s.kind === 'escalation' && s.permit.permitId === closingSoon),
    ).toHaveLength(3);
  });
});
