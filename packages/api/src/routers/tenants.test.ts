/**
 * Tenants router tests — updateBranding read-merge-write.
 *
 * Covers: setting the branding block, preserving unrelated settings keys,
 * clearing branding with an empty patch, and the org.settings gate.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
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

const createCaller = createCallerFactory(appRouter);
const silentLogger = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

describe('tenants.updateBranding', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let memberUserId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tenantId as never },
    });
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({
      id: tenantId,
      name: 'Acme',
      slug: 'acme',
      settings: { terminology: 'both' },
    });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = newId();
    memberUserId = newId();
    await db.insert(schema.user).values([
      {
        id: adminUserId,
        name: 'Admin',
        email: 'admin@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
      {
        id: memberUserId,
        name: 'Mia Member',
        email: 'mia@acme.test',
        tenantId,
        permissionSetId: seeded.standard,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('sets branding and preserves unrelated settings keys', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const res = await caller.tenants.updateBranding({
      logoStorageKey: `${tenantId}/branding/logo.png`,
      primaryColor: '#ff8800',
    });
    expect(res.settings.branding).toEqual({
      logoStorageKey: `${tenantId}/branding/logo.png`,
      primaryColor: '#ff8800',
    });
    // Unrelated key survives the merge.
    expect(res.settings.terminology).toBe('both');

    const [row] = await db
      .select({ settings: schema.tenants.settings })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    expect(row?.settings.branding?.primaryColor).toBe('#ff8800');
  });

  it('clears branding when the patch is empty', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await caller.tenants.updateBranding({ primaryColor: '#123456' });
    const cleared = await caller.tenants.updateBranding({});
    expect(cleared.settings.branding).toBeUndefined();
    expect(cleared.settings.terminology).toBe('both');
  });

  it('rejects a caller without org.settings', async () => {
    const caller = createCaller(ctxFor(memberUserId));
    await expect(caller.tenants.updateBranding({ primaryColor: '#123456' })).rejects.toThrow();
  });
});
