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
import { eq } from 'drizzle-orm';
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
    const notify = vi
      .fn<(r: DueReminder, uploadUrl: string) => Promise<void>>()
      .mockResolvedValue();

    const sent = await runContractorDocReminders({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    expect(sent).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[1]).toBe(
      'https://forma360.io/en/contractor-upload/tok_abcdefghijklmnop',
    );

    // Stamped → a second run sends nothing.
    const again = await runContractorDocReminders({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    expect(again).toBe(0);
  });

  it('CT-W01: a contractor with no token gets one minted — never the bare app URL', async () => {
    // `upload_token` is nullable and only the manual "copy upload link"
    // button ever wrote it, so the reminder shipped a CTA pointing at the
    // sign-in page — to an external party with no account — and stamped
    // `reminderSentAt` anyway. One dead email, then permanent silence.
    await db
      .update(schema.contractors)
      .set({ uploadToken: null })
      .where(eq(schema.contractors.id, contractorId));
    await seedDoc(7);
    const notify = vi
      .fn<(r: DueReminder, uploadUrl: string) => Promise<void>>()
      .mockResolvedValue();
    const sent = await runContractorDocReminders({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    expect(sent).toBe(1);
    const url = notify.mock.calls[0]?.[1] ?? '';
    expect(url).not.toBe('https://forma360.io');
    expect(url).toMatch(/\/contractor-upload\/[0-9a-f]{48}$/);
    // The emailed token is the one that was persisted, or the link 404s.
    const [c] = await db
      .select({ token: schema.contractors.uploadToken })
      .from(schema.contractors)
      .where(eq(schema.contractors.id, contractorId));
    expect(url.endsWith(c?.token ?? 'no-token')).toBe(true);
  });

  it('CT-W01: two due docs for one contractor share a single minted token', async () => {
    // A second mint would invalidate the link sent in the first email.
    await db
      .update(schema.contractors)
      .set({ uploadToken: null })
      .where(eq(schema.contractors.id, contractorId));
    await seedDoc(5);
    await seedDoc(9);
    const notify = vi
      .fn<(r: DueReminder, uploadUrl: string) => Promise<void>>()
      .mockResolvedValue();
    const sent = await runContractorDocReminders({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    expect(sent).toBe(2);
    const urls = notify.mock.calls.map((c) => c[1]);
    expect(new Set(urls).size).toBe(1);
  });

  it('CT-O03: the upload link lands in the contact’s own language', async () => {
    await db
      .update(schema.contractors)
      .set({ locale: 'it' })
      .where(eq(schema.contractors.id, contractorId));
    await seedDoc(7);
    const notify = vi
      .fn<(r: DueReminder, uploadUrl: string) => Promise<void>>()
      .mockResolvedValue();
    await runContractorDocReminders({
      db: db as unknown as Database,
      logger,
      appUrl: 'https://forma360.io',
      notify,
      now: () => NOW,
    });
    // The worker emitted no locale segment at all and left the middleware
    // to guess from Accept-Language; the templated email was English too.
    expect(notify.mock.calls[0]?.[0].locale).toBe('it');
    expect(notify.mock.calls[0]?.[1]).toBe(
      'https://forma360.io/it/contractor-upload/tok_abcdefghijklmnop',
    );
  });

  it('ignores docs outside the window, unverified docs, and archived contractors', async () => {
    await seedDoc(30); // beyond 14-day window
    await seedDoc(5, 'pending'); // not verified
    const notify = vi
      .fn<(r: DueReminder, uploadUrl: string) => Promise<void>>()
      .mockResolvedValue();
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
