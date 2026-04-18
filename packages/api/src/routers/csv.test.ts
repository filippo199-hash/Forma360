/**
 * Integration tests for users.bulkImport (S-E05) and users.listExport (S-10).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { createLogger } from '@forma360/shared/logger';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { createTestContext, type Context } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');
const MIGRATION_FILES = [
  '0000_initial.sql',
  '0001_auth.sql',
  '0002_permissions.sql',
  '0003_phase1_org_backbone.sql',
];

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of MIGRATION_FILES) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { client, db };
}

const createCaller = createCallerFactory(appRouter);
const silent = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

describe('users.bulkImport + listExport', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
      auth: { userId, email: 'a@x', tenantId: tenantId as never },
    });
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Alice',
      email: 'alice@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('creates new users via CSV and reports the count (S-E05)', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const csv = `email,name,permissionSet
bob@acme.test,Bob,Standard
carol@acme.test,Carol,Manager`;
    const result = await caller.users.bulkImport({ csv, dryRun: false });
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.errorCount).toBe(0);

    const users = await db.select().from(schema.user);
    expect(users).toHaveLength(3); // admin + 2 new
  });

  it('updates existing users by email (upsert semantics — S-E05)', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const csv1 = `email,name,permissionSet
bob@acme.test,Bob,Standard`;
    const r1 = await caller.users.bulkImport({ csv: csv1, dryRun: false });
    expect(r1.created).toBe(1);

    const csv2 = `email,name,permissionSet
bob@acme.test,Bob Updated,Manager`;
    const r2 = await caller.users.bulkImport({ csv: csv2, dryRun: false });
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);

    const { eq } = await import('drizzle-orm');
    const [bob] = await db.select().from(schema.user).where(eq(schema.user.email, 'bob@acme.test'));
    expect(bob?.name).toBe('Bob Updated');
  });

  it('reports per-row errors with line numbers (G-E05)', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const csv = `email,name,permissionSet
not-an-email,Bob,Standard
carol@acme.test,,Manager
dave@acme.test,Dave,NonExistent`;
    const result = await caller.users.bulkImport({ csv, dryRun: false });
    expect(result.created).toBe(0);
    expect(result.errorCount).toBe(3);
    expect(result.rejectedCsv).toMatch(/^line,error/);
  });

  it('resolves groups + sites by name and rejects unknown ones', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await caller.groups.create({ name: 'Auditors' });
    await caller.sites.create({ name: 'Manchester' });

    const csv = `email,name,permissionSet,groups,sites
bob@acme.test,Bob,Standard,Auditors,Manchester
carol@acme.test,Carol,Standard,Ghosts,Manchester`;
    const result = await caller.users.bulkImport({ csv, dryRun: false });
    expect(result.created).toBe(1); // only Bob
    expect(result.errorCount).toBe(1);
    expect(result.errors[0]?.message).toMatch(/Ghosts/);
  });

  it('dryRun does not write any rows', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const csv = `email,name,permissionSet
bob@acme.test,Bob,Standard`;
    const result = await caller.users.bulkImport({ csv, dryRun: true });
    expect(result.created).toBe(1);
    const users = await db.select().from(schema.user);
    expect(users).toHaveLength(1); // only the admin seeded in beforeEach
  });

  it('listExport returns a CSV with headers + one row per user', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await caller.users.bulkImport({
      csv: `email,name,permissionSet
bob@acme.test,Bob,Standard`,
      dryRun: false,
    });
    const { csv } = await caller.users.listExport();
    expect(csv).toMatch(/^id,name,email,permissionSet,groups,sites,activatedAt,deactivatedAt/);
    expect(csv).toContain('alice@acme.test');
    expect(csv).toContain('bob@acme.test');
  });

  it('listExport groups + sites columns concatenate membership names', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: gid } = await caller.groups.create({ name: 'Auditors' });
    await caller.groups.addMember({ groupId: gid, userId: adminUserId });

    const { csv } = await caller.users.listExport();
    const aliceRow = csv.split('\n').find((line) => line.includes('alice@acme.test'));
    expect(aliceRow).toMatch(/Auditors/);
  });
});
