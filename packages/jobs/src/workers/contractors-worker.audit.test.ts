/**
 * Contractors — the two workers, audited (FreeHS).
 *
 * Companion to `packages/api/src/routers/contractors.audit.test.ts`. Both
 * contractor workers already had tests; those tests assert the happy path
 * (a due document is found, an overstay is alerted, the stamp dedupes).
 * These assert the paths that decide whether the notification is *worth
 * anything to the person who receives it* — which is where every worker
 * defect found in this codebase so far has lived.
 *
 * Tests titled `[BUG]` describe correct behaviour and fail against the
 * current implementation; they are the acceptance criteria for the fix pass.
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runContractorDocReminders, type DueReminder } from './contractor-doc-reminder';
import { runContractorOverstayAlerts, type OverstayVisit } from './contractor-overstay';

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

describe('contractors workers — audit', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let contractorId: string;
  let requirementId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    contractorId = newId();
    requirementId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Northgate', slug: 'northgate' });
    await db.insert(schema.contractors).values({
      id: contractorId,
      tenantId,
      name: 'Contractor 001 Ltd',
      primaryContactEmail: 'contact@contractor.test',
      // Deliberately NO uploadToken: this is the state every contractor is
      // created in, because `contractors.create` never mints one and the
      // only writer is the manual "generate link" button on the detail page.
    });
    await db.insert(schema.contractorRequirements).values({
      id: requirementId,
      tenantId,
      contractorId,
      name: 'Public Liability Insurance',
      blocking: true,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CT-W · document expiry reminder
  // ═══════════════════════════════════════════════════════════════════════
  describe('CT-W · document expiry reminder', () => {
    async function seedExpiringDoc(daysOut: number): Promise<string> {
      const id = newId();
      await db.insert(schema.contractorDocuments).values({
        id,
        tenantId,
        contractorId,
        requirementId,
        storageKey: `${tenantId}/contractor-docs/${contractorId}/pli.pdf`,
        filename: 'pli.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        endDate: new Date(NOW.getTime() + daysOut * 86_400_000).toISOString().slice(0, 10),
        status: 'verified',
      });
      return id;
    }

    it('CT-W01 · [BUG] the chase links somewhere the contractor can actually act', async () => {
      // With no upload token the worker degrades the CTA to the bare app
      // URL — a sign-in page the external contractor has no account for —
      // while the mail still says "Upload a new document". And because the
      // stamp happens regardless, that document is never chased again: one
      // wasted reminder, then silence, on a blocking insurance certificate.
      const docId = await seedExpiringDoc(10);
      const urls: string[] = [];
      const sent = await runContractorDocReminders({
        db: db as unknown as Database,
        logger,
        appUrl: APP_URL,
        now: () => NOW,
        notify: async (_r: DueReminder, uploadUrl: string) => {
          urls.push(uploadUrl);
        },
      });

      expect(sent).toBe(1);
      expect({ ctaLandsOnAnUploadPage: urls[0]?.includes('/contractor-upload/') === true }).toEqual({
        ctaLandsOnAnUploadPage: true,
      });

      const [row] = await db
        .select({ reminderSentAt: schema.contractorDocuments.reminderSentAt })
        .from(schema.contractorDocuments)
        .where(eq(schema.contractorDocuments.id, docId));
      expect(row?.reminderSentAt).not.toBeNull();
    });

    it('CT-W02 · a document already reminded is not chased twice', async () => {
      await seedExpiringDoc(10);
      const deps = {
        db: db as unknown as Database,
        logger,
        appUrl: APP_URL,
        now: () => NOW,
        notify: async () => {},
      };
      expect(await runContractorDocReminders(deps)).toBe(1);
      expect(await runContractorDocReminders(deps)).toBe(0);
    });

    it('CT-W03 · a failed send is retried on the next run rather than stamped', async () => {
      // notify-then-stamp: the stamp must only land after a successful send,
      // or the reminder is lost permanently.
      await seedExpiringDoc(10);
      let attempt = 0;
      const deps = {
        db: db as unknown as Database,
        logger,
        appUrl: APP_URL,
        now: () => NOW,
        notify: async () => {
          attempt += 1;
          if (attempt === 1) throw new Error('SMTP down');
        },
      };
      expect(await runContractorDocReminders(deps)).toBe(0);
      expect(await runContractorDocReminders(deps)).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CT-O · overstay alerts
  // ═══════════════════════════════════════════════════════════════════════
  describe('CT-O · overstay alerts', () => {
    let siteId: string;
    let otherSiteId: string;
    let inviterId: string;

    beforeEach(async () => {
      siteId = newId();
      otherSiteId = newId();
      await db.insert(schema.sites).values([
        { id: siteId, tenantId, name: 'North Yard' },
        { id: otherSiteId, tenantId, name: 'South Depot' },
      ]);
      const setId = newId();
      await db.insert(schema.permissionSets).values({
        id: setId,
        tenantId,
        name: 'Gate Watch',
        permissions: ['contractors.gate'],
      });
      inviterId = newId();
      await db.insert(schema.user).values([
        {
          id: inviterId,
          tenantId,
          name: 'Ivy Inviter',
          email: 'inviter@northgate.test',
          permissionSetId: setId,
        },
        {
          id: newId(),
          tenantId,
          name: 'Gus Guard',
          email: 'guard@northgate.test',
          permissionSetId: setId,
        },
      ]);
    });

    async function seedOverstay(hoursAgo: number, site = siteId): Promise<string> {
      const id = newId();
      await db.insert(schema.contractorVisits).values({
        id,
        tenantId,
        contractorId,
        siteId: site,
        title: 'Overrunning shutdown',
        visitorName: 'Dan Operative',
        status: 'checked_in',
        scheduledStart: new Date(NOW.getTime() - hoursAgo * 3_600_000),
        checkedInAt: new Date(NOW.getTime() - hoursAgo * 3_600_000),
        createdByUserId: inviterId,
      });
      return id;
    }

    it('CT-O01 · someone on site over the threshold is alerted, and someone fresh is not', async () => {
      const overstay = await seedOverstay(30);
      await seedOverstay(2);
      const alerted: string[] = [];
      const count = await runContractorOverstayAlerts({
        db: db as unknown as Database,
        logger,
        appUrl: APP_URL,
        now: () => NOW,
        notify: async (v: OverstayVisit) => {
          alerted.push(v.visitId);
        },
      });
      expect(count).toBe(1);
      expect(new Set(alerted)).toEqual(new Set([overstay]));
    });

    it('CT-O02 · [BUG] one bad recipient does not re-mail everyone next run', async () => {
      // Recipients are looped inside the try, and the stamp is outside it. If
      // the third of four sends throws, the visit is left unstamped, so the
      // next run re-sends to the two people who already had it. On a 15-minute
      // gate alert that is a mailbox full of duplicates for a single overstay.
      await seedOverstay(30);
      const deliveredTo: string[] = [];
      let calls = 0;
      const deps = {
        db: db as unknown as Database,
        logger,
        appUrl: APP_URL,
        now: () => NOW,
        notify: async (_v: OverstayVisit, email: string) => {
          calls += 1;
          if (calls === 2) throw new Error('mailbox full');
          deliveredTo.push(email);
        },
      };
      await runContractorOverstayAlerts(deps);
      await runContractorOverstayAlerts(deps);

      const duplicates = deliveredTo.filter((e, i) => deliveredTo.indexOf(e) !== i);
      expect({ duplicateDeliveries: duplicates }).toEqual({ duplicateDeliveries: [] });
    });

    it('CT-O03 · [BUG] the alert link is not hardcoded to English', async () => {
      // `boardUrl` is built as `${appUrl}/en/contractors` in the worker and
      // `sendTemplatedEmail` is called with no `locale`, so a ten-locale
      // product sends every gate alert in English pointing at /en/. This is
      // the same defect the training review raised as TR-A9 and it is still
      // present here.
      await seedOverstay(30);
      const urls: string[] = [];
      await runContractorOverstayAlerts({
        db: db as unknown as Database,
        logger,
        appUrl: APP_URL,
        now: () => NOW,
        notify: async (_v: OverstayVisit, _email: string, boardUrl: string) => {
          urls.push(boardUrl);
        },
      });
      expect({ hardcodedEnglishPath: urls.some((u) => u.includes('/en/')) }).toEqual({
        hardcodedEnglishPath: false,
      });
    });

    it('CT-O04 · [BUG] gate alerts are scoped to the site the overstay is at', async () => {
      // `gateGuardEmails` selects every active user in the TENANT holding
      // `contractors.gate` or `org.settings`, with no site predicate — so a
      // group with twenty sites mails every gate watcher and every admin
      // about a contractor overrunning at one of them. Permits and incidents
      // both site-scope their manage-holder alerts; this does not.
      await seedOverstay(30, otherSiteId);
      const guardSetId = newId();
      await db.insert(schema.permissionSets).values({
        id: guardSetId,
        tenantId,
        name: 'North Yard Gate',
        permissions: ['contractors.gate'],
      });
      const northOnlyId = newId();
      await db.insert(schema.user).values({
        id: northOnlyId,
        tenantId,
        name: 'Nora NorthOnly',
        email: 'north-only@northgate.test',
        permissionSetId: guardSetId,
      });
      await db.insert(schema.siteMembers).values({ tenantId, siteId, userId: northOnlyId });

      const recipients: string[] = [];
      await runContractorOverstayAlerts({
        db: db as unknown as Database,
        logger,
        appUrl: APP_URL,
        now: () => NOW,
        notify: async (_v: OverstayVisit, email: string) => {
          recipients.push(email);
        },
      });

      expect({ mailedAGuardFromAnotherSite: recipients.includes('north-only@northgate.test') }).toEqual(
        { mailedAGuardFromAnotherSite: false },
      );
    });
  });
});
