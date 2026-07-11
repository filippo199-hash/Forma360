/**
 * Contractors router — directory + derived company-wide compliance.
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

function futureDate(): string {
  return new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
}
function pastDate(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

describe('contractors router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;

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
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = newId();
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Admin',
      email: 'admin@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('derives compliance: blocking requirement needs a verified, unexpired doc', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: contractorId } = await caller.contractors.create({ name: 'Acme Electrical' });

    // No requirements yet → "no_requirements".
    let list = await caller.contractors.list();
    expect(list.find((c) => c.id === contractorId)?.complianceStatus).toBe('no_requirements');

    const { id: reqId } = await caller.contractors.addRequirement({
      contractorId,
      name: 'Public Liability Insurance',
      blocking: true,
    });

    // Blocking requirement, no doc → non_compliant.
    list = await caller.contractors.list();
    expect(list.find((c) => c.id === contractorId)?.complianceStatus).toBe('non_compliant');

    // Uploaded but pending → still non_compliant.
    const { id: docId } = await caller.contractors.addDocument({
      requirementId: reqId,
      storageKey: `${tenantId}/contractors/${contractorId}/insurance.pdf`,
      filename: 'insurance.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      endDate: futureDate(),
    });
    let got = await caller.contractors.get({ id: contractorId });
    expect(got.complianceStatus).toBe('non_compliant');

    // Verified + unexpired → compliant.
    await caller.contractors.verifyDocument({ id: docId });
    got = await caller.contractors.get({ id: contractorId });
    expect(got.complianceStatus).toBe('compliant');
    expect(got.requirements[0]?.satisfied).toBe(true);
  });

  it('an expired verified document does not satisfy the requirement', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: contractorId } = await caller.contractors.create({ name: 'NewCo' });
    const { id: reqId } = await caller.contractors.addRequirement({
      contractorId,
      name: 'Insurance',
      blocking: true,
    });
    const { id: docId } = await caller.contractors.addDocument({
      requirementId: reqId,
      storageKey: `${tenantId}/contractors/${contractorId}/old.pdf`,
      filename: 'old.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      endDate: pastDate(),
    });
    await caller.contractors.verifyDocument({ id: docId });
    const got = await caller.contractors.get({ id: contractorId });
    expect(got.complianceStatus).toBe('non_compliant');
  });

  it('advisory requirements do not affect compliance', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: contractorId } = await caller.contractors.create({ name: 'Cleaners' });
    await caller.contractors.addRequirement({
      contractorId,
      name: 'Toolbox talk',
      blocking: false,
    });
    const got = await caller.contractors.get({ id: contractorId });
    // Only advisory requirements → no blocking ones → no_requirements (compliant-by-default).
    expect(got.complianceStatus).toBe('no_requirements');
  });
});
