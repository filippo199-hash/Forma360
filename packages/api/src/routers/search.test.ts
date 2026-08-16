/**
 * Global search router tests.
 *
 * NR3-06: contractor RAMS reviews were simply not a category — a pack
 * logged via `rams.reviews.submit` was unfindable by title, work
 * description or contractor name. These pin the new category and its
 * permission gate (mirrors `reviews.list`: `rams.view`).
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { createLogger } from '@forma360/shared/logger';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
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

const silentLogger = () =>
  createLogger({ service: 'search-test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

describe('search router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let restrictedId: string;

  function callerFor(userId: string) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'search@x.test', tenantId: tenantId as never },
      }),
    );
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    adminId = newId();
    restrictedId = newId();

    await db.insert(schema.tenants).values({
      id: tenantId,
      name: 'Acme Contracting',
      slug: tenantId.slice(-8).toLowerCase(),
    });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);

    // A set with no permissions at all — the negative for every gate.
    const emptySetId = newId();
    await db.insert(schema.permissionSets).values({
      id: emptySetId,
      tenantId,
      name: 'No access',
      permissions: [],
    });

    await db.insert(schema.user).values([
      {
        id: adminId,
        tenantId,
        name: 'Tom Whitfield',
        email: 'tom@acme.test',
        emailVerified: true,
        permissionSetId: sets.administrator,
      },
      {
        id: restrictedId,
        tenantId,
        name: 'Ned Nothing',
        email: 'ned@acme.test',
        emailVerified: true,
        permissionSetId: emptySetId,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  describe('NR3-06 contractor RAMS reviews', () => {
    async function makeReview(): Promise<string> {
      const contractorId = newId();
      await db.insert(schema.contractors).values({
        id: contractorId,
        tenantId,
        name: 'Specialist Services Ltd',
      });
      const { reviewId } = await callerFor(adminId).rams.reviews.submit({
        contractorId,
        title: 'Hot works pack',
        workDescription: 'Mobile welding and hot cutting near the loading bay',
      });
      return reviewId;
    }

    it('finds a review by title, work description and contractor name', async () => {
      const reviewId = await makeReview();
      const caller = callerFor(adminId);

      const byTitle = await caller.search.global({ query: 'Hot works' });
      expect(byTitle.ramsReviews).toEqual([
        { id: reviewId, title: 'Hot works pack', subtitle: 'Specialist Services Ltd' },
      ]);

      const byWork = await caller.search.global({ query: 'welding' });
      expect(byWork.ramsReviews.map((r) => r.id)).toContain(reviewId);

      const byContractor = await caller.search.global({ query: 'Specialist' });
      expect(byContractor.ramsReviews.map((r) => r.id)).toContain(reviewId);
    });

    it('returns nothing for a caller without rams.view', async () => {
      await makeReview();
      const result = await callerFor(restrictedId).search.global({ query: 'Hot works' });
      expect(result.ramsReviews).toEqual([]);
    });
  });
});
