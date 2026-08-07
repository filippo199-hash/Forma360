/**
 * The seeded test world — shared fixture for module audit suites.
 *
 * Every prior module review in `docs/reviews/` was a **source review**: read
 * the code very carefully and reason about what it does. That found real
 * defects, but it missed a class that one click would have caught (a wallet
 * page that renders empty for every user, a Cmd-K link that 404s). This
 * fixture exists so a module audit can be an actual *test* instead.
 *
 * Three properties matter more than volume for itself:
 *
 *   1. **Two tenants.** Ground rule 4 says every query scopes by tenant. With
 *      a single tenant a leak is invisible — the query returns the right rows
 *      by accident. Tenant B is a deliberate near-mirror of tenant A (same
 *      contractor names, same requirement names, overlapping sites) so a
 *      missing tenant predicate surfaces as *wrong data*, not an empty screen.
 *
 *   2. **Permission sets beyond the seeded three.** Administrator / Manager /
 *      Standard only exercise "everything" and "nothing". The interesting
 *      failures live in the narrow custom sets a real customer builds — the
 *      receptionist who should work the gate and nothing else, the QS who
 *      verifies insurance certificates and must not edit commercial terms.
 *
 *   3. **Planted edge cases.** Random bulk data finds nothing; it all renders
 *      fine. Every awkward case an auditor would construct by hand is seeded
 *      here by name, so each module suite starts in a world where the
 *      boundary conditions already exist.
 *
 * Volume is set just above the codebase's default page size (`limit: 50` in
 * `users.list` and friends), because that is the threshold at which
 * truncation bugs become observable — a picker capped at fifty is invisible
 * with twenty people and silently wrong with two hundred.
 *
 * Deterministic in *shape*: no randomness, and every time-relative row is
 * derived from the single `now` anchor, so "expires today" means the same
 * thing on every run and a finding stays reproducible.
 *
 * The anchor defaults to the real clock rather than a fixed date, and that is
 * forced on us: `contractors.ts` derives compliance against its own
 * `today()`, which reads `new Date()` directly and is not injectable. A
 * fixture pinned to a fixed date would therefore compare seeded cover dates
 * against the real today and report every contractor non-compliant. Note the
 * consequence — because that clock cannot be moved, contractor compliance
 * cannot answer "was this contractor compliant on the day of the incident?",
 * which is the question every other register in this platform answers via
 * ADR 0007. CT-C09 pins that gap.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import type { PermissionKey } from '@forma360/permissions/catalogue';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { createTestContext, type Context } from '../../context';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '..', 'db', 'migrations');

const DAY_MS = 86_400_000;

/** How many ordinary users tenant A gets. Above every default `limit: 50`. */
export const VOLUME_USERS = 200;
/** Contractors in tenant A. Enough to expose an unpaginated list endpoint. */
export const VOLUME_CONTRACTORS = 120;

export type Db = PgliteDatabase<typeof schema>;

