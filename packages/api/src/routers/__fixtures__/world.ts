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
import { eq } from 'drizzle-orm';
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
  /** Custom set: `training.view` + `training.record` — the supervisor. */
  trainingRecorder: string;
  /** Custom set: `training.view` only — reads the matrix, records nothing. */
  trainingViewer: string;
  /**
   * A deactivated user who still holds live training records. Leavers must
   * drop out of the matrix without taking the evidence with them.
   */
  leaver: string;
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
  /** Training requirements, by the name the suite refers to them by. */
  requirements: Record<string, string>;
  /** Training records planted on boundaries, by name. */
  trainingRecords: Record<string, string>;
  /** A group and the role string used for role-scoped assignment. */
  training: { groupId: string; roleName: string; roleFieldId: string };
  /** Document folders, by the name the suite refers to them by. */
  folders: Record<string, string>;
  /** Documents planted against the visibility rules, by name. */
  documents: Record<string, string>;
  /** Heads-Ups planted across the lifecycle, by name. */
  headsUps: Record<string, string>;
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
  // Also holds `headsUp.view`: this actor doubles as the briefings suite's
  // already-acknowledged recipient, and every employee receives briefings —
  // a supervisor who could not open one would be an odd set to build.
  const trainRecordSetId = await customSet(db, tenantId, 'Training Recorder', [
    'training.view',
    'training.record',
    'headsUp.view',
  ]);
  // Also holds `documents.view`: this actor doubles as the documents
  // suite's "in the restricted group" reader, and a role that can read the
  // competence matrix but not the document library would be an odd shape
  // for a real customer to build anyway.
  const trainViewSetId = await customSet(db, tenantId, 'Training Viewer', [
    'training.view',
    'documents.view',
    // And `headsUp.view`, so the briefings suite has a genuine NON-RECIPIENT
    // who nonetheless holds the module's read key. Without it a
    // "non-recipient is refused" test passes on the permission check and
    // proves nothing about recipiency — which is the assertion it claims.
    'headsUp.view',
  ]);

  const e = (local: string) => `${local}@${opts.slug}.test`;
  const actors: Actors = {
    admin: await makeUser(db, tenantId, 'Ada Admin', e('admin'), seeded.administrator),
    manager: await makeUser(db, tenantId, 'Mo Manager', e('manager'), seeded.manager),
    standard: await makeUser(db, tenantId, 'Sam Standard', e('standard'), seeded.standard),
    gateOperator: await makeUser(db, tenantId, 'Gita Gate', e('gate'), gateSetId),
    docVerifier: await makeUser(db, tenantId, 'Val Verifier', e('verify'), verifySetId),
    viewer: await makeUser(db, tenantId, 'Vic Viewer', e('viewer'), viewSetId),
    nobody: await makeUser(db, tenantId, 'Nil Nobody', e('nobody'), nobodySetId),
    trainingRecorder: await makeUser(
      db,
      tenantId,
      'Rhea Recorder',
      e('recorder'),
      trainRecordSetId,
    ),
    trainingViewer: await makeUser(db, tenantId, 'Tam Trainview', e('trainview'), trainViewSetId),
    leaver: await makeUser(db, tenantId, 'Lee Leaver', e('leaver'), seeded.standard),
  };
  await db
    .update(schema.user)
    .set({ deactivatedAt: new Date(opts.now.getTime() - 30 * DAY_MS) })
    .where(eq(schema.user.id, actors.leaver));

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

  // ─── Training & competence (FreeHS B7) ────────────────────────────────
  //
  // The matrix is a derived view over assignments x records, so the fixture
  // has to seed BOTH sides plus the three things a person can be reached
  // by — role (a custom user field), group, site — or the union logic is
  // never exercised.
  const roleFieldId = newId();
  await db.insert(schema.customUserFields).values({
    id: roleFieldId,
    tenantId,
    // `resolveMatrix` picks the role field by matching /role|job title|
    // position/i against the field NAME. That fuzzy match is itself under
    // test (TR-C07), so the fixture uses the plainest possible name.
    name: 'Job title',
    type: 'text',
  });
  const roleName = 'Machine operator';
  const trainingGroupId = newId();
  await db.insert(schema.groups).values({
    id: trainingGroupId,
    tenantId,
    name: 'Night shift',
  });

  // The people the matrix is about: the recorder holds the role, the viewer
  // is in the group, the manager is on the primary site.
  await db.insert(schema.userCustomFieldValues).values({
    tenantId,
    userId: actors.trainingRecorder,
    fieldId: roleFieldId,
    value: roleName,
  });
  await db
    .insert(schema.groupMembers)
    .values({ tenantId, groupId: trainingGroupId, userId: actors.trainingViewer });
  await db.insert(schema.siteMembers).values({ tenantId, siteId: primary, userId: actors.manager });

  const requirements: Record<string, string> = {};
  const reqRows: Array<typeof schema.trainingRequirements.$inferInsert> = [];
  const addReq = (
    key: string,
    row: Omit<typeof schema.trainingRequirements.$inferInsert, 'id' | 'tenantId'>,
  ): string => {
    const id = newId();
    requirements[key] = id;
    reqRows.push({ id, tenantId, ...row });
    return id;
  };

  // Three-year card, chased 60 days out — the ordinary case.
  const abrasive = addReq('abrasiveWheels', {
    name: 'Abrasive wheels',
    obligation: 'statutory',
    validityMonths: 36,
    renewalLeadDays: 60,
  });
  // Never expires: a qualification, not a ticket. Must read permanently
  // in date rather than being given an invented expiry.
  addReq('nvqLevel3', {
    name: 'NVQ Level 3',
    obligation: 'mandatory',
    validityMonths: null,
  });
  // Short lead time, so the expiring_soon boundary is reachable separately
  // from the default 60.
  const firstAid = addReq('firstAid', {
    name: 'First aid at work',
    obligation: 'statutory',
    validityMonths: 36,
    renewalLeadDays: 14,
  });
  // Advisory: an unmet one must not drag the compliance figure.
  addReq('toolboxTalk', {
    name: 'Manual handling toolbox talk',
    obligation: 'discretionary',
    validityMonths: 12,
  });
  await db.insert(schema.trainingRequirements).values(reqRows);

  // Assignments across all four scopes, so the union is exercised.
  await db.insert(schema.trainingRequirementAssignments).values([
    { id: newId(), tenantId, requirementId: abrasive, scope: 'role', roleName },
    { id: newId(), tenantId, requirementId: firstAid, scope: 'group', groupId: trainingGroupId },
    {
      id: newId(),
      tenantId,
      requirementId: requirements.nvqLevel3 as string,
      scope: 'site',
      siteId: primary,
    },
    {
      id: newId(),
      tenantId,
      requirementId: requirements.toolboxTalk as string,
      scope: 'person',
      userId: actors.trainingRecorder,
    },
  ]);

  const trainingRecordIds: Record<string, string> = {};
  const recRows: Array<typeof schema.trainingRecords.$inferInsert> = [];
  const addRec = (
    key: string,
    row: Omit<typeof schema.trainingRecords.$inferInsert, 'id' | 'tenantId'>,
  ): string => {
    const id = newId();
    trainingRecordIds[key] = id;
    recRows.push({ id, tenantId, ...row });
    return id;
  };

  const dayDate = (offset: number): Date =>
    new Date(new Date(opts.now.getTime() + offset * DAY_MS).toISOString().slice(0, 10));

  // Expired yesterday — a gap, and blocking for the permit gate.
  addRec('expiredYesterday', {
    requirementId: abrasive,
    userId: actors.trainingRecorder,
    personName: 'Rhea Recorder',
    achievedAt: dayDate(-1000),
    expiresAt: dayDate(-1),
  });
  // Inside its own 14-day lead: expiring_soon, which must NOT block a
  // permit — the card is valid today.
  addRec('expiringInsideLead', {
    requirementId: firstAid,
    userId: actors.trainingViewer,
    personName: 'Tam Trainview',
    achievedAt: dayDate(-1000),
    expiresAt: dayDate(7),
  });
  // Just outside the same lead: plain in_date.
  addRec('expiringOutsideLead', {
    requirementId: firstAid,
    userId: actors.manager,
    personName: 'Mo Manager',
    achievedAt: dayDate(-1000),
    expiresAt: dayDate(40),
  });
  // A typo'd far-future expiry, voided. `currentRecord` prefers the
  // furthest-reaching cover, so if `supersededAt` is not honoured this row
  // marks its holder permanently competent.
  addRec('supersededTypo', {
    requirementId: abrasive,
    userId: actors.trainingViewer,
    personName: 'Tam Trainview',
    achievedAt: dayDate(-10),
    expiresAt: new Date('2099-01-01'),
    supersededAt: new Date(opts.now.getTime() - DAY_MS),
    notes: '[voided] expiry mistyped as 2099',
  });
  // A leaver's live card: the evidence must survive their deactivation.
  addRec('leaverCard', {
    requirementId: abrasive,
    userId: actors.leaver,
    personName: 'Lee Leaver',
    achievedAt: dayDate(-100),
    expiresAt: dayDate(300),
  });
  // An account-less contractor's operative, keyed only by name.
  addRec('nameOnlyOperative', {
    requirementId: abrasive,
    userId: null,
    personName: 'Dan Operative',
    personCategory: 'contractor',
    achievedAt: dayDate(-100),
    expiresAt: dayDate(300),
    recordedByUserId: actors.manager,
  });
  await db.insert(schema.trainingRecords).values(recRows);

  // ─── Documents ────────────────────────────────────────────────────────
  //
  // The module's own access layer is the interesting surface: a folder or
  // document is visible when its OWN group/site visibility passes AND every
  // ancestor folder's does, with an explicit ACL grant able to admit on top.
  // That is four interacting rules, so the fixture plants one document for
  // each of them and one for the cascade, which is the rule most likely to
  // be forgotten by a read path that filters only on the document row.
  //
  // Memberships already seeded above do the work: `trainingViewer` is in the
  // Night shift group, `manager` is a member of the primary site, and
  // `standard` is in neither — so "restricted" and "not restricted" are
  // answerable for a real person rather than an abstract predicate.
  const folders: Record<string, string> = {};
  const folderRows: Array<typeof schema.documentFolders.$inferInsert> = [];
  const addFolder = (
    key: string,
    row: Omit<typeof schema.documentFolders.$inferInsert, 'id' | 'tenantId' | 'createdByUserId'>,
  ): string => {
    const id = newId();
    folders[key] = id;
    folderRows.push({ id, tenantId, createdByUserId: actors.admin, ...row });
    return id;
  };

  const publicFolder = addFolder('publicFolder', { name: 'Company policies' });
  // Restricted to the Night shift group.
  const groupFolder = addFolder('groupFolder', {
    name: 'Night shift only',
    visibleToGroupIds: [trainingGroupId],
  });
  // Nested INSIDE the restricted folder with no restriction of its own. The
  // cascade is what must hide it; a read path filtering on the document row
  // alone would leak everything in here.
  const nestedOpenFolder = addFolder('nestedOpenFolder', {
    name: 'Night shift — handovers',
    parentId: groupFolder,
  });
  addFolder('siteFolder', {
    name: 'North Yard only',
    visibleToSiteIds: [primary],
  });

  await db.insert(schema.documentFolders).values(folderRows);

  const documentIds: Record<string, string> = {};
  const docRows: Array<typeof schema.documents.$inferInsert> = [];
  const addDoc = (
    key: string,
    row: Omit<
      typeof schema.documents.$inferInsert,
      'id' | 'tenantId' | 'storageKey' | 'filename' | 'mimeType' | 'uploadedByUserId'
    >,
  ): string => {
    const id = newId();
    documentIds[key] = id;
    docRows.push({
      id,
      tenantId,
      storageKey: `${tenantId}/documents/${id}/file.pdf`,
      filename: 'file.pdf',
      mimeType: 'application/pdf',
      uploadedByUserId: actors.admin,
      ...row,
    });
    return id;
  };

  // No restriction anywhere: everyone with `documents.view` sees it.
  addDoc('publicDoc', { name: 'Health and safety policy', folderId: publicFolder });
  // Restricted on the document itself.
  addDoc('groupRestrictedDoc', {
    name: 'Night shift rota',
    folderId: publicFolder,
    visibleToGroupIds: [trainingGroupId],
  });
  addDoc('siteRestrictedDoc', {
    name: 'North Yard evacuation plan',
    folderId: publicFolder,
    visibleToSiteIds: [primary],
  });
  // Unrestricted document in a restricted folder — the cascade case.
  addDoc('inheritsFolderRestriction', {
    name: 'Night shift handover notes',
    folderId: groupFolder,
  });
  // Unrestricted document two levels down from the restriction.
  addDoc('inheritsGrandparentRestriction', {
    name: 'Handover — week 32',
    folderId: nestedOpenFolder,
  });
  // For the ACL-grant path: restricted by group, then granted to a named
  // user who is NOT in that group.
  const grantedDoc = addDoc('grantedToOutsider', {
    name: 'Night shift incident summary',
    folderId: publicFolder,
    visibleToGroupIds: [trainingGroupId],
  });
  addDoc('archivedDoc', {
    name: 'Superseded fire policy',
    folderId: publicFolder,
    archivedAt: new Date(opts.now.getTime() - DAY_MS),
  });
  // Expiry boundaries for the reminder worker.
  addDoc('expiredYesterdayDoc', {
    name: 'Lapsed insurance certificate',
    folderId: publicFolder,
    expiresAt: new Date(opts.now.getTime() - DAY_MS),
  });
  addDoc('expiringSoonDoc', {
    name: 'Expiring calibration certificate',
    folderId: publicFolder,
    expiresAt: new Date(opts.now.getTime() + 5 * DAY_MS),
    reminderDays: [30, 7],
  });

  if (opts.volume) {
    for (let i = 1; i <= 80; i++) {
      addDoc(`bulk${pad(i)}`, {
        name: `Procedure ${pad(i)}`,
        folderId: publicFolder,
      });
    }
  }

  await db.insert(schema.documents).values(docRows);

  // The explicit grant that admits an outsider to a group-restricted doc.
  await db.insert(schema.documentAccess).values({
    id: newId(),
    tenantId,
    documentId: grantedDoc,
    folderId: null,
    subjectType: 'user',
    subjectId: actors.standard,
    permission: 'view',
    grantedByUserId: actors.admin,
  });

  // ─── Heads-Up / Briefings ─────────────────────────────────────────────
  //
  // The module distributes documents, which makes it the one place the
  // Documents visibility layer can be routed around: a briefing carries a
  // library document to a named list of people, and nothing in that path
  // asks whether each recipient was entitled to the document.
  //
  // So the fixture attaches `groupRestrictedDoc` — restricted to the Night
  // shift group — to a briefing sent to `standard`, who is in no group. Any
  // read path that shows them that document is disclosing something the
  // Documents module refuses to.
  const headsUpIds: Record<string, string> = {};
  const huRows: Array<typeof schema.headsUps.$inferInsert> = [];
  const addHeadsUp = (
    key: string,
    row: Omit<typeof schema.headsUps.$inferInsert, 'id' | 'tenantId' | 'createdByUserId'>,
  ): string => {
    const id = newId();
    headsUpIds[key] = id;
    huRows.push({ id, tenantId, createdByUserId: actors.admin, ...row });
    return id;
  };

  const publishedBriefing = addHeadsUp('published', {
    title: 'Revised permit-to-work procedure',
    description: 'Read and sign before your next shift.',
    status: 'published',
    engagementLevel: 'sign',
    requireAcknowledgement: true,
    requireSignature: true,
  });
  // Carries a document the recipient is not entitled to see.
  const leakyBriefing = addHeadsUp('carriesRestrictedDoc', {
    title: 'Night shift changes',
    status: 'published',
    engagementLevel: 'view',
    shareToken: `seed-headsup-share-${opts.slug}`,
  });
  // Archived: recipients persist, so acknowledging or signing one is
  // reachable unless the lifecycle refuses it.
  const archivedBriefing = addHeadsUp('archived', {
    title: 'Withdrawn winter driving notice',
    status: 'archived',
    engagementLevel: 'sign',
    requireSignature: true,
  });
  addHeadsUp('draft', {
    title: 'Unsent draft',
    status: 'draft',
    engagementLevel: 'view',
  });

  await db.insert(schema.headsUps).values(huRows);

  const recipientRows: Array<typeof schema.headsUpRecipients.$inferInsert> = [];
  const addRecipient = (headsUpId: string, userId: string, state: 'none' | 'viewed' | 'acked') => {
    recipientRows.push({
      id: newId(),
      tenantId,
      headsUpId,
      userId,
      viewedAt: state === 'none' ? null : new Date(opts.now.getTime() - 2 * DAY_MS),
      acknowledgedAt: state === 'acked' ? new Date(opts.now.getTime() - DAY_MS) : null,
    });
  };
  // `standard` is the untouched recipient the signing tests act as;
  // `trainingRecorder` has already acknowledged, so the sign-after-ack path
  // is reachable without mutating the first one.
  addRecipient(publishedBriefing, actors.standard, 'viewed');
  addRecipient(publishedBriefing, actors.trainingRecorder, 'acked');
  addRecipient(leakyBriefing, actors.standard, 'none');
  addRecipient(archivedBriefing, actors.standard, 'viewed');
  if (opts.volume) {
    // Fan-out: every seeded worker is on the published briefing, so the
    // engagement roll-up and the recipient list are asked a real question.
    const workers = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.tenantId, tenantId));
    for (const w of workers) {
      // The two already added above, and `trainingViewer`, which the
      // briefings suite needs as a genuine NON-recipient who nonetheless
      // holds `headsUp.view`. A blanket fan-out would quietly enrol it and
      // turn every "a non-recipient is refused" assertion into a tautology.
      if (
        w.id === actors.standard ||
        w.id === actors.trainingRecorder ||
        w.id === actors.trainingViewer
      ) {
        continue;
      }
      addRecipient(publishedBriefing, w.id, 'none');
    }
  }
  await db.insert(schema.headsUpRecipients).values(recipientRows);

  await db.insert(schema.headsUpDocuments).values({
    tenantId,
    headsUpId: leakyBriefing,
    documentId: documentIds.groupRestrictedDoc as string,
    documentVersion: 1,
  });

  return {
    tenantId,
    actors,
    sites: { primary, secondary },
    contractorIds,
    planted,
    visits,
    requirements,
    trainingRecords: trainingRecordIds,
    training: { groupId: trainingGroupId, roleName, roleFieldId },
    folders,
    documents: documentIds,
    headsUps: headsUpIds,
  };
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
