/**
 * Claiming a sandbox workspace.
 *
 * Edge-case IDs:
 *   SB-E30 — status reports an unclaimed sandbox.
 *   SB-E31 — claim swaps the placeholder address for a real one and
 *            stamps claimedAt.
 *   SB-E32 — claim renames the workspace when a company name is given.
 *   SB-E33 — claiming twice is refused.
 *   SB-E34 — an address already in use is refused as a fork, not a crash.
 *   SB-E35 — claiming a non-sandbox tenant is refused.
 *   SB-E36 — a colleague on the same work domain is surfaced so the UI
 *            can offer "ask to join" instead of stranding them.
 *   SB-E37 — status on an ordinary tenant reports not-a-sandbox.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { createLogger } from '@forma360/shared/logger';
import { newId } from '@forma360/shared/id';
import { eq } from 'drizzle-orm';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';
import { provisionSandbox } from '../sandbox/provision';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

async function bootDb(): Promise<{ db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { db };
}

const silentLogger = () => createLogger({ service: 'sbx-test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

describe('sandbox router', () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    ({ db } = await bootDb());
  });

  function callerFor(userId: string, tenantId: string, email = 'x@sandbox.invalid') {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email, tenantId: tenantId as never },
      }),
    );
  }

  async function newSandbox() {
    return provisionSandbox(db as never, silentLogger(), {
      brand: 'freehs',
      choice: { scenarioId: 'riskAssessment', refinementId: 'general' },
    });
  }

  it('SB-E30 — status reports an unclaimed sandbox', async () => {
    const { tenantId, userId } = await newSandbox();
    const status = await callerFor(userId, tenantId).sandbox.status();

    expect(status).toEqual({
      isSandbox: true,
      isClaimed: false,
      scenarioId: 'riskAssessment',
      refinementId: 'general',
    });
  });

  it('SB-E31 — claim swaps the placeholder address and stamps claimedAt', async () => {
    const { tenantId, userId } = await newSandbox();

    const result = await callerFor(userId, tenantId).sandbox.claim({
      email: 'Sam.Baker@Northgate.co.uk',
      name: 'Sam Baker',
    });
    expect(result.claimed).toBe(true);
    expect(result.existingTenant).toBeNull();

    const users = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    expect(users[0]?.email).toBe('sam.baker@northgate.co.uk');
    expect(users[0]?.name).toBe('Sam Baker');
    expect(users[0]?.firstName).toBe('Sam');
    expect(users[0]?.lastName).toBe('Baker');

    const status = await callerFor(userId, tenantId).sandbox.status();
    expect(status.isClaimed).toBe(true);
  });

  it('SB-E32 — claim renames the workspace when a company name is given', async () => {
    const { tenantId, userId } = await newSandbox();

    await callerFor(userId, tenantId).sandbox.claim({
      email: 'ops@northgate.co.uk',
      companyName: 'Northgate Facilities Ltd',
    });

    const rows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    expect(rows[0]?.name).toBe('Northgate Facilities Ltd');
    // The marker survives the rename — a claimed sandbox is an ordinary
    // tenant that merely remembers how it started.
    expect(rows[0]?.settings.sandbox?.scenarioId).toBe('riskAssessment');
  });

  it('SB-E33 — claiming twice is refused', async () => {
    const { tenantId, userId } = await newSandbox();
    const caller = callerFor(userId, tenantId);

    await caller.sandbox.claim({ email: 'first@northgate.co.uk' });
    await expect(caller.sandbox.claim({ email: 'second@northgate.co.uk' })).rejects.toThrow(
      /already-claimed/,
    );
  });

  it('SB-E34 — an address already in use is refused', async () => {
    const other = await newSandbox();
    await callerFor(other.userId, other.tenantId).sandbox.claim({ email: 'taken@northgate.co.uk' });

    const mine = await newSandbox();
    await expect(
      callerFor(mine.userId, mine.tenantId).sandbox.claim({ email: 'taken@northgate.co.uk' }),
    ).rejects.toThrow(/email-in-use/);

    // ...and the workspace is left untouched, so they can try another.
    const status = await callerFor(mine.userId, mine.tenantId).sandbox.status();
    expect(status.isClaimed).toBe(false);
  });

  it('SB-E35 — claiming a non-sandbox tenant is refused', async () => {
    const tenantId = newId();
    const userId = `usr_${newId()}`;
    await db
      .insert(schema.tenants)
      .values({ id: tenantId, name: 'Real co', slug: `real-${tenantId.slice(-6).toLowerCase()}` });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    await db.insert(schema.user).values({
      id: userId,
      name: 'Real user',
      email: 'real@northgate.co.uk',
      emailVerified: true,
      tenantId,
      permissionSetId: sets.administrator,
    });

    await expect(
      callerFor(userId, tenantId).sandbox.claim({ email: 'new@northgate.co.uk' }),
    ).rejects.toThrow(/not-a-sandbox/);
  });

  it('SB-E36 — a colleague on the same work domain is surfaced', async () => {
    const colleague = await newSandbox();
    await callerFor(colleague.userId, colleague.tenantId).sandbox.claim({
      email: 'priya@northgate.co.uk',
      companyName: 'Northgate Facilities Ltd',
    });

    const mine = await newSandbox();
    const result = await callerFor(mine.userId, mine.tenantId).sandbox.claim({
      email: 'sam@northgate.co.uk',
    });

    expect(result.existingTenant).not.toBeNull();
    expect(result.existingTenant?.name).toBe('Northgate Facilities Ltd');
    // The claim still succeeds — surfacing the neighbour is an offer,
    // not a block. Their work is never stranded behind a decision.
    expect(result.claimed).toBe(true);
  });

  it('SB-E37 — status on an ordinary tenant reports not-a-sandbox', async () => {
    const tenantId = newId();
    const userId = `usr_${newId()}`;
    await db
      .insert(schema.tenants)
      .values({ id: tenantId, name: 'Real co', slug: `real2-${tenantId.slice(-6).toLowerCase()}` });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    await db.insert(schema.user).values({
      id: userId,
      name: 'Real user',
      email: 'real2@northgate.co.uk',
      emailVerified: true,
      tenantId,
      permissionSetId: sets.administrator,
    });

    const status = await callerFor(userId, tenantId).sandbox.status();
    expect(status.isSandbox).toBe(false);
    expect(status.isClaimed).toBe(false);
  });
});
