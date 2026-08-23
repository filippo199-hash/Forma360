/**
 * Onboarding checklist router (UXW1-03/06).
 *
 * The checklist is derived, never stamped: each step must flip exactly
 * when the underlying register gains its first row, `dismiss` stamps
 * tenant settings, an unclaimed sandbox hides the card, and a
 * non-admin is refused outright.
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

describe('onboarding router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let standardUserId: string;
  let standardSetId: string;

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
    standardSetId = seeded.standard;
    adminUserId = newId();
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Admin',
      email: 'admin@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
    standardUserId = newId();
  });

  afterEach(async () => {
    await client.close();
  });

  it('starts with every step false and flips each step from its real register', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const before = await caller.onboarding.status();
    expect(before.steps).toEqual({
      sites: false,
      team: false,
      riskAssessment: false,
      template: false,
      qr: false,
    });
    expect(before.dismissed).toBe(false);
    expect(before.isSandbox).toBe(false);

    await db.insert(schema.sites).values({
      id: newId(),
      tenantId,
      name: 'Yard',
    });
    await db.insert(schema.invitations).values({
      id: newId(),
      tenantId,
      email: 'mick@acme.test',
      token: 'a'.repeat(64),
      permissionSetId: standardSetId,
      invitedByUserId: adminUserId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(schema.riskAssessments).values({
      id: newId(),
      tenantId,
      title: 'Working at height',
      status: 'active',
      createdBy: adminUserId,
    });
    await db.insert(schema.templates).values({
      id: newId(),
      tenantId,
      name: 'Site walk',
      status: 'published',
      createdBy: adminUserId,
    });
    await db.insert(schema.issueCategories).values({
      id: newId(),
      tenantId,
      name: 'Hazard',
      createdBy: adminUserId,
      publicShareToken: 'b'.repeat(64),
    });

    const after = await caller.onboarding.status();
    expect(after.steps).toEqual({
      sites: true,
      team: true,
      riskAssessment: true,
      template: true,
      qr: true,
    });
  });

  it('does not count drafts, expired invitations, or tokenless categories', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await db.insert(schema.riskAssessments).values({
      id: newId(),
      tenantId,
      title: 'Draft only',
      status: 'draft',
      createdBy: adminUserId,
    });
    await db.insert(schema.templates).values({
      id: newId(),
      tenantId,
      name: 'Draft template',
      status: 'draft',
      createdBy: adminUserId,
    });
    await db.insert(schema.invitations).values({
      id: newId(),
      tenantId,
      email: 'late@acme.test',
      token: 'c'.repeat(64),
      permissionSetId: standardSetId,
      invitedByUserId: adminUserId,
      expiresAt: new Date(Date.now() - 1000),
    });
    await db.insert(schema.issueCategories).values({
      id: newId(),
      tenantId,
      name: 'No QR yet',
      createdBy: adminUserId,
    });

    const status = await caller.onboarding.status();
    expect(status.steps).toEqual({
      sites: false,
      team: false,
      riskAssessment: false,
      template: false,
      qr: false,
    });
  });

  it('dismiss stamps tenant settings and status reports it', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await caller.onboarding.dismiss();

    const status = await caller.onboarding.status();
    expect(status.dismissed).toBe(true);

    const [row] = await db
      .select({ settings: schema.tenants.settings })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    expect(typeof row?.settings.onboardingDismissedAt).toBe('string');
  });

  it('reports an unclaimed sandbox so the card can stay out of the way', async () => {
    await db
      .update(schema.tenants)
      .set({ settings: { sandbox: { scenarioId: 'incident', refinementId: 'withRiddor' } } })
      .where(eq(schema.tenants.id, tenantId));
    const caller = createCaller(ctxFor(adminUserId));
    expect((await caller.onboarding.status()).isSandbox).toBe(true);

    await db
      .update(schema.tenants)
      .set({
        settings: {
          sandbox: {
            scenarioId: 'incident',
            refinementId: 'withRiddor',
            claimedAt: new Date().toISOString(),
          },
        },
      })
      .where(eq(schema.tenants.id, tenantId));
    expect((await caller.onboarding.status()).isSandbox).toBe(false);
  });

  it('refuses a caller without org.settings', async () => {
    await db.insert(schema.user).values({
      id: standardUserId,
      name: 'Standard',
      email: 'standard@acme.test',
      tenantId,
      permissionSetId: standardSetId,
    });
    const caller = createCaller(ctxFor(standardUserId));
    await expect(caller.onboarding.status()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.onboarding.dismiss()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
