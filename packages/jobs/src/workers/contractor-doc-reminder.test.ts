/**
 * Unit tests for the contractor compliance-document expiry reminder.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runContractorDocReminders, type DueReminder } from './contractor-doc-reminder';

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
const NOW = new Date('2026-07-11T00:00:00Z');
function isoIn(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

describe('contractor-doc-reminder', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let contractorId: string;
  let reqId: string;

  async function seedDoc(endInDays: number, status: 'verified' | 'pending' = 'verified') {
    const id = newId();
    await db.insert(schema.contractorDocuments).values({
      id,
      tenantId,
      contractorId,
      requirementId: reqId,
      storageKey: `${tenantId}/contractor-docs/${contractorId}/f.pdf`,
      filename: 'f.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      endDate: isoIn(endInDays),
      status,
    });
    return id;
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    contractorId = newId();
    await db.insert(schema.contractors).values({
      id: contractorId,
      tenantId,
      name: 'Acme Electrical',
      primaryContactEmail: 'contact@acme.test',
      uploadToken: 'tok_abcdefghijklmnop',
    });
    reqId = newId();
    await db.insert(schema.contractorRequirements).values({
      id: reqId,
      tenantId,
      contractorId,
      name: 'Insurance',
      blocking: true,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('sends one reminder for a doc expiring inside the window, then dedupes', async () => {
    await seedDoc(7);
    const notify = vi.fn<[DueReminder, string], Promise<void>>().mockResolvedValue();

    const sent = await runContractorDocReminders({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io/en',
      notify,
      now: () => NOW,
    });
    expect(sent).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[1]).toContain('/contractor-upload/tok_abcdefghijklmnop');

    // Stamped → a second run sends nothing.
    const again = await runContractorDocReminders({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io/en',
      notify,
      now: () => NOW,
    });
    expect(again).toBe(0);
  });

  it('ignores docs outside the window, unverified docs, and archived contractors', async () => {
    await seedDoc(30); // beyond 14-day window
    await seedDoc(5, 'pending'); // not verified
    const notify = vi.fn<[DueReminder, string], Promise<void>>().mockResolvedValue();
    const sent = await runContractorDocReminders({
      db: db as unknown as Database,
      logger,
      appUrl: 'x',
      notify,
      now: () => NOW,
    });
    expect(sent).toBe(0);
  });
});