/** Boot an empty database with every migration applied, in order. */
export async function bootDb(): Promise<{ client: PGlite; db: Db }> {
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

/**
 * The named actors. Each is a real user row with a real permission set, so a
 * test can say "the receptionist tries to delete a contractor" and mean it.
 */
export interface Actors {
  /** Holds every key in the catalogue. */
  admin: string;
  /** Every key except the four ADMIN_ONLY ones — the default power user. */
  manager: string;
  /** The seeded Standard set: holds NO contractors.* key at all. */
  standard: string;
  /** Custom set: `contractors.gate` and nothing else — the receptionist. */
  gateOperator: string;
  /** Custom set: `contractors.view` + `contractors.verifyDocs` — the QS. */
  docVerifier: string;
  /** Custom set: `contractors.view` only — read-only oversight. */
  viewer: string;
  /** A user with a permission set holding literally nothing. */
  nobody: string;
}

export interface TenantWorld {
  tenantId: string;
  actors: Actors;
  sites: { primary: string; secondary: string };
  /** Every contractor id seeded for this tenant, in creation order. */
  contractorIds: string[];
  /** The planted edge cases, by the name the suite refers to them by. */
  planted: Record<string, string>;
  /** Visits planted for gate / overstay work. */
  visits: Record<string, string>;
}

export interface World {
  client: PGlite;
  db: Db;
  /** The tenant under test — carries the volume and the edge cases. */
  a: TenantWorld;
  /** The near-mirror tenant. Nothing in a correct system should ever see it. */
  b: TenantWorld;
  now: Date;
  ctxFor: (tenantId: string, userId: string) => Context;
  publicCtx: () => Context;
}

const silentLogger = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

async function customSet(
  db: Db,
  tenantId: string,
  name: string,
  permissions: PermissionKey[],
): Promise<string> {
  const id = newId();
  await db.insert(schema.permissionSets).values({ id, tenantId, name, permissions });
  return id;
}

async function makeUser(
  db: Db,
  tenantId: string,
  name: string,
  email: string,
  permissionSetId: string,
): Promise<string> {
  const id = newId();
  await db.insert(schema.user).values({ id, name, email, tenantId, permissionSetId });
  return id;
}

/** Pad to a fixed width so seeded names sort and read predictably. */
function pad(n: number): string {
  return String(n).padStart(3, '0');
}

function day(now: Date, offsetDays: number): string {
  return new Date(now.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Seed one tenant.
 *
 * `slug` distinguishes the two tenants' email addresses and site names; the
 * *contractor* and *requirement* names are deliberately identical across both
 * so a cross-tenant leak reads as a duplicate rather than as nothing.
 */
async function seedTenant(
  db: Db,
  opts: { name: string; slug: string; now: Date; volume: boolean },
): Promise<TenantWorld> {
  const tenantId = newId();
  await db.insert(schema.tenants).values({ id: tenantId, name: opts.name, slug: opts.slug });
  const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);

  const gateSetId = await customSet(db, tenantId, 'Gate Operator', ['contractors.gate']);
  const verifySetId = await customSet(db, tenantId, 'Document Verifier', [
    'contractors.view',
    'contractors.verifyDocs',
  ]);
  const viewSetId = await customSet(db, tenantId, 'Contractor Viewer', ['contractors.view']);
  const nobodySetId = await customSet(db, tenantId, 'No Access', []);

  const e = (local: string) => `${local}@${opts.slug}.test`;
  const actors: Actors = {
    admin: await makeUser(db, tenantId, 'Ada Admin', e('admin'), seeded.administrator),
    manager: await makeUser(db, tenantId, 'Mo Manager', e('manager'), seeded.manager),
    standard: await makeUser(db, tenantId, 'Sam Standard', e('standard'), seeded.standard),
    gateOperator: await makeUser(db, tenantId, 'Gita Gate', e('gate'), gateSetId),
    docVerifier: await makeUser(db, tenantId, 'Val Verifier', e('verify'), verifySetId),
    viewer: await makeUser(db, tenantId, 'Vic Viewer', e('viewer'), viewSetId),
    nobody: await makeUser(db, tenantId, 'Nil Nobody', e('nobody'), nobodySetId),
  };

  // Sites: two, so a cross-site leak at the gate kiosk is observable.
  const primary = newId();
  const secondary = newId();
  await db.insert(schema.sites).values([
    { id: primary, tenantId, name: `${opts.name} — North Yard` },
    { id: secondary, tenantId, name: `${opts.name} — South Depot` },
  ]);

  // ─── Volume ───────────────────────────────────────────────────────────
  if (opts.volume) {
    const bulk: Array<typeof schema.user.$inferInsert> = [];
    for (let i = 1; i <= VOLUME_USERS; i++) {
      bulk.push({
        id: newId(),
        name: `Worker ${pad(i)}`,
        email: `worker${pad(i)}@${opts.slug}.test`,
        tenantId,
        permissionSetId: seeded.standard,
      });
    }
    await db.insert(schema.user).values(bulk);
  }

  const contractorIds: string[] = [];
  const contractorRows: Array<typeof schema.contractors.$inferInsert> = [];
  const requirementRows: Array<typeof schema.contractorRequirements.$inferInsert> = [];
  const documentRows: Array<typeof schema.contractorDocuments.$inferInsert> = [];

  const count = opts.volume ? VOLUME_CONTRACTORS : 6;
  for (let i = 1; i <= count; i++) {
    const cid = newId();
    contractorIds.push(cid);
    contractorRows.push({
      id: cid,
      tenantId,
      name: `Contractor ${pad(i)} Ltd`,
      category: i % 3 === 0 ? 'electrical' : i % 3 === 1 ? 'mechanical' : 'cleaning',
      primaryContactEmail: `contact${pad(i)}@contractor.test`,
      // A live portal credential on every contractor: this is the field the
      // suite checks is not handed to low-privilege readers.
      uploadToken: `seed-upload-token-${opts.slug}-${pad(i)}`,
    });
    // Three requirements each: two blocking, one advisory.
    for (const [j, spec] of [
      { name: 'Public Liability Insurance', blocking: true },
      { name: 'Health & Safety Policy', blocking: true },
      { name: 'Environmental Policy', blocking: false },
    ].entries()) {
      const rid = newId();
      requirementRows.push({ id: rid, tenantId, contractorId: cid, ...spec });
      // Most contractors are fully papered; the planted cases below are not.
      documentRows.push({
        id: newId(),
        tenantId,
        contractorId: cid,
        requirementId: rid,
        storageKey: `${tenantId}/contractors/${cid}/doc-${pad(i)}-${String(j)}.pdf`,
        filename: `doc-${pad(i)}-${String(j)}.pdf`,
        mimeType: 'application/pdf',
        status: 'verified',
        startDate: day(opts.now, -200),
        endDate: day(opts.now, 200),
      });
    }
  }

  // ─── Planted edge cases ───────────────────────────────────────────────
  // Each is a contractor constructed to sit exactly on a boundary. Named,
  // so a failing assertion says which boundary broke.
  const planted: Record<string, string> = {};
  const plant = (key: string, name: string, extra: Record<string, unknown> = {}): string => {
    const id = newId();
    planted[key] = id;
    contractorRows.push({
      id,
      tenantId,
      name,
      uploadToken: `seed-upload-token-${opts.slug}-${key}`,
      ...extra,
    });
    return id;
  };

  // No requirements at all → 'no_requirements', not 'compliant'.
  plant('noRequirements', 'Edge — No Requirements Ltd');

  // A blocking requirement with no document at all → non_compliant.
  const missingDoc = plant('missingDocument', 'Edge — Missing Document Ltd');
  const missingReqId = newId();
  requirementRows.push({
    id: missingReqId,
    tenantId,
    contractorId: missingDoc,
    name: 'Public Liability Insurance',
    blocking: true,
  });

  // Verified document whose cover ends TODAY. Is today inside or outside?
  // `<=` vs `<` on the expiry comparison is a one-character decision that
  // decides whether a contractor is admitted on the last day of cover.
  const expiringToday = plant('expiresToday', 'Edge — Expires Today Ltd');
  const todayReqId = newId();
  requirementRows.push({
    id: todayReqId,
    tenantId,
    contractorId: expiringToday,
    name: 'Public Liability Insurance',
    blocking: true,
  });
  documentRows.push({
    id: newId(),
    tenantId,
    contractorId: expiringToday,
    requirementId: todayReqId,
    storageKey: `${tenantId}/contractors/${expiringToday}/pli.pdf`,
    filename: 'pli.pdf',
    mimeType: 'application/pdf',
    status: 'verified',
    startDate: day(opts.now, -365),
    endDate: day(opts.now, 0),
  });

  // Verified but lapsed yesterday → must be non_compliant.
  const expiredYesterday = plant('expiredYesterday', 'Edge — Expired Yesterday Ltd');
  const yestReqId = newId();
  requirementRows.push({
    id: yestReqId,
    tenantId,
    contractorId: expiredYesterday,
    name: 'Public Liability Insurance',
    blocking: true,
  });
  documentRows.push({
    id: newId(),
    tenantId,
    contractorId: expiredYesterday,
    requirementId: yestReqId,
    storageKey: `${tenantId}/contractors/${expiredYesterday}/pli.pdf`,
    filename: 'pli.pdf',
    mimeType: 'application/pdf',
    status: 'verified',
    startDate: day(opts.now, -365),
    endDate: day(opts.now, -1),
  });

  // Uploaded but never checked → pending must NOT satisfy a blocking slot.
  const pendingOnly = plant('pendingOnly', 'Edge — Pending Only Ltd');
  const pendingReqId = newId();
  requirementRows.push({
    id: pendingReqId,
    tenantId,
    contractorId: pendingOnly,
    name: 'Public Liability Insurance',
    blocking: true,
  });
  documentRows.push({
    id: newId(),
    tenantId,
    contractorId: pendingOnly,
    requirementId: pendingReqId,
    storageKey: `${tenantId}/contractors/${pendingOnly}/pli.pdf`,
    filename: 'pli.pdf',
    mimeType: 'application/pdf',
    status: 'pending',
    startDate: day(opts.now, -10),
    endDate: day(opts.now, 355),
  });

  // Rejected document — likewise must not satisfy.
  const rejectedOnly = plant('rejectedOnly', 'Edge — Rejected Only Ltd');
  const rejectedReqId = newId();
  requirementRows.push({
    id: rejectedReqId,
    tenantId,
    contractorId: rejectedOnly,
    name: 'Public Liability Insurance',
    blocking: true,
  });
  documentRows.push({
    id: newId(),
    tenantId,
    contractorId: rejectedOnly,
    requirementId: rejectedReqId,
    storageKey: `${tenantId}/contractors/${rejectedOnly}/pli.pdf`,
    filename: 'pli.pdf',
    mimeType: 'application/pdf',
    status: 'rejected',
    rejectReason: 'Certificate is for a different entity',
    startDate: day(opts.now, -10),
    endDate: day(opts.now, 355),
  });

  // Fully papered but manually suspended — the override must win.
  const suspended = plant('suspended', 'Edge — Suspended Ltd', {
    complianceOverride: 'suspended',
    complianceOverrideReason: 'Serious incident under investigation',
  });
  const suspReqId = newId();
  requirementRows.push({
    id: suspReqId,
    tenantId,
    contractorId: suspended,
    name: 'Public Liability Insurance',
    blocking: true,
  });
  documentRows.push({
    id: newId(),
    tenantId,
    contractorId: suspended,
    requirementId: suspReqId,
    storageKey: `${tenantId}/contractors/${suspended}/pli.pdf`,
    filename: 'pli.pdf',
    mimeType: 'application/pdf',
    status: 'verified',
    startDate: day(opts.now, -100),
    endDate: day(opts.now, 300),
  });

  // Archived: must be absent from the directory but must not break lookups.
  plant('archived', 'Edge — Archived Ltd', { archivedAt: new Date(opts.now.getTime() - DAY_MS) });

  // Advisory-only paperwork gap: an unmet ADVISORY requirement must not
  // make a contractor non-compliant.
  const advisoryGap = plant('advisoryGapOnly', 'Edge — Advisory Gap Ltd');
  requirementRows.push({
    id: newId(),
    tenantId,
    contractorId: advisoryGap,
    name: 'Environmental Policy',
    blocking: false,
  });

  await db.insert(schema.contractors).values(contractorRows);
  await db.insert(schema.contractorRequirements).values(requirementRows);
  await db.insert(schema.contractorDocuments).values(documentRows);

  // ─── Visits ───────────────────────────────────────────────────────────
  // The gate and overstay surfaces need visits in specific states.
  const visits: Record<string, string> = {};
  const visitRows: Array<typeof schema.contractorVisits.$inferInsert> = [];
  const addVisit = (
    key: string,
    row: Omit<typeof schema.contractorVisits.$inferInsert, 'id' | 'tenantId'>,
  ): string => {
    const id = newId();
    visits[key] = id;
    visitRows.push({ id, tenantId, ...row });
    return id;
  };

  const compliantContractor = contractorIds[0] ?? missingDoc;

  addVisit('scheduledToday', {
    contractorId: compliantContractor,
    siteId: primary,
    title: 'Planned maintenance — North Yard',
    scheduledStart: new Date(opts.now.getTime() + 3_600_000),
    status: 'scheduled',
    authorizedByUserId: actors.manager,
  });
  // Same tenant, different site: a kiosk bound to North Yard must not be
  // able to see or admit this one.
  addVisit('scheduledOtherSite', {
    contractorId: compliantContractor,
    siteId: secondary,
    title: 'Planned maintenance — South Depot',
    scheduledStart: new Date(opts.now.getTime() + 3_600_000),
    status: 'scheduled',
    authorizedByUserId: actors.manager,
  });
  // On site for 30 hours: the overstay worker's whole purpose.
  addVisit('overstaying', {
    contractorId: compliantContractor,
    siteId: primary,
    title: 'Overrunning shutdown',
    scheduledStart: new Date(opts.now.getTime() - 30 * 3_600_000),
    status: 'checked_in',
    checkedInAt: new Date(opts.now.getTime() - 30 * 3_600_000),
    authorizedByUserId: actors.manager,
  });
  // On site two hours: must NOT be alerted.
  addVisit('onSiteFresh', {
    contractorId: compliantContractor,
    siteId: primary,
    title: 'Routine call-out',
    scheduledStart: new Date(opts.now.getTime() - 2 * 3_600_000),
    status: 'checked_in',
    checkedInAt: new Date(opts.now.getTime() - 2 * 3_600_000),
    authorizedByUserId: actors.manager,
  });
  // A visit for a contractor who cannot lawfully be admitted.
  addVisit('nonCompliantVisit', {
    contractorId: expiredYesterday,
    siteId: primary,
    title: 'Should be refused at the gate',
    scheduledStart: new Date(opts.now.getTime() + 3_600_000),
    status: 'scheduled',
    authorizedByUserId: actors.manager,
  });
  addVisit('cancelled', {
    contractorId: compliantContractor,
    siteId: primary,
    title: 'Cancelled visit',
    scheduledStart: new Date(opts.now.getTime() + 3_600_000),
    status: 'cancelled',
  });

  await db.insert(schema.contractorVisits).values(visitRows);

  return { tenantId, actors, sites: { primary, secondary }, contractorIds, planted, visits };
}

/**
 * Build the whole world. Expensive (fifty-odd migrations plus the seed), so
 * call it once per suite in `beforeAll` and treat it as read-mostly — tests
 * that mutate should create their own rows rather than editing the fixture.
 */
export async function bootWorld(now: Date = new Date()): Promise<World> {
  const { client, db } = await bootDb();

  const a = await seedTenant(db, {
    name: 'Northgate Facilities',
    slug: 'northgate',
    now,
    volume: true,
  });
  // The mirror. Same contractor names, same requirement names, its own ids.
  const b = await seedTenant(db, {
    name: 'Copperfield Group',
    slug: 'copperfield',
    now,
    volume: false,
  });

  return {
    client,
    db,
    a,
    b,
    now,
    ctxFor: (tenantId: string, userId: string) =>
      createTestContext({
        db: db as unknown as Database,
        logger: silentLogger(),
        auth: { userId, email: `${userId}@x.test`, tenantId: tenantId as never },
      }),
    publicCtx: () =>
      createTestContext({ db: db as unknown as Database, logger: silentLogger(), auth: null }),
  };
}
