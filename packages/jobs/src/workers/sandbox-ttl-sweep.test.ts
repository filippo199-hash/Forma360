/**
 * Sandbox TTL sweep tests (ADR 0017 — the deferred sweep, now real).
 *
 * Edge cases:
 *   - SB-T01: an unclaimed sandbox older than the TTL is swept — tenant
 *     archived, users deactivated, sessions deleted, sweptAt stamped.
 *   - SB-T02: claimed sandboxes, young sandboxes and ordinary tenants
 *     are untouched, however old.
 *   - SB-T03: idempotent — a second run sweeps nothing.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSandboxTtlSweep, SANDBOX_TTL_DAYS } from './sandbox-ttl-sweep';

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
const NOW = new Date('2026-08-19T04:10:00Z');
const DAY_MS = 86_400_000;

describe('sandbox-ttl-sweep', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
  });
  afterEach(async () => {
    await client.close();
  });

  async function seedTenant(opts: {
    sandbox: boolean;
    claimed?: boolean;
    ageDays: number;
  }): Promise<{ tenantId: string; userId: string; sessionId: string }> {
    const tenantId = newId();
    const settings = opts.sandbox
      ? {
          sandbox: {
            scenarioId: 'permit',
            refinementId: 'hotWork',
            ...(opts.claimed === true ? { claimedAt: NOW.toISOString() } : {}),
          },
        }
      : {};
    await db.insert(schema.tenants).values({
      id: tenantId,
      name: 'Demo workspace',
      slug: `demo-${tenantId.toLowerCase()}`,
      settings,
      createdAt: new Date(NOW.getTime() - opts.ageDays * DAY_MS),
    });
    const setId = newId();
    await db.insert(schema.permissionSets).values({
      id: setId,
      tenantId,
      name: 'Administrator (trial)',
      permissions: [],
    });
    const userId = newId();
    await db.insert(schema.user).values({
      id: userId,
      name: 'You',
      email: `${tenantId.toLowerCase()}@sandbox.invalid`,
      tenantId,
      permissionSetId: setId,
    });
    const sessionId = newId();
    await db.insert(schema.session).values({
      id: sessionId,
      userId,
      token: `tok-${sessionId}`,
      expiresAt: new Date(NOW.getTime() + 90 * DAY_MS),
    });
    return { tenantId, userId, sessionId };
  }

  it('SB-T01: sweeps a stale unclaimed sandbox end to end', async () => {
    const stale = await seedTenant({ sandbox: true, ageDays: SANDBOX_TTL_DAYS + 1 });

    const result = await runSandboxTtlSweep({ db: db as never, logger, now: () => NOW });
    expect(result).toEqual({ sweptTenants: 1, deactivatedUsers: 1, deletedSessions: 1 });

    const tenants = await db.select().from(schema.tenants);
    const swept = tenants.find((t) => t.id === stale.tenantId);
    expect(swept?.archivedAt).not.toBeNull();
    expect((swept?.settings as { sandbox?: { sweptAt?: string } }).sandbox?.sweptAt).toBe(
      NOW.toISOString(),
    );

    const users = await db.select().from(schema.user);
    expect(users.find((u) => u.id === stale.userId)?.deactivatedAt).not.toBeNull();

    const sessions = await db.select().from(schema.session);
    expect(sessions.find((s) => s.id === stale.sessionId)).toBeUndefined();
  });

  it('SB-T02: leaves claimed, young and ordinary tenants alone', async () => {
    const claimed = await seedTenant({
      sandbox: true,
      claimed: true,
      ageDays: SANDBOX_TTL_DAYS + 30,
    });
    const young = await seedTenant({ sandbox: true, ageDays: SANDBOX_TTL_DAYS - 1 });
    const ordinary = await seedTenant({ sandbox: false, ageDays: 365 });

    const result = await runSandboxTtlSweep({ db: db as never, logger, now: () => NOW });
    expect(result.sweptTenants).toBe(0);

    const sessions = await db.select().from(schema.session);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(claimed.sessionId);
    expect(ids).toContain(young.sessionId);
    expect(ids).toContain(ordinary.sessionId);

    const users = await db.select().from(schema.user);
    for (const u of users) expect(u.deactivatedAt).toBeNull();
  });

  it('SB-T03: a second run sweeps nothing', async () => {
    await seedTenant({ sandbox: true, ageDays: SANDBOX_TTL_DAYS + 1 });
    const first = await runSandboxTtlSweep({ db: db as never, logger, now: () => NOW });
    expect(first.sweptTenants).toBe(1);
    const second = await runSandboxTtlSweep({ db: db as never, logger, now: () => NOW });
    expect(second).toEqual({ sweptTenants: 0, deactivatedUsers: 0, deletedSessions: 0 });
  });
});
