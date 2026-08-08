/**
 * Documents — the expiry reminder worker, audited (FreeHS).
 *
 * Companion to `packages/api/src/routers/documents.audit.test.ts`. The worker
 * already had one test covering the happy path (remind at each threshold,
 * skip far-future and archived documents). These cover the paths that decide
 * whether the reminder is worth anything to the person who receives it —
 * which is where every worker defect in this codebase has lived.
 *
 * Two of the three assertions here pin behaviour that is already RIGHT, and
 * deliberately so: the contractors audit found a worker whose per-recipient
 * failure blocked the stamp and re-mailed everyone on the next run, and this
 * worker gets that exact case correct. Behaviour that good should not be
 * able to regress silently.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDocumentExpiry, type ExpiringDocument } from './document-expiry';

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
const APP_URL = 'https://freehs.software';
const DAY = 86_400_000;

describe('document-expiry — audit', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let ownerId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Northgate', slug: 'northgate' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    ownerId = newId();
    await db.insert(schema.user).values({
      id: ownerId,
      tenantId,
      name: 'Otto Owner',
      email: 'owner@northgate.test',
      permissionSetId: seeded.administrator,
      // A French-speaking responsible person: the whole point of carrying a
      // locale on the recipient is that the message arrives in it.
      locale: 'fr',
    });
  });

  afterEach(async () => {
    await client.close();
  });

  async function seedExpiring(daysOut: number): Promise<string> {
    const id = newId();
    await db.insert(schema.documents).values({
      id,
      tenantId,
      name: 'Employer liability certificate',
      storageKey: `${tenantId}/documents/${id}/f.pdf`,
      filename: 'f.pdf',
      mimeType: 'application/pdf',
      uploadedByUserId: ownerId,
      responsibleUserId: ownerId,
      expiresAt: new Date(NOW.getTime() + daysOut * DAY),
      reminderDays: [30, 7],
    });
    return id;
  }

  it('DOC-A01 · the reminder link lands in the recipient own locale', async () => {
    // `viewUrl` is built as `${appUrl}/en/documents/${id}` in the worker and
    // the recipient's locale is carried alongside it but never used to build
    // the path. FreeHS ships ten UI locales and six email locales, so a
    // French-speaking document owner gets a correctly translated email
    // pointing at the English page.
    //
    // This is the same defect as training TR-A9 and contractors CT-O03 —
    // the third worker in three audited modules to hardcode `/en/`, which
    // makes it a platform pattern rather than three coincidences.
    await seedExpiring(5);
    const seen: Array<{ locale: string | null | undefined; url: string }> = [];
    await runDocumentExpiry({
      db: db as unknown as Database,
      logger,
      appUrl: APP_URL,
      now: () => NOW,
      notify: async (recipient, _doc: ExpiringDocument, viewUrl: string) => {
        seen.push({ locale: recipient.locale, url: viewUrl });
      },
    });

    const french = seen.find((r) => r.locale === 'fr');
    expect(french).toBeDefined();
    expect(french?.url).toContain('/fr/');
  });

  it('DOC-A02 · one failed recipient does not block the stamp for the others', async () => {
    // Already correct, and pinned because the contractors overstay worker
    // got exactly this wrong: recipients looped inside the try with the
    // stamp outside it, so one bad mailbox re-mailed everybody every run.
    // Here the try is per-recipient and the stamp is guarded by a delivered
    // count instead.
    const docId = await seedExpiring(5);
    const second = newId();
    await db.insert(schema.user).values({
      id: second,
      tenantId,
      name: 'Bad Mailbox',
      email: 'bounces@northgate.test',
      permissionSetId: (
        await db
          .select({ id: schema.user.permissionSetId })
          .from(schema.user)
          .where(eq(schema.user.id, ownerId))
      )[0]?.id as string,
    });
    await db
      .update(schema.documents)
      .set({ responsibleUserId: second })
      .where(eq(schema.documents.id, docId));

    let calls = 0;
    await runDocumentExpiry({
      db: db as unknown as Database,
      logger,
      appUrl: APP_URL,
      now: () => NOW,
      notify: async () => {
        calls += 1;
        throw new Error('mailbox full');
      },
    });

    // Nobody was told, so nothing may be stamped — otherwise the reminder is
    // lost permanently.
    const [row] = await db
      .select({ last: schema.documents.lastExpiryReminderAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, docId));
    expect({ attempted: calls > 0, stamped: row?.last !== null }).toEqual({
      attempted: true,
      stamped: false,
    });
  });

  it('DOC-A03 · a document already reminded at a threshold is not chased again for it', async () => {
    const docId = await seedExpiring(5);
    const deps = {
      db: db as unknown as Database,
      logger,
      appUrl: APP_URL,
      now: () => NOW,
      notify: async () => {},
    };
    const first = await runDocumentExpiry(deps);
    const second = await runDocumentExpiry(deps);
    expect({ first: first.reminded, second: second.reminded }).toEqual({ first: 1, second: 0 });
    const [row] = await db
      .select({ last: schema.documents.lastExpiryReminderAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, docId));
    expect(row?.last).not.toBeNull();
  });
});
