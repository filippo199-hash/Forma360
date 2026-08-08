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
 * Every test describes CORRECT behaviour. Those that named a live defect
 * failed when the audit ran and were the acceptance criteria for the fix
 * pass; they now pass, so this file is the module's regression suite.
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

    it('CT-W01 · the chase links somewhere the contractor can actually act', async () => {
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
      expect({ ctaLandsOnAnUploadPage: urls[0]?.includes('/contractor-upload/') === true }).toEqual(
        {
          ctaLandsOnAnUploadPage: true,
        },
      );

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

    it('CT-O02 · one bad recipient does not re-mail everyone next run', async () => {
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
        notify: async (_v: OverstayVisit, recipient: { email: string }) => {
          calls += 1;
          if (calls === 2) throw new Error('mailbox full');
          deliveredTo.push(recipient.email);
        },
      };
      await runContractorOverstayAlerts(deps);
      await runContractorOverstayAlerts(deps);

      const duplicates = deliveredTo.filter((e, i) => deliveredTo.indexOf(e) !== i);
      expect({ duplicateDeliveries: duplicates }).toEqual({ duplicateDeliveries: [] });
    });

    it('CT-O03 · the alert lands in the recipient own locale', async () => {
      // Originally `boardUrl` was hardcoded `${appUrl}/en/contractors` and
      // `sendTemplatedEmail` was called with no locale, so every gate alert
      // went out in English on a ten-locale product. The locale now rides
      // along on each recipient; `/en/` remains the correct fallback for
      // someone who has never set one, so the assertion is that a recipient
      // WITH a locale gets theirs.
      await db.update(schema.user).set({ locale: 'fr' }).where(eq(schema.user.id, inviterId));
      await seedOverstay(30);

      const seen: Array<{ locale: string | null; url: string }> = [];
      await runContractorOverstayAlerts({
        db: db as unknown as Database,
        logger,
        appUrl: APP_URL,
        now: () => NOW,
        notify: async (_v, recipient: { locale: string | null }, boardUrl: string) => {
          seen.push({ locale: recipient.locale, url: boardUrl });
        },
      });

      const french = seen.find((r) => r.locale === 'fr');
      expect(french).toBeDefined();
      expect(french?.url).toContain('/fr/');
    });

    it('CT-O04 · gate alerts narrow to the site team where membership is curated', async () => {
      // `resolveGateGuards` intersects `contractors.gate` holders with the
      // overstay site's `site_members`, and deliberately falls back to every
      // holder when that intersection is empty — a mis-curated site must
      // never swallow an alert. So the meaningful assertion is the CURATED
      // case: with the overstay's own site populated, a guard who belongs
      // only to the other site must not be mailed.
      await seedOverstay(30, siteId);

      const guardSetId = newId();
      await db.insert(schema.permissionSets).values({
        id: guardSetId,
        tenantId,
        name: 'Site Gate Watch',
        permissions: ['contractors.gate'],
      });
      const northId = newId();
      const southId = newId();
      await db.insert(schema.user).values([
        {
          id: northId,
          tenantId,
          name: 'Nora NorthYard',
          email: 'north@northgate.test',
          permissionSetId: guardSetId,
        },
        {
          id: southId,
          tenantId,
          name: 'Sid SouthDepot',
          email: 'south@northgate.test',
          permissionSetId: guardSetId,
        },
      ]);
      // Curate BOTH sites, so the overstay site's intersection is non-empty
      // and the fallback does not fire.
      await db.insert(schema.siteMembers).values([
        { tenantId, siteId, userId: northId },
        { tenantId, siteId: otherSiteId, userId: southId },
      ]);

      const recipients: string[] = [];
      await runContractorOverstayAlerts({
        db: db as unknown as Database,
        logger,
        appUrl: APP_URL,
        now: () => NOW,
        notify: async (_v: OverstayVisit, recipient: { email: string }) => {
          recipients.push(recipient.email);
        },
      });

      expect({
        mailedTheSiteGuard: recipients.includes('north@northgate.test'),
        mailedTheOtherSiteGuard: recipients.includes('south@northgate.test'),
      }).toEqual({ mailedTheSiteGuard: true, mailedTheOtherSiteGuard: false });
    });
  });
});
