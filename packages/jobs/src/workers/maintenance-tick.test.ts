/**
 * Unit tests for the maintenance tick's usage-plan evaluation (platform
 * review PF-18: usage-based plans never notified — the tick filtered
 * planType='time').
 *
 * Edge cases:
 *   - MA-J01: a meter reading past lastServiceValue + interval enqueues a
 *     "due" notify exactly once (dedup via notificationsLog); the 90%
 *     approach warning fires before the threshold; no reading → nothing
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
import {
  evaluateUsageLink,
  USAGE_APPROACHING_MARKER,
  USAGE_DUE_MARKER,
  type UsageLinkRow,
} from './maintenance-tick';

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

describe('maintenance-tick usage plans (PF-18)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let assetId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    assetId = newId();
    await db.insert(schema.assets).values({ id: assetId, tenantId, name: 'Van 1' });
  });

  afterEach(async () => {
    await client.close();
  });

  function linkRow(over: Partial<UsageLinkRow>): UsageLinkRow {
    return {
      id: newId(),
      tenantId,
      planId: newId(),
      assetId,
      lastServiceValue: '10000',
      intervalUsage: '1000',
      usageField: 'odometer',
      usageUnit: 'km',
      notificationDaysBefore: [7, 0],
      notificationsLog: null,
      ...over,
    };
  }

  async function reading(value: number): Promise<void> {
    await db.insert(schema.assetReadings).values({
      id: newId(),
      tenantId,
      assetId,
      fieldName: 'odometer',
      value: String(value),
    });
  }

  function captureQueue() {
    const added: Array<{ payload: Record<string, unknown>; opts: Record<string, unknown> }> = [];
    return {
      added,
      add: (_name: string, payload: object, opts: object) => {
        added.push({
          payload: payload as Record<string, unknown>,
          opts: opts as Record<string, unknown>,
        });
        return Promise.resolve(undefined);
      },
    };
  }

  it('MA-J01: due / approaching / dedup / no-reading', async () => {
    // No reading yet → nothing.
    const q0 = captureQueue();
    expect(await evaluateUsageLink(db as never, q0, linkRow({}), logger)).toBe(0);

    // 10 950 km: past 90% of the 10 000→11 000 cycle (10 900) → approaching.
    await reading(10_950);
    const q1 = captureQueue();
    expect(await evaluateUsageLink(db as never, q1, linkRow({}), logger)).toBe(1);
    expect(q1.added[0]?.payload['daysBefore']).toBe(USAGE_APPROACHING_MARKER);
    expect(q1.added[0]?.payload['dueDate']).toBe('usage:11000');
    expect(String(q1.added[0]?.payload['statusLabel'])).toMatch(/approaching/);

    // Same cycle, approach already logged → nothing more before threshold.
    const logged = { 'usage:11000': [USAGE_APPROACHING_MARKER] };
    const q2 = captureQueue();
    expect(
      await evaluateUsageLink(db as never, q2, linkRow({ notificationsLog: logged }), logger),
    ).toBe(0);

    // 11 200 km: past the threshold → due send (approach stamp irrelevant).
    await reading(11_200);
    const q3 = captureQueue();
    expect(
      await evaluateUsageLink(db as never, q3, linkRow({ notificationsLog: logged }), logger),
    ).toBe(1);
    expect(q3.added[0]?.payload['daysBefore']).toBe(USAGE_DUE_MARKER);
    expect(String(q3.added[0]?.payload['statusLabel'])).toMatch(/due/);
    expect(q3.added[0]?.payload['dueLabel']).toBe('at 11000 km');

    // Due already logged → silent.
    const q4 = captureQueue();
    expect(
      await evaluateUsageLink(
        db as never,
        q4,
        linkRow({ notificationsLog: { 'usage:11000': [USAGE_DUE_MARKER] } }),
        logger,
      ),
    ).toBe(0);
  });
});
