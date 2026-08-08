/**
 * Contractors router (Phase 1: directory + compliance documents).
 *
 * Compliance is **derived**, never stored: a contractor is compliant when
 * every *blocking* requirement has a `verified` document whose end date has
 * not passed. Advisory requirements don't affect the status.
 */
import { randomBytes } from 'node:crypto';
import { appLink } from '@forma360/shared/app-link';
import { DEFAULT_BRAND_ID, getBrand } from '@forma360/shared/brand';
import type { Database } from '@forma360/db/client';
import {
  contractorInductionConfig,
  permits,
  assetTypes,
  assets,
  contractorAssets,
  contractorDocuments,
  contractorGateConfig,
  contractorGateFields,
  contractorRequirementTemplates,
  contractorRequirements,
  contractorUsers,
  contractorVisitEvents,
  contractorVisits,
  contractors,
  invitations,
  permissionSets,
  sites,
  tenants,
  user,
} from '@forma360/db/schema';
import {
  CONTRACTOR_ACTIVITIES,
  activitiesToPermissionKeys,
} from '@forma360/permissions/contractor-activities';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { wouldDropBelowMinAdmins } from '@forma360/permissions/admins';
import {
  complianceBarsEntry,
  complianceOverridable,
  effectiveComplianceStatus,
  firstMissingGateField,
  isCalendarDate,
  todayIso,
  validateDocumentPeriod,
  visitTransitionError,
  type ComplianceOverride,
  type DerivedComplianceStatus,
  type EffectiveComplianceStatus,
} from '@forma360/shared/contractors';
import { aliasedTable, and, asc, between, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  publicProcedure,
  requireAnyPermission,
  requirePermission,
  tenantProcedure,
} from '../procedures';
import { assertSitesInTenant, assertStorageKeyInTenant } from '../tenant-guards';
import { OPEN_PERMIT_STATUSES } from '@forma360/shared/permits';
import { router } from '../trpc';

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

/**
 * CT-O03: the primary contact's email language. Two-letter codes only —
 * the same shape `users.setLocale` accepts and the only shape the email
 * template loader looks up. Null (the default) means English.
 */
const contactLocale = z
  .string()
  .regex(/^[a-z]{2}$/)
  .nullable()
  .optional();

/**
 * CT-G08: this used to be the DERIVED type only, and the override — which
 * can be `'suspended'` — was cast into it. The cast made the missing case
 * invisible to the compiler, which is how `=== 'non_compliant'` passed
 * review while suspended contractors walked through the gate.
 */
type ComplianceStatus = DerivedComplianceStatus;

interface ReqRow {
  id: string;
  blocking: boolean;
}
interface DocRow {
  requirementId: string;
  status: string;
  /** CT-C09: an as-at answer needs BOTH ends of the validity window. */
  startDate: string | null;
  endDate: string | null;
}

/** Today as YYYY-MM-DD (lexicographic compare works for ISO dates). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * CT-C09: the calendar day a compliance question is asked about (ADR 0007).
 *
 * The register keeps every document's validity window precisely so it can
 * answer "was their insurance in force on the day of the incident" — but
 * nothing let a caller name the day, so the only question it could answer
 * was "is it in force right now". Mirrors `training.ts`'s `asOf`.
 *
 * Gate procedures deliberately never accept this from the client: entry is
 * decided now, not on a date the kiosk supplies. A client-chosen as-at at
 * the gate would be a compliance bypass — pick the day the policy was
 * still live and walk in.
 */
const asOfInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

function asOfDay(asOf: string | undefined): string {
  if (asOf === undefined) return today();
  if (!isCalendarDate(asOf)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-date' });
  }
  return asOf;
}

/**
 * CT-V02: the register is paged and searched server-side.
 *
 * `list` had no `.input()` at all and fanned out unbounded `inArray`
 * queries over every requirement and every document of every contractor —
 * three unbounded queries, and four of its five callers only wanted to
 * fill a dropdown. `search` is not polish: it is what stops a picker from
 * silently stopping at the first page.
 */
const listContractorsInput = z
  .object({
    limit: z.number().int().min(1).max(200).default(50),
    /** The last row's id — see the keyset comment in `list`. */
    cursor: z.string().length(26).optional(),
    search: z.string().trim().max(200).optional(),
    asOf: asOfInput,
  })
  .default({});

/**
 * A requirement is satisfied by a verified document whose validity window
 * contains `t`.
 *
 * Checking only `endDate` made a policy that had not started yet count as
 * cover — invisible while `t` was always today, and plainly wrong the
 * moment `t` can be a past date: "was the cover in force on 3 March" would
 * have answered yes for a policy that incepted on 1 June.
 */
function requirementSatisfied(docs: DocRow[], t: string): boolean {
  return docs.some(
    (d) =>
      d.status === 'verified' &&
      (d.startDate === null || d.startDate <= t) &&
      (d.endDate === null || d.endDate >= t),
  );
}

/** Company-wide compliance from a contractor's requirements + documents. */
function computeStatus(
  reqs: ReqRow[],
  docsByReq: Map<string, DocRow[]>,
  t: string,
): ComplianceStatus {
  const blocking = reqs.filter((r) => r.blocking);
  if (blocking.length === 0) return 'no_requirements';
  const allMet = blocking.every((r) => requirementSatisfied(docsByReq.get(r.id) ?? [], t));
  return allMet ? 'compliant' : 'non_compliant';
}

/**
 * Effective compliance for ONE contractor (PF-19): the same derivation the
 * list/get views show — blocking requirements vs verified unexpired documents
 * — with a manual override winning. This is what the gate consults before
 * letting a visit check in.
 */
async function contractorComplianceStatus(
  db: Database,
  tenantId: string,
  contractorId: string,
): Promise<EffectiveComplianceStatus> {
  const rows = await db
    .select({ complianceOverride: contractors.complianceOverride })
    .from(contractors)
    .where(and(eq(contractors.tenantId, tenantId), eq(contractors.id, contractorId)))
    .limit(1);
  const contractor = rows[0];
  if (contractor === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  const reqs = await db
    .select({ id: contractorRequirements.id, blocking: contractorRequirements.blocking })
    .from(contractorRequirements)
    .where(
      and(
        eq(contractorRequirements.tenantId, tenantId),
        eq(contractorRequirements.contractorId, contractorId),
      ),
    );
  const docs = await db
    .select({
      requirementId: contractorDocuments.requirementId,
      status: contractorDocuments.status,
      startDate: contractorDocuments.startDate,
      endDate: contractorDocuments.endDate,
    })
    .from(contractorDocuments)
    .where(
      and(
        eq(contractorDocuments.tenantId, tenantId),
        eq(contractorDocuments.contractorId, contractorId),
      ),
    );
  const docsByReq = new Map<string, DocRow[]>();
  for (const d of docs) {
    const arr = docsByReq.get(d.requirementId) ?? [];
    arr.push(d);
    docsByReq.set(d.requirementId, arr);
  }
  const derived = computeStatus(reqs, docsByReq, today());
  // No cast: the override genuinely may be 'suspended', and the return type
  // now says so, which forces every caller to handle it.
  return effectiveComplianceStatus({
    override: contractor.complianceOverride as ComplianceOverride | null,
    derived,
  });
}

/**
 * Copy the trade templates for a category into a contractor's requirements,
 * skipping any whose name already exists on the contractor. Returns the count
 * applied.
 */
async function applyTemplatesForCategory(
  db: Database,
  tenantId: string,
  contractorId: string,
  category: string,
): Promise<number> {
  const templates = await db
    .select()
    .from(contractorRequirementTemplates)
    .where(
      and(
        eq(contractorRequirementTemplates.tenantId, tenantId),
        eq(contractorRequirementTemplates.category, category),
      ),
    );
  if (templates.length === 0) return 0;
  const existing = await db
    .select({ name: contractorRequirements.name })
    .from(contractorRequirements)
    .where(
      and(
        eq(contractorRequirements.tenantId, tenantId),
        eq(contractorRequirements.contractorId, contractorId),
      ),
    );
  const have = new Set(existing.map((r) => r.name));
  const toAdd = templates.filter((t) => !have.has(t.name));
  if (toAdd.length === 0) return 0;
  await db.insert(contractorRequirements).values(
    toAdd.map((t) => ({
      id: newId(),
      tenantId,
      contractorId,
      name: t.name,
      blocking: t.blocking,
      recurrenceMonths: t.recurrenceMonths,
    })),
  );
  return toAdd.length;
}

/**
 * Every contractor column a reader may see. Deliberately enumerated rather
 * than `select()`: the table also holds `uploadToken`, which is a working
 * credential (CT-S01), and a bare select leaks it to anyone who can read
 * the directory.
 */
const CONTRACTOR_PUBLIC_COLUMNS = {
  id: contractors.id,
  tenantId: contractors.tenantId,
  name: contractors.name,
  category: contractors.category,
  status: contractors.status,
  complianceOverride: contractors.complianceOverride,
  complianceOverrideReason: contractors.complianceOverrideReason,
  primaryContactName: contractors.primaryContactName,
  primaryContactEmail: contractors.primaryContactEmail,
  locale: contractors.locale,
  notes: contractors.notes,
  // `uploadToken` is deliberately absent — that is the whole point.
  archivedAt: contractors.archivedAt,
  createdAt: contractors.createdAt,
  updatedAt: contractors.updatedAt,
} as const;

/**
 * Resolve a kiosk token to its tenant and (optionally) its site.
 *
 * CT-G06: the token used to resolve to a tenant only, so any screen's
 * token unlocked every screen. A row with `siteId: null` is the legacy
 * tenant-wide kiosk and keeps its old, unscoped behaviour — that is what
 * lets this ship without every reception desk in the field going dark.
 *
 * An archived site takes its kiosk offline. That is deliberate: a screen
 * for a site nobody operates any more should not be admitting people.
 */
async function resolveKioskOrThrow(
  db: Database,
  token: string,
): Promise<{ tenantId: string; siteId: string | null; siteName: string | null }> {
  const rows = await db
    .select({
      tenantId: contractorGateConfig.tenantId,
      siteId: contractorGateConfig.siteId,
      siteName: sites.name,
      siteArchivedAt: sites.archivedAt,
    })
    .from(contractorGateConfig)
    .leftJoin(sites, eq(contractorGateConfig.siteId, sites.id))
    .where(eq(contractorGateConfig.gateToken, token))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  if (row.siteId !== null && row.siteArchivedAt !== null) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  return { tenantId: row.tenantId, siteId: row.siteId, siteName: row.siteName };
}

async function loadContractorOrThrow(db: Database, tenantId: string, id: string) {
  const rows = await db
    // CT-S01: projected, so `get` (a `contractors.view` read) cannot return
    // `uploadToken`. No caller of this helper reads the token —
    // `regenerateUploadLink` writes a fresh one and `publicByToken` has its
    // own query — so narrowing here fixes the leak at its source.
    .select(CONTRACTOR_PUBLIC_COLUMNS)
    .from(contractors)
    .where(and(eq(contractors.tenantId, tenantId), eq(contractors.id, id)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

/**
 * Same, but refuses an archived contractor.
 *
 * `contractors.list` hides archived rows while Cmd-K surfaced them, so the
 * only door left to a retired company also rendered live "Add
 * requirement" / "Upload" / "Schedule a visit" controls — new work piled
 * onto a record the register says does not exist. Reads keep using the
 * plain loader so historical visits and documents still resolve their
 * company name.
 */
async function loadActiveContractorOrThrow(db: Database, tenantId: string, id: string) {
  const row = await loadContractorOrThrow(db, tenantId, id);
  if (row.archivedAt !== null) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

async function loadVisitOrThrow(db: Database, tenantId: string, id: string) {
  const rows = await db
    .select()
    .from(contractorVisits)
    .where(and(eq(contractorVisits.tenantId, tenantId), eq(contractorVisits.id, id)))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.archivedAt !== null) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

/** ISO 8601 datetime (e.g. from `new Date().toISOString()`). */
const isoDateTime = z.string().datetime();

/**
 * Email dispatch for the external-contractor-user invite. Wired at app boot
 * via `setContractorsRouterDeps` (mirrors the users router); null in tests so
 * the invitation row is created without sending mail.
 */
export interface ContractorsRouterDeps {
  sendEmail:
    | ((args: {
        to: string;
        templateKey: 'invite' | 'contractor-portal-invite' | 'contractor-overstay';
        variables: Record<string, string>;
      }) => Promise<unknown>)
    | null;
  appUrl: string;
  /** Brand name (ADR 0010) used as the tenant-name fallback in invite copy. */
  productName: string;
}
const contractorsDeps: ContractorsRouterDeps = {
  sendEmail: null,
  appUrl: 'http://localhost:3000',
  productName: getBrand(DEFAULT_BRAND_ID).name,
};
export function setContractorsRouterDeps(deps: ContractorsRouterDeps): void {
  contractorsDeps.sendEmail = deps.sendEmail;
  contractorsDeps.appUrl = deps.appUrl;
  contractorsDeps.productName = deps.productName;
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const activitiesInput = z.array(z.enum(CONTRACTOR_ACTIVITIES)).default([]);

/** Answers to the configured gate fields, keyed by gate-field id. */
const capturedFieldsSchema = z.record(z.string().length(26), z.string().max(2000));

/** Append a gate check-in / check-out event to the audit log. */
async function insertVisitEvent(
  db: Database,
  args: {
    tenantId: string;
    visitId: string;
    contractorId: string;
    eventType: 'check_in' | 'check_out';
    method: 'self_scan' | 'staff';
    actorUserId: string | null;
    capturedFields?: Record<string, string>;
    overrideReason?: string | null;
  },
): Promise<void> {
  await db.insert(contractorVisitEvents).values({
    id: newId(),
    tenantId: args.tenantId,
    visitId: args.visitId,
    contractorId: args.contractorId,
    eventType: args.eventType,
    method: args.method,
    actorUserId: args.actorUserId,
    ...(args.capturedFields !== undefined ? { capturedFields: args.capturedFields } : {}),
    ...(args.overrideReason != null && args.overrideReason !== ''
      ? { overrideReason: args.overrideReason }
      : {}),
  });
}

export const contractorsRouter = router({
  list: tenantProcedure
    .use(requirePermission('contractors.view'))
    .input(listContractorsInput)
    .query(async ({ ctx, input }) => {
      const tid = ctx.tenantId;
      // CT-C09: which day this answer is for. Today unless asked otherwise.
      const t = asOfDay(input.asOf);

      const where = [eq(contractors.tenantId, tid), isNull(contractors.archivedAt)];
      if (input.search !== undefined && input.search !== '') {
        const term = `%${input.search.toLowerCase()}%`;
        where.push(
          sql`(lower(${contractors.name}) LIKE ${term} OR lower(coalesce(${contractors.category}, '')) LIKE ${term})`,
        );
      }
      // CT-V02: keyset cursor over the list order (name, id). The cursor is
      // the last row's id and is resolved INSIDE the tenant, so a cursor
      // from another tenant leaks nothing — it simply restarts at page one.
      if (input.cursor !== undefined) {
        const anchorRows = await ctx.db
          .select({ id: contractors.id, name: contractors.name })
          .from(contractors)
          .where(and(eq(contractors.tenantId, tid), eq(contractors.id, input.cursor)))
          .limit(1);
        const anchor = anchorRows[0];
        if (anchor !== undefined) {
          where.push(
            sql`(${contractors.name} > ${anchor.name} OR (${contractors.name} = ${anchor.name} AND ${contractors.id} > ${anchor.id}))`,
          );
        }
      }

      const page = await ctx.db
        // CT-S01: explicit projection. A bare select() returned
        // `uploadToken` — the bearer credential for the no-login upload
        // portal — to every `contractors.view` holder, while MINTING one
        // requires `contractors.manage`. The token now leaves the server
        // only through `regenerateUploadLink`, to the person who minted it.
        .select(CONTRACTOR_PUBLIC_COLUMNS)
        .from(contractors)
        .where(and(...where))
        // The id tiebreaker is what makes the cursor stable: two contractors
        // can share a name, and a page boundary between them would otherwise
        // drop or repeat one.
        .orderBy(asc(contractors.name), asc(contractors.id))
        .limit(input.limit + 1);
      const hasMore = page.length > input.limit;
      const rows = hasMore ? page.slice(0, input.limit) : page;
      const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;
      if (rows.length === 0) return { contractors: [], hasMore, nextCursor, asOf: t };

      const ids = rows.map((r) => r.id);
      const reqs = await ctx.db
        .select({
          id: contractorRequirements.id,
          contractorId: contractorRequirements.contractorId,
          blocking: contractorRequirements.blocking,
        })
        .from(contractorRequirements)
        .where(
          and(
            eq(contractorRequirements.tenantId, tid),
            inArray(contractorRequirements.contractorId, ids),
          ),
        );
      const docs = await ctx.db
        .select({
          contractorId: contractorDocuments.contractorId,
          requirementId: contractorDocuments.requirementId,
          status: contractorDocuments.status,
          startDate: contractorDocuments.startDate,
          endDate: contractorDocuments.endDate,
        })
        .from(contractorDocuments)
        .where(
          and(
            eq(contractorDocuments.tenantId, tid),
            inArray(contractorDocuments.contractorId, ids),
          ),
        );

      const reqsByContractor = new Map<string, ReqRow[]>();
      for (const r of reqs) {
        const arr = reqsByContractor.get(r.contractorId) ?? [];
        arr.push({ id: r.id, blocking: r.blocking });
        reqsByContractor.set(r.contractorId, arr);
      }
      const docsByContractorReq = new Map<string, Map<string, DocRow[]>>();
      for (const d of docs) {
        const inner = docsByContractorReq.get(d.contractorId) ?? new Map<string, DocRow[]>();
        const arr = inner.get(d.requirementId) ?? [];
        arr.push({
          requirementId: d.requirementId,
          status: d.status,
          startDate: d.startDate,
          endDate: d.endDate,
        });
        inner.set(d.requirementId, arr);
        docsByContractorReq.set(d.contractorId, inner);
      }

      return {
        contractors: rows.map((c) => {
          const derived = computeStatus(
            reqsByContractor.get(c.id) ?? [],
            docsByContractorReq.get(c.id) ?? new Map(),
            t,
          );
          return {
            ...c,
            // A manual override wins over the derived status.
            complianceStatus: c.complianceOverride ?? derived,
            derivedComplianceStatus: derived,
            requirementCount: (reqsByContractor.get(c.id) ?? []).length,
          };
        }),
        hasMore,
        nextCursor,
        asOf: t,
      };
    }),

  get: tenantProcedure
    .use(requirePermission('contractors.view'))
    .input(z.object({ id: z.string().length(26), asOf: asOfInput }))
    .query(async ({ ctx, input }) => {
      const contractor = await loadContractorOrThrow(ctx.db, ctx.tenantId, input.id);

      const reqs = await ctx.db
        .select()
        .from(contractorRequirements)
        .where(
          and(
            eq(contractorRequirements.tenantId, ctx.tenantId),
            eq(contractorRequirements.contractorId, input.id),
          ),
        )
        .orderBy(contractorRequirements.createdAt);

      const docs = await ctx.db
        .select({
          id: contractorDocuments.id,
          requirementId: contractorDocuments.requirementId,
          filename: contractorDocuments.filename,
          mimeType: contractorDocuments.mimeType,
          sizeBytes: contractorDocuments.sizeBytes,
          storageKey: contractorDocuments.storageKey,
          startDate: contractorDocuments.startDate,
          endDate: contractorDocuments.endDate,
          status: contractorDocuments.status,
          rejectReason: contractorDocuments.rejectReason,
          verifiedAt: contractorDocuments.verifiedAt,
          verifierName: user.name,
          createdAt: contractorDocuments.createdAt,
        })
        .from(contractorDocuments)
        .leftJoin(user, eq(contractorDocuments.verifiedByUserId, user.id))
        .where(
          and(
            eq(contractorDocuments.tenantId, ctx.tenantId),
            eq(contractorDocuments.contractorId, input.id),
          ),
        )
        .orderBy(desc(contractorDocuments.createdAt));

      // CT-C09: "was their insurance in force on the day of the incident"
      // is the question this register exists to answer.
      const t = asOfDay(input.asOf);
      const docsByReq = new Map<string, DocRow[]>();
      for (const d of docs) {
        const arr = docsByReq.get(d.requirementId) ?? [];
        arr.push({
          requirementId: d.requirementId,
          status: d.status,
          startDate: d.startDate,
          endDate: d.endDate,
        });
        docsByReq.set(d.requirementId, arr);
      }

      const requirements = reqs.map((r) => ({
        ...r,
        satisfied: requirementSatisfied(docsByReq.get(r.id) ?? [], t),
        documents: docs.filter((d) => d.requirementId === r.id),
      }));

      const derivedComplianceStatus = computeStatus(
        reqs.map((r) => ({ id: r.id, blocking: r.blocking })),
        docsByReq,
        t,
      );
      return {
        contractor,
        requirements,
        complianceStatus: contractor.complianceOverride ?? derivedComplianceStatus,
        derivedComplianceStatus,
        /** The day this answer is for — today unless asked otherwise. */
        asOf: t,
      };
    }),

  create: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(
      z.object({
        name: z.string().min(1).max(200),
        category: z.string().max(120).nullable().optional(),
        primaryContactName: z.string().max(200).nullable().optional(),
        primaryContactEmail: z.string().email().max(200).nullable().optional(),
        locale: contactLocale,
        notes: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      await ctx.db.insert(contractors).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name.trim(),
        category: input.category ?? null,
        primaryContactName: input.primaryContactName ?? null,
        primaryContactEmail: input.primaryContactEmail ?? null,
        locale: input.locale ?? null,
        notes: input.notes ?? null,
        // CT-W01: mint the public upload capability up front. Without it the
        // expiry reminder has no link to offer and degrades to the sign-in
        // page — a dead end for an external contact who has no account.
        // Same entropy and shape as `regenerateUploadLink`, which still
        // rotates it on demand.
        uploadToken: randomBytes(24).toString('hex'),
      });
      // Auto-apply trade templates matching the category.
      const category = input.category?.trim();
      if (category !== undefined && category !== '') {
        await applyTemplatesForCategory(ctx.db, ctx.tenantId, id, category);
      }
      return { id };
    }),

  update: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(
      z.object({
        id: z.string().length(26),
        name: z.string().min(1).max(200).optional(),
        category: z.string().max(120).nullable().optional(),
        status: z.enum(['active', 'inactive']).optional(),
        primaryContactName: z.string().max(200).nullable().optional(),
        primaryContactEmail: z.string().email().max(200).nullable().optional(),
        locale: contactLocale,
        notes: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadContractorOrThrow(ctx.db, ctx.tenantId, input.id);
      const updates: Partial<typeof contractors.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name.trim();
      if (input.category !== undefined) updates.category = input.category;
      if (input.status !== undefined) updates.status = input.status;
      if (input.primaryContactName !== undefined)
        updates.primaryContactName = input.primaryContactName;
      if (input.primaryContactEmail !== undefined)
        updates.primaryContactEmail = input.primaryContactEmail;
      if (input.locale !== undefined) updates.locale = input.locale;
      if (input.notes !== undefined) updates.notes = input.notes;
      await ctx.db
        .update(contractors)
        .set(updates)
        .where(and(eq(contractors.tenantId, ctx.tenantId), eq(contractors.id, input.id)));
      return { ok: true as const };
    }),

  /**
   * Manually override (or clear) a contractor's compliance status. Passing
   * `override: null` reverts to the document-derived status.
   */
  setComplianceOverride: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(
      z.object({
        id: z.string().length(26),
        override: z.enum(['compliant', 'non_compliant', 'suspended']).nullable(),
        reason: z.string().max(1000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadContractorOrThrow(ctx.db, ctx.tenantId, input.id);
      await ctx.db
        .update(contractors)
        .set({
          complianceOverride: input.override,
          complianceOverrideReason:
            input.override === null ? null : (input.reason?.trim() ?? null) || null,
          updatedAt: new Date(),
        })
        .where(and(eq(contractors.tenantId, ctx.tenantId), eq(contractors.id, input.id)));
      return { ok: true as const };
    }),

  archive: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      // CT-T03b: this was the one mutation that skipped the loader, so an
      // unknown id — or another tenant's — returned ok:true and the UI
      // toasted "Archived" for a contractor that is still live.
      await loadContractorOrThrow(ctx.db, ctx.tenantId, input.id);
      await ctx.db
        .update(contractors)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(contractors.tenantId, ctx.tenantId), eq(contractors.id, input.id)));
      return { ok: true as const };
    }),

  // ─── Requirements ──────────────────────────────────────────────────────
  addRequirement: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(
      z.object({
        contractorId: z.string().length(26),
        name: z.string().min(1).max(200),
        blocking: z.boolean().default(true),
        recurrenceMonths: z.number().int().min(1).max(120).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadActiveContractorOrThrow(ctx.db, ctx.tenantId, input.contractorId);
      const id = newId();
      await ctx.db.insert(contractorRequirements).values({
        id,
        tenantId: ctx.tenantId,
        contractorId: input.contractorId,
        name: input.name.trim(),
        blocking: input.blocking,
        recurrenceMonths: input.recurrenceMonths ?? null,
      });
      return { id };
    }),

  removeRequirement: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(contractorRequirements)
        .where(
          and(
            eq(contractorRequirements.tenantId, ctx.tenantId),
            eq(contractorRequirements.id, input.id),
          ),
        );
      return { ok: true as const };
    }),

  // ─── Documents ─────────────────────────────────────────────────────────
  addDocument: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(
      z.object({
        requirementId: z.string().length(26),
        storageKey: z.string().min(1).max(1000),
        filename: z.string().min(1).max(500),
        mimeType: z.string().min(1).max(200),
        sizeBytes: z.number().int().min(0),
        startDate: dateStr,
        endDate: dateStr,
        /** CT-U01: an explicit "this document never expires" assertion. */
        noExpiry: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertStorageKeyInTenant(ctx.tenantId, input.storageKey);
      const reqRows = await ctx.db
        .select({
          contractorId: contractorRequirements.contractorId,
          recurrenceMonths: contractorRequirements.recurrenceMonths,
        })
        .from(contractorRequirements)
        .where(
          and(
            eq(contractorRequirements.tenantId, ctx.tenantId),
            eq(contractorRequirements.id, input.requirementId),
          ),
        )
        .limit(1);
      const requirement = reqRows[0];
      if (requirement === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      const contractorId = requirement.contractorId;

      // CT-U01: the same rule the public portal route runs. A null expiry
      // is read downstream as "valid forever" and is skipped by the chase
      // worker, so leaving both date boxes blank must not be a way to
      // reach it — here as much as on the contractor's own form.
      const period = validateDocumentPeriod({
        startDate: input.startDate ?? '',
        endDate: input.endDate ?? '',
        noExpiry: input.noExpiry,
        recurrenceMonths: requirement.recurrenceMonths,
        today: todayIso(),
        // Staff may record evidence that has already lapsed; only the
        // contractor's self-service portal refuses it.
        rejectExpired: false,
      });
      if (!period.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: period.error });
      }

      const id = newId();
      await ctx.db.insert(contractorDocuments).values({
        id,
        tenantId: ctx.tenantId,
        contractorId,
        requirementId: input.requirementId,
        storageKey: input.storageKey,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        status: 'pending',
        uploadedByUserId: ctx.auth.userId,
      });
      return { id };
    }),

  verifyDocument: tenantProcedure
    .use(requirePermission('contractors.verifyDocs'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(contractorDocuments)
        .set({
          status: 'verified',
          rejectReason: null,
          verifiedByUserId: ctx.auth.userId,
          verifiedAt: new Date(),
        })
        .where(
          and(eq(contractorDocuments.tenantId, ctx.tenantId), eq(contractorDocuments.id, input.id)),
        );
      return { ok: true as const };
    }),

  rejectDocument: tenantProcedure
    .use(requirePermission('contractors.verifyDocs'))
    .input(z.object({ id: z.string().length(26), reason: z.string().max(1000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(contractorDocuments)
        .set({
          status: 'rejected',
          rejectReason: input.reason,
          verifiedByUserId: ctx.auth.userId,
          verifiedAt: new Date(),
        })
        .where(
          and(eq(contractorDocuments.tenantId, ctx.tenantId), eq(contractorDocuments.id, input.id)),
        );
      return { ok: true as const };
    }),

  // ─── Requirement trade templates ───────────────────────────────────────
  templates: router({
    list: tenantProcedure.use(requirePermission('contractors.view')).query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(contractorRequirementTemplates)
        .where(eq(contractorRequirementTemplates.tenantId, ctx.tenantId))
        .orderBy(contractorRequirementTemplates.category, contractorRequirementTemplates.name);
    }),
    create: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          category: z.string().min(1).max(120),
          name: z.string().min(1).max(200),
          blocking: z.boolean().default(true),
          recurrenceMonths: z.number().int().min(1).max(120).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = newId();
        await ctx.db.insert(contractorRequirementTemplates).values({
          id,
          tenantId: ctx.tenantId,
          category: input.category.trim(),
          name: input.name.trim(),
          blocking: input.blocking,
          recurrenceMonths: input.recurrenceMonths ?? null,
        });
        return { id };
      }),
    remove: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(contractorRequirementTemplates)
          .where(
            and(
              eq(contractorRequirementTemplates.tenantId, ctx.tenantId),
              eq(contractorRequirementTemplates.id, input.id),
            ),
          );
        return { ok: true as const };
      }),
  }),

  /** Apply the contractor's category templates on demand. */
  applyTemplates: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const c = await loadActiveContractorOrThrow(ctx.db, ctx.tenantId, input.id);
      if (c.category === null || c.category === '') return { applied: 0 };
      const applied = await applyTemplatesForCategory(ctx.db, ctx.tenantId, input.id, c.category);
      return { applied };
    }),

  // ─── Public upload portal (no login) ───────────────────────────────────
  /** Regenerate (or create) the opaque token for the public upload link. */
  regenerateUploadLink: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await loadActiveContractorOrThrow(ctx.db, ctx.tenantId, input.id);
      const token = randomBytes(24).toString('hex');
      await ctx.db
        .update(contractors)
        .set({ uploadToken: token, updatedAt: new Date() })
        .where(and(eq(contractors.tenantId, ctx.tenantId), eq(contractors.id, input.id)));
      return { token };
    }),

  /** Public: resolve a contractor by its upload token (name + requirements only). */
  publicByToken: publicProcedure
    .input(z.object({ token: z.string().min(10).max(200) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ id: contractors.id, name: contractors.name, tenantId: contractors.tenantId })
        .from(contractors)
        .where(and(eq(contractors.uploadToken, input.token), isNull(contractors.archivedAt)))
        .limit(1);
      const c = rows[0];
      if (c === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      const reqs = await ctx.db
        .select({
          id: contractorRequirements.id,
          name: contractorRequirements.name,
          blocking: contractorRequirements.blocking,
          // CT-U01: the portal cannot ask for an expiry — or refuse the
          // "never expires" box — without knowing the renewal cycle.
          recurrenceMonths: contractorRequirements.recurrenceMonths,
        })
        .from(contractorRequirements)
        .where(
          and(
            eq(contractorRequirements.tenantId, c.tenantId),
            eq(contractorRequirements.contractorId, c.id),
          ),
        )
        .orderBy(contractorRequirements.createdAt);
      return { contractorName: c.name, requirements: reqs };
    }),

  // ─── Visits / calendar (Phase 2a) ──────────────────────────────────────
  visits: router({
    /** Visits overlapping a [from, to] date-range — powers the calendar. */
    list: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(
        z.object({
          from: isoDateTime,
          to: isoDateTime,
          contractorId: z.string().length(26).optional(),
          siteId: z.string().length(26).optional(),
          /**
           * CT-V02: a bound, not a cursor. Nobody pages a calendar — the
           * grid is a fixed six weeks. What the caller needs is not to
           * silently drop visits off the end of a busy month.
           */
          limit: z.number().int().min(1).max(2000).default(500),
        }),
      )
      .query(async ({ ctx, input }) => {
        const authorizer = aliasedTable(user, 'visit_authorizer');
        const conds = [
          eq(contractorVisits.tenantId, ctx.tenantId),
          isNull(contractorVisits.archivedAt),
          between(contractorVisits.scheduledStart, new Date(input.from), new Date(input.to)),
        ];
        if (input.contractorId !== undefined)
          conds.push(eq(contractorVisits.contractorId, input.contractorId));
        if (input.siteId !== undefined) conds.push(eq(contractorVisits.siteId, input.siteId));
        return ctx.db
          .select({
            id: contractorVisits.id,
            contractorId: contractorVisits.contractorId,
            contractorName: contractors.name,
            siteId: contractorVisits.siteId,
            siteName: sites.name,
            title: contractorVisits.title,
            status: contractorVisits.status,
            scheduledStart: contractorVisits.scheduledStart,
            scheduledEnd: contractorVisits.scheduledEnd,
            isWalkIn: contractorVisits.isWalkIn,
            authorizedByName: authorizer.name,
            checkedInAt: contractorVisits.checkedInAt,
            checkedOutAt: contractorVisits.checkedOutAt,
          })
          .from(contractorVisits)
          .innerJoin(contractors, eq(contractorVisits.contractorId, contractors.id))
          .leftJoin(sites, eq(contractorVisits.siteId, sites.id))
          .leftJoin(authorizer, eq(contractorVisits.authorizedByUserId, authorizer.id))
          .where(and(...conds))
          .orderBy(asc(contractorVisits.scheduledStart))
          .limit(input.limit);
      }),

    /**
     * Everyone currently on site — visits checked-in but not yet checked-out.
     * Powers the gate guard's "who is still inside" board on the directory.
     */
    onSiteNow: tenantProcedure.use(requirePermission('contractors.view')).query(async ({ ctx }) => {
      return ctx.db
        .select({
          id: contractorVisits.id,
          contractorId: contractorVisits.contractorId,
          contractorName: contractors.name,
          title: contractorVisits.title,
          visitorName: contractorVisits.visitorName,
          siteName: sites.name,
          isWalkIn: contractorVisits.isWalkIn,
          checkedInAt: contractorVisits.checkedInAt,
        })
        .from(contractorVisits)
        .innerJoin(contractors, eq(contractorVisits.contractorId, contractors.id))
        .leftJoin(sites, eq(contractorVisits.siteId, sites.id))
        .where(
          and(
            eq(contractorVisits.tenantId, ctx.tenantId),
            isNull(contractorVisits.archivedAt),
            eq(contractorVisits.status, 'checked_in'),
          ),
        )
        .orderBy(desc(contractorVisits.checkedInAt));
    }),

    /**
     * PF-19: the join the review found missing — "which permits are open for
     * contractors currently on site?". Bridges checked-in visits to open
     * permits through the contractor's portal users (acceptor / issuer /
     * authoriser).
     */
    onSiteWithOpenPermits: tenantProcedure
      .use(requirePermission('contractors.view'))
      .query(async ({ ctx }) => {
        const onSite = await ctx.db
          .select({
            visitId: contractorVisits.id,
            visitTitle: contractorVisits.title,
            contractorId: contractorVisits.contractorId,
            contractorName: contractors.name,
          })
          .from(contractorVisits)
          .innerJoin(contractors, eq(contractorVisits.contractorId, contractors.id))
          .where(
            and(
              eq(contractorVisits.tenantId, ctx.tenantId),
              eq(contractorVisits.status, 'checked_in'),
              isNull(contractorVisits.archivedAt),
            ),
          );
        if (onSite.length === 0) return [];
        const contractorIds = [...new Set(onSite.map((v) => v.contractorId))];
        const members = await ctx.db
          .select({
            contractorId: contractorUsers.contractorId,
            userId: contractorUsers.userId,
          })
          .from(contractorUsers)
          .where(
            and(
              eq(contractorUsers.tenantId, ctx.tenantId),
              inArray(contractorUsers.contractorId, contractorIds),
            ),
          );
        if (members.length === 0) return [];
        const contractorByUser = new Map(members.map((m) => [m.userId, m.contractorId]));
        const openPermits = await ctx.db
          .select({
            id: permits.id,
            referenceNumber: permits.referenceNumber,
            title: permits.title,
            status: permits.status,
            validTo: permits.validTo,
            acceptorUserId: permits.acceptorUserId,
            issuerUserId: permits.issuerUserId,
            authoriserUserId: permits.authoriserUserId,
          })
          .from(permits)
          .where(
            and(
              eq(permits.tenantId, ctx.tenantId),
              inArray(permits.status, [...OPEN_PERMIT_STATUSES]),
            ),
          );
        const byContractor = new Map<string, typeof openPermits>();
        for (const pRow of openPermits) {
          const holders = [pRow.acceptorUserId, pRow.issuerUserId, pRow.authoriserUserId];
          const cids = new Set(
            holders.flatMap((u) => {
              const cid = u === null ? undefined : contractorByUser.get(u);
              return cid === undefined ? [] : [cid];
            }),
          );
          for (const cid of cids) {
            const arr = byContractor.get(cid) ?? [];
            arr.push(pRow);
            byContractor.set(cid, arr);
          }
        }
        return onSite.flatMap((v) =>
          (byContractor.get(v.contractorId) ?? []).map((pRow) => ({
            visitId: v.visitId,
            visitTitle: v.visitTitle,
            contractorId: v.contractorId,
            contractorName: v.contractorName,
            permitId: pRow.id,
            permitReference: pRow.referenceNumber,
            permitTitle: pRow.title,
            permitStatus: pRow.status,
            validTo: pRow.validTo,
          })),
        );
      }),

    /** All non-archived visits for one contractor (detail page). */
    listForContractor: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ contractorId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select({
            id: contractorVisits.id,
            siteId: contractorVisits.siteId,
            siteName: sites.name,
            title: contractorVisits.title,
            status: contractorVisits.status,
            scheduledStart: contractorVisits.scheduledStart,
            scheduledEnd: contractorVisits.scheduledEnd,
            isWalkIn: contractorVisits.isWalkIn,
            checkedInAt: contractorVisits.checkedInAt,
            checkedOutAt: contractorVisits.checkedOutAt,
          })
          .from(contractorVisits)
          .leftJoin(sites, eq(contractorVisits.siteId, sites.id))
          .where(
            and(
              eq(contractorVisits.tenantId, ctx.tenantId),
              eq(contractorVisits.contractorId, input.contractorId),
              isNull(contractorVisits.archivedAt),
            ),
          )
          .orderBy(desc(contractorVisits.scheduledStart));
      }),

    get: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ id: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        const authorizer = aliasedTable(user, 'visit_authorizer');
        const rows = await ctx.db
          .select({
            visit: contractorVisits,
            contractorName: contractors.name,
            siteName: sites.name,
            authorizedByName: authorizer.name,
          })
          .from(contractorVisits)
          .innerJoin(contractors, eq(contractorVisits.contractorId, contractors.id))
          .leftJoin(sites, eq(contractorVisits.siteId, sites.id))
          .leftJoin(authorizer, eq(contractorVisits.authorizedByUserId, authorizer.id))
          .where(
            and(
              eq(contractorVisits.tenantId, ctx.tenantId),
              eq(contractorVisits.id, input.id),
              isNull(contractorVisits.archivedAt),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        return row;
      }),

    /** Schedule a planned visit. `authorize` stamps the caller as authoriser. */
    create: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          contractorId: z.string().length(26),
          siteId: z.string().length(26).nullable().optional(),
          title: z.string().min(1).max(300),
          visitorName: z.string().max(300).nullable().optional(),
          scheduledStart: isoDateTime,
          scheduledEnd: isoDateTime.nullable().optional(),
          notes: z.string().max(5000).nullable().optional(),
          authorize: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await loadActiveContractorOrThrow(ctx.db, ctx.tenantId, input.contractorId);
        await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
        const id = newId();
        await ctx.db.insert(contractorVisits).values({
          id,
          tenantId: ctx.tenantId,
          contractorId: input.contractorId,
          siteId: input.siteId ?? null,
          title: input.title.trim(),
          visitorName: input.visitorName?.trim() ? input.visitorName.trim() : null,
          scheduledStart: new Date(input.scheduledStart),
          scheduledEnd: input.scheduledEnd != null ? new Date(input.scheduledEnd) : null,
          notes: input.notes ?? null,
          createdByUserId: ctx.auth.userId,
          ...(input.authorize ? { authorizedByUserId: ctx.auth.userId } : {}),
        });
        return { id };
      }),

    /** Log an unplanned arrival — created already checked-in at the gate. */
    createWalkIn: tenantProcedure
      // CT-P03: reception operates the gate without holding the module's
      // admin key. `contractors.gate` existed in the catalogue but gated no
      // procedure — ticking it granted nothing, and the only way to let a
      // receptionist check someone in was `contractors.manage`, which also
      // authorises rename, archive, delete and token rotation.
      .use(requireAnyPermission('contractors.manage', 'contractors.gate'))
      .input(
        z.object({
          contractorId: z.string().length(26),
          siteId: z.string().length(26).nullable().optional(),
          title: z.string().min(1).max(300),
          visitorName: z.string().max(300).nullable().optional(),
          notes: z.string().max(5000).nullable().optional(),
          overrideReason: z.string().max(1000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await loadActiveContractorOrThrow(ctx.db, ctx.tenantId, input.contractorId);
        await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
        // PF-19: walk-ins pass the same compliance gate as staff check-in.
        const compliance = await contractorComplianceStatus(
          ctx.db,
          ctx.tenantId,
          input.contractorId,
        );
        // CT-G08: a suspension is an explicit decision that this contractor
        // does not come on site, so a desk override cannot waive it. Missing
        // paperwork still can, with a recorded reason.
        if (complianceBarsEntry(compliance)) {
          const waived =
            complianceOverridable(compliance) && (input.overrideReason ?? '').trim() !== '';
          if (!waived) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message:
                compliance === 'suspended' ? 'contractor_suspended' : 'contractor_non_compliant',
            });
          }
        }
        const now = new Date();
        const id = newId();
        await ctx.db.insert(contractorVisits).values({
          id,
          tenantId: ctx.tenantId,
          contractorId: input.contractorId,
          siteId: input.siteId ?? null,
          title: input.title.trim(),
          visitorName: input.visitorName?.trim() ? input.visitorName.trim() : null,
          status: 'checked_in',
          scheduledStart: now,
          isWalkIn: true,
          authorizedByUserId: ctx.auth.userId,
          checkedInAt: now,
          notes: input.notes ?? null,
          createdByUserId: ctx.auth.userId,
        });
        await insertVisitEvent(ctx.db, {
          tenantId: ctx.tenantId,
          visitId: id,
          contractorId: input.contractorId,
          eventType: 'check_in',
          method: 'staff',
          actorUserId: ctx.auth.userId,
          ...(input.overrideReason !== undefined ? { overrideReason: input.overrideReason } : {}),
        });
        return { id };
      }),

    update: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          id: z.string().length(26),
          title: z.string().min(1).max(300).optional(),
          siteId: z.string().length(26).nullable().optional(),
          scheduledStart: isoDateTime.optional(),
          scheduledEnd: isoDateTime.nullable().optional(),
          notes: z.string().max(5000).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await loadVisitOrThrow(ctx.db, ctx.tenantId, input.id);
        await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
        const updates: Partial<typeof contractorVisits.$inferInsert> = { updatedAt: new Date() };
        if (input.title !== undefined) updates.title = input.title.trim();
        if (input.siteId !== undefined) updates.siteId = input.siteId;
        if (input.scheduledStart !== undefined)
          updates.scheduledStart = new Date(input.scheduledStart);
        if (input.scheduledEnd !== undefined)
          updates.scheduledEnd = input.scheduledEnd === null ? null : new Date(input.scheduledEnd);
        if (input.notes !== undefined) updates.notes = input.notes;
        await ctx.db
          .update(contractorVisits)
          .set(updates)
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        return { ok: true as const };
      }),

    /** Approve a scheduled visit (authoriser == approval). */
    authorize: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        await loadVisitOrThrow(ctx.db, ctx.tenantId, input.id);
        await ctx.db
          .update(contractorVisits)
          .set({ authorizedByUserId: ctx.auth.userId, updatedAt: new Date() })
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        return { ok: true as const };
      }),

    checkIn: tenantProcedure
      // CT-P03: reception operates the gate without holding the module's
      // admin key. `contractors.gate` existed in the catalogue but gated no
      // procedure — ticking it granted nothing, and the only way to let a
      // receptionist check someone in was `contractors.manage`, which also
      // authorises rename, archive, delete and token rotation.
      .use(requireAnyPermission('contractors.manage', 'contractors.gate'))
      .input(
        z.object({
          id: z.string().length(26),
          capturedFields: capturedFieldsSchema.optional(),
          overrideReason: z.string().max(1000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const visit = await loadVisitOrThrow(ctx.db, ctx.tenantId, input.id);
        // CT-L01..L05: one state machine, shared with the kiosk, instead of
        // each procedure guarding one condition and none guarding status.
        const transitionError = visitTransitionError({
          status: visit.status,
          transition: 'check_in',
        });
        if (transitionError !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: transitionError });
        }
        // CT-L01: the kiosk refused a blank required question and the desk
        // did not, so a staff-recorded arrival produced an event
        // indistinguishable from one where the induction question was asked.
        const requiredFields = await ctx.db
          .select({
            id: contractorGateFields.id,
            label: contractorGateFields.label,
            required: contractorGateFields.required,
          })
          .from(contractorGateFields)
          .where(
            and(
              eq(contractorGateFields.tenantId, ctx.tenantId),
              isNull(contractorGateFields.archivedAt),
            ),
          );
        const missing = firstMissingGateField(requiredFields, input.capturedFields ?? {});
        if (missing !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'gate_field_required' });
        }
        // PF-19: a non-compliant contractor does not walk through the gate.
        // Staff may override — with a recorded reason.
        const compliance = await contractorComplianceStatus(
          ctx.db,
          ctx.tenantId,
          visit.contractorId,
        );
        // CT-G08: a suspension is an explicit decision that this contractor
        // does not come on site, so a desk override cannot waive it. This
        // read `=== 'non_compliant'`, and an override REPLACES the derived
        // status — so suspending a contractor whose paperwork had also
        // lapsed converted a refusal into an admission.
        if (complianceBarsEntry(compliance)) {
          const waived =
            complianceOverridable(compliance) && (input.overrideReason ?? '').trim() !== '';
          if (!waived) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message:
                compliance === 'suspended' ? 'contractor_suspended' : 'contractor_non_compliant',
            });
          }
        }
        const now = new Date();
        await ctx.db
          .update(contractorVisits)
          // CT-L04: clear any previous departure. Re-entry used to leave a
          // row reading `checked_in` while carrying a past `checkedOutAt` —
          // unresolvable on the board.
          .set({ status: 'checked_in', checkedInAt: now, checkedOutAt: null, updatedAt: now })
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        await insertVisitEvent(ctx.db, {
          tenantId: ctx.tenantId,
          visitId: visit.id,
          contractorId: visit.contractorId,
          eventType: 'check_in',
          method: 'staff',
          actorUserId: ctx.auth.userId,
          ...(input.capturedFields !== undefined ? { capturedFields: input.capturedFields } : {}),
          ...(input.overrideReason !== undefined ? { overrideReason: input.overrideReason } : {}),
        });
        return { ok: true as const };
      }),

    checkOut: tenantProcedure
      // CT-P03: reception operates the gate without holding the module's
      // admin key. `contractors.gate` existed in the catalogue but gated no
      // procedure — ticking it granted nothing, and the only way to let a
      // receptionist check someone in was `contractors.manage`, which also
      // authorises rename, archive, delete and token rotation.
      .use(requireAnyPermission('contractors.manage', 'contractors.gate'))
      .input(
        z.object({
          id: z.string().length(26),
          capturedFields: capturedFieldsSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const visit = await loadVisitOrThrow(ctx.db, ctx.tenantId, input.id);
        // CT-L03: guarding only "never checked in" let a second tap move
        // `checkedOutAt` forward and overwrite the real departure time —
        // the one fact this record exists to preserve.
        const transitionError = visitTransitionError({
          status: visit.status,
          transition: 'check_out',
        });
        if (transitionError !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: transitionError });
        }
        const now = new Date();
        await ctx.db
          .update(contractorVisits)
          .set({ status: 'checked_out', checkedOutAt: now, updatedAt: now })
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        await insertVisitEvent(ctx.db, {
          tenantId: ctx.tenantId,
          visitId: visit.id,
          contractorId: visit.contractorId,
          eventType: 'check_out',
          method: 'staff',
          actorUserId: ctx.auth.userId,
          ...(input.capturedFields !== undefined ? { capturedFields: input.capturedFields } : {}),
        });
        return { ok: true as const };
      }),

    /** Audit log of gate events for a visit (newest first). */
    events: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ visitId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select({
            id: contractorVisitEvents.id,
            eventType: contractorVisitEvents.eventType,
            method: contractorVisitEvents.method,
            overrideReason: contractorVisitEvents.overrideReason,
            capturedFields: contractorVisitEvents.capturedFields,
            actorName: user.name,
            at: contractorVisitEvents.at,
          })
          .from(contractorVisitEvents)
          .leftJoin(user, eq(contractorVisitEvents.actorUserId, user.id))
          .where(
            and(
              eq(contractorVisitEvents.tenantId, ctx.tenantId),
              eq(contractorVisitEvents.visitId, input.visitId),
            ),
          )
          .orderBy(desc(contractorVisitEvents.at));
      }),

    /** Set a terminal non-attended status: `cancelled` or `no_show`. */
    setStatus: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26), status: z.enum(['cancelled', 'no_show']) }))
      .mutation(async ({ ctx, input }) => {
        const visit = await loadVisitOrThrow(ctx.db, ctx.tenantId, input.id);
        // CT-L02: neither terminal status is reachable for someone standing
        // on site. Cancelling leaves them on the on-site board with no
        // departure, exactly like deleting them; and a person who scanned
        // in is by definition not a no-show. Check them out first.
        const transitionError = visitTransitionError({
          status: visit.status,
          transition: 'cancel',
        });
        if (transitionError !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: transitionError });
        }
        await ctx.db
          .update(contractorVisits)
          .set({ status: input.status, updatedAt: new Date() })
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        return { ok: true as const };
      }),

    delete: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        const visit = await loadVisitOrThrow(ctx.db, ctx.tenantId, input.id);
        // CT-L02: the on-site board is what a fire marshal reads at the
        // assembly point. Archiving a checked-in visit erased someone
        // physically present, with no check-out and no record they left.
        const transitionError = visitTransitionError({
          status: visit.status,
          transition: 'delete',
        });
        if (transitionError !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: transitionError });
        }
        await ctx.db
          .update(contractorVisits)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        return { ok: true as const };
      }),
  }),

  // ─── Gate: company-configurable capture fields (Phase 2b) ──────────────
  gateFields: router({
    list: tenantProcedure.use(requirePermission('contractors.view')).query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(contractorGateFields)
        .where(
          and(
            eq(contractorGateFields.tenantId, ctx.tenantId),
            isNull(contractorGateFields.archivedAt),
          ),
        )
        .orderBy(asc(contractorGateFields.sortOrder), asc(contractorGateFields.createdAt));
    }),
    create: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          label: z.string().min(1).max(200),
          fieldType: z.enum(['text', 'number', 'yes_no']).default('text'),
          required: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select({ sortOrder: contractorGateFields.sortOrder })
          .from(contractorGateFields)
          .where(
            and(
              eq(contractorGateFields.tenantId, ctx.tenantId),
              isNull(contractorGateFields.archivedAt),
            ),
          );
        const nextOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder + 1), 0);
        const id = newId();
        await ctx.db.insert(contractorGateFields).values({
          id,
          tenantId: ctx.tenantId,
          label: input.label.trim(),
          fieldType: input.fieldType,
          required: input.required,
          sortOrder: nextOrder,
        });
        return { id };
      }),
    update: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          id: z.string().length(26),
          label: z.string().min(1).max(200).optional(),
          fieldType: z.enum(['text', 'number', 'yes_no']).optional(),
          required: z.boolean().optional(),
          sortOrder: z.number().int().min(0).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const updates: Partial<typeof contractorGateFields.$inferInsert> = {};
        if (input.label !== undefined) updates.label = input.label.trim();
        if (input.fieldType !== undefined) updates.fieldType = input.fieldType;
        if (input.required !== undefined) updates.required = input.required;
        if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;
        await ctx.db
          .update(contractorGateFields)
          .set(updates)
          .where(
            and(
              eq(contractorGateFields.tenantId, ctx.tenantId),
              eq(contractorGateFields.id, input.id),
            ),
          );
        return { ok: true as const };
      }),
    remove: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        // Soft-archive so historical event answers keep resolving their label.
        await ctx.db
          .update(contractorGateFields)
          .set({ archivedAt: new Date() })
          .where(
            and(
              eq(contractorGateFields.tenantId, ctx.tenantId),
              eq(contractorGateFields.id, input.id),
            ),
          );
        return { ok: true as const };
      }),
  }),

  // ─── Gate: self-scan kiosk (Phase 2b) ──────────────────────────────────
  gate: router({
    /**
     * Every kiosk token this tenant holds: the legacy tenant-wide one
     * (`siteId: null`, if it still exists) plus one per site.
     *
     * CT-G06: this used to return a single tenant-wide token, which is the
     * shape that made one screen's token unlock every screen.
     */
    config: tenantProcedure.use(requirePermission('contractors.manage')).query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: contractorGateConfig.id,
          siteId: contractorGateConfig.siteId,
          siteName: sites.name,
          gateToken: contractorGateConfig.gateToken,
          updatedAt: contractorGateConfig.updatedAt,
        })
        .from(contractorGateConfig)
        .leftJoin(sites, eq(contractorGateConfig.siteId, sites.id))
        .where(eq(contractorGateConfig.tenantId, ctx.tenantId))
        .orderBy(asc(sites.name));
      return {
        // Kept for the legacy single-token view; null once the tenant-wide
        // row has been revoked in favour of per-site screens.
        gateToken: rows.find((r) => r.siteId === null)?.gateToken ?? null,
        kiosks: rows,
      };
    }),
    /**
     * Mint (or rotate) the token for ONE kiosk. Omitting `siteId` targets
     * the legacy tenant-wide row, so existing behaviour is unchanged until
     * an administrator deliberately moves to per-site screens.
     */
    regenerateToken: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ siteId: z.string().length(26).nullable().optional() }).optional())
      .mutation(async ({ ctx, input }) => {
        const siteId = input?.siteId ?? null;
        if (siteId !== null) await assertSitesInTenant(ctx.db, ctx.tenantId, [siteId]);
        const token = randomBytes(24).toString('hex');
        const existing = await ctx.db
          .select({ id: contractorGateConfig.id })
          .from(contractorGateConfig)
          .where(
            and(
              eq(contractorGateConfig.tenantId, ctx.tenantId),
              siteId === null
                ? isNull(contractorGateConfig.siteId)
                : eq(contractorGateConfig.siteId, siteId),
            ),
          )
          .limit(1);
        const row = existing[0];
        if (row === undefined) {
          await ctx.db.insert(contractorGateConfig).values({
            id: newId(),
            tenantId: ctx.tenantId,
            siteId,
            gateToken: token,
          });
        } else {
          await ctx.db
            .update(contractorGateConfig)
            .set({ gateToken: token, updatedAt: new Date() })
            .where(eq(contractorGateConfig.id, row.id));
        }
        return { token };
      }),
    /**
     * Take one kiosk offline. This is what makes per-site tokens worth
     * having: revoking a compromised screen must not kill the rest, and
     * retiring the legacy tenant-wide token is the last step of the
     * migration to per-site screens.
     */
    revokeToken: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ siteId: z.string().length(26).nullable().optional() }).optional())
      .mutation(async ({ ctx, input }) => {
        const siteId = input?.siteId ?? null;
        const deleted = await ctx.db
          .delete(contractorGateConfig)
          .where(
            and(
              eq(contractorGateConfig.tenantId, ctx.tenantId),
              siteId === null
                ? isNull(contractorGateConfig.siteId)
                : eq(contractorGateConfig.siteId, siteId),
            ),
          )
          .returning({ id: contractorGateConfig.id });
        // Report honestly rather than toasting "revoked" for a token that
        // was never there.
        return { revoked: deleted.length };
      }),

    /** Public: resolve the kiosk by token — today's visits + capture fields. */
    publicByToken: publicProcedure
      .input(z.object({ token: z.string().min(10).max(200) }))
      .query(async ({ ctx, input }) => {
        // CT-G06: a token now resolves to a tenant AND (optionally) a site.
        const kiosk = await resolveKioskOrThrow(ctx.db, input.token);
        const { tenantId, siteId } = kiosk;

        const now = Date.now();
        const from = new Date(now - 24 * 3_600_000);
        const to = new Date(now + 24 * 3_600_000);
        const visits = await ctx.db
          .select({
            id: contractorVisits.id,
            contractorId: contractorVisits.contractorId,
            contractorName: contractors.name,
            title: contractorVisits.title,
            status: contractorVisits.status,
            scheduledStart: contractorVisits.scheduledStart,
          })
          .from(contractorVisits)
          .innerJoin(contractors, eq(contractorVisits.contractorId, contractors.id))
          .where(
            and(
              eq(contractorVisits.tenantId, tenantId),
              isNull(contractorVisits.archivedAt),
              inArray(contractorVisits.status, ['scheduled', 'checked_in']),
              // CT-G06: a site-bound kiosk shows its own site's arrivals and
              // the ones nobody assigned a site to. Hiding the un-sited ones
              // would strand anybody already checked in under such a visit
              // with no screen to check out from — `contractorVisits.siteId`
              // is nullable and `visits.create` never required it, so most
              // existing rows are exactly that shape.
              ...(siteId === null
                ? []
                : [or(eq(contractorVisits.siteId, siteId), isNull(contractorVisits.siteId))]),
              // CT-L05: anyone already ON SITE stays on the kiosk whatever
              // their scheduled start. The ±24h window used to drop
              // multi-day jobs and anyone who overran, so the only screen
              // they had stopped offering them a way out — they sat on the
              // on-site board indefinitely while the overstay alert fired
              // hourly with no way for them to clear it.
              or(
                eq(contractorVisits.status, 'checked_in'),
                between(contractorVisits.scheduledStart, from, to),
              ),
            ),
          )
          .orderBy(asc(contractorVisits.scheduledStart));

        const fields = await ctx.db
          .select({
            id: contractorGateFields.id,
            label: contractorGateFields.label,
            fieldType: contractorGateFields.fieldType,
            required: contractorGateFields.required,
          })
          .from(contractorGateFields)
          .where(
            and(
              eq(contractorGateFields.tenantId, tenantId),
              isNull(contractorGateFields.archivedAt),
            ),
          )
          .orderBy(asc(contractorGateFields.sortOrder), asc(contractorGateFields.createdAt));

        // PF-19: the kiosk shows compliance so a blocked check-in is not a
        // surprise. One derivation per distinct contractor on today's list.
        const complianceByContractor = new Map<string, EffectiveComplianceStatus>();
        for (const cid of new Set(visits.map((v) => v.contractorId))) {
          complianceByContractor.set(cid, await contractorComplianceStatus(ctx.db, tenantId, cid));
        }
        return {
          siteId,
          siteName: kiosk.siteName,
          visits: visits.map((v) => ({
            ...v,
            complianceStatus: complianceByContractor.get(v.contractorId) ?? 'no_requirements',
          })),
          fields,
        };
      }),

    /** Public: a contractor self-checks-in / out at the kiosk. */
    selfCheckIn: publicProcedure
      .input(
        z.object({
          token: z.string().min(10).max(200),
          visitId: z.string().length(26),
          eventType: z.enum(['check_in', 'check_out']),
          capturedFields: capturedFieldsSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const kiosk = await resolveKioskOrThrow(ctx.db, input.token);
        const { tenantId, siteId } = kiosk;

        const visit = await loadVisitOrThrow(ctx.db, tenantId, input.visitId);
        // CT-G06: a site kiosk must not admit someone booked elsewhere.
        // A visit with no site is admissible anywhere, matching the listing.
        if (siteId !== null && visit.siteId !== null && visit.siteId !== siteId) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }

        // Enforce required capture fields on check-in.
        if (input.eventType === 'check_in') {
          // CT-L01: the same helper the desk runs, so the two paths cannot
          // drift apart again.
          const required = await ctx.db
            .select({
              id: contractorGateFields.id,
              label: contractorGateFields.label,
              required: contractorGateFields.required,
            })
            .from(contractorGateFields)
            .where(
              and(
                eq(contractorGateFields.tenantId, tenantId),
                isNull(contractorGateFields.archivedAt),
              ),
            );
          const missing = firstMissingGateField(required, input.capturedFields ?? {});
          if (missing !== null) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'gate_field_required' });
          }
          // PF-19: the kiosk has no override — a non-compliant contractor is
          // sent to the site office.
          const compliance = await contractorComplianceStatus(ctx.db, tenantId, visit.contractorId);
          if (complianceBarsEntry(compliance)) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message:
                compliance === 'suspended' ? 'contractor_suspended' : 'contractor_non_compliant',
            });
          }
        }
        // CT-G05 / CT-L03: the same state machine the desk runs. A second
        // scan used to re-stamp `checkedInAt`, and the overstay worker
        // measures from that stamp — so a contractor could clear their own
        // overstay alert simply by scanning again.
        const kioskTransitionError = visitTransitionError({
          status: visit.status,
          transition: input.eventType === 'check_in' ? 'check_in' : 'check_out',
        });
        if (kioskTransitionError !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: kioskTransitionError });
        }

        const now = new Date();
        await ctx.db
          .update(contractorVisits)
          .set(
            input.eventType === 'check_in'
              ? // CT-L04: clear any stale departure on re-entry.
                { status: 'checked_in', checkedInAt: now, checkedOutAt: null, updatedAt: now }
              : { status: 'checked_out', checkedOutAt: now, updatedAt: now },
          )
          .where(
            and(eq(contractorVisits.tenantId, tenantId), eq(contractorVisits.id, input.visitId)),
          );
        await insertVisitEvent(ctx.db, {
          tenantId,
          visitId: visit.id,
          contractorId: visit.contractorId,
          eventType: input.eventType,
          method: 'self_scan',
          actorUserId: null,
          ...(input.capturedFields !== undefined ? { capturedFields: input.capturedFields } : {}),
        });
        return { ok: true as const };
      }),
  }),

  // ─── Contractor ↔ asset link (Phase 3) ─────────────────────────────────
  assets: router({
    /** Assets this contractor services. */
    listForContractor: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ contractorId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select({
            linkId: contractorAssets.id,
            assetId: assets.id,
            name: assets.name,
            typeName: assetTypes.name,
            siteName: sites.name,
            note: contractorAssets.note,
          })
          .from(contractorAssets)
          .innerJoin(assets, eq(contractorAssets.assetId, assets.id))
          .leftJoin(assetTypes, eq(assets.typeId, assetTypes.id))
          .leftJoin(sites, eq(assets.siteId, sites.id))
          .where(
            and(
              eq(contractorAssets.tenantId, ctx.tenantId),
              eq(contractorAssets.contractorId, input.contractorId),
              isNull(assets.archivedAt),
            ),
          )
          .orderBy(asc(assets.name));
      }),

    /** Contractors that service this asset. */
    listForAsset: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ assetId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select({
            linkId: contractorAssets.id,
            contractorId: contractors.id,
            name: contractors.name,
            category: contractors.category,
            note: contractorAssets.note,
          })
          .from(contractorAssets)
          .innerJoin(contractors, eq(contractorAssets.contractorId, contractors.id))
          .where(
            and(
              eq(contractorAssets.tenantId, ctx.tenantId),
              eq(contractorAssets.assetId, input.assetId),
              isNull(contractors.archivedAt),
            ),
          )
          .orderBy(asc(contractors.name));
      }),

    link: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          contractorId: z.string().length(26),
          assetId: z.string().length(26),
          note: z.string().max(500).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await loadActiveContractorOrThrow(ctx.db, ctx.tenantId, input.contractorId);
        const assetRows = await ctx.db
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.tenantId, ctx.tenantId), eq(assets.id, input.assetId)))
          .limit(1);
        if (assetRows[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

        const id = newId();
        await ctx.db
          .insert(contractorAssets)
          .values({
            id,
            tenantId: ctx.tenantId,
            contractorId: input.contractorId,
            assetId: input.assetId,
            note: input.note ?? null,
          })
          .onConflictDoNothing({
            target: [contractorAssets.contractorId, contractorAssets.assetId],
          });
        return { ok: true as const };
      }),

    unlink: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(contractorAssets)
          .where(
            and(eq(contractorAssets.tenantId, ctx.tenantId), eq(contractorAssets.id, input.id)),
          );
        return { ok: true as const };
      }),
  }),

  // ─── External contractor users / portal (Phase 4) ──────────────────────
  users: router({
    /** Accepted external users + pending invites for a contractor. */
    list: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ contractorId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        const members = await ctx.db
          .select({
            id: contractorUsers.id,
            userId: contractorUsers.userId,
            name: user.name,
            email: user.email,
            activities: contractorUsers.activities,
            acknowledgedAt: contractorUsers.acknowledgedAt,
            deactivatedAt: user.deactivatedAt,
          })
          .from(contractorUsers)
          .innerJoin(user, eq(contractorUsers.userId, user.id))
          .where(
            and(
              eq(contractorUsers.tenantId, ctx.tenantId),
              eq(contractorUsers.contractorId, input.contractorId),
            ),
          )
          .orderBy(asc(user.name));

        const pending = await ctx.db
          .select({
            id: invitations.id,
            email: invitations.email,
            name: invitations.name,
            activities: invitations.contractorActivities,
            createdAt: invitations.createdAt,
          })
          .from(invitations)
          .where(
            and(
              eq(invitations.tenantId, ctx.tenantId),
              eq(invitations.contractorId, input.contractorId),
              isNull(invitations.acceptedAt),
            ),
          )
          .orderBy(desc(invitations.createdAt));

        return { members, pending };
      }),

    /** Invite a person to the portal as this contractor's user. */
    invite: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          contractorId: z.string().length(26),
          email: z.string().email().max(200),
          name: z.string().max(200).optional(),
          activities: activitiesInput,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const contractor = await loadActiveContractorOrThrow(
          ctx.db,
          ctx.tenantId,
          input.contractorId,
        );
        const emailLower = input.email.trim().toLowerCase();

        const existingUser = await ctx.db
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.tenantId, ctx.tenantId), eq(user.email, emailLower)))
          .limit(1);
        if (existingUser[0] !== undefined) {
          throw new TRPCError({
            code: 'CONFLICT',
            // A slug, not prose: the web layer translates it (every other
            // refusal in this module already arrived as English text in a
            // Japanese toast).
            message: 'contractor-user-email-taken',
          });
        }

        // Per-user, platform-managed permission set derived from activities.
        const permissionSetId = newId();
        await ctx.db.insert(permissionSets).values({
          id: permissionSetId,
          tenantId: ctx.tenantId,
          name: `Contractor · ${emailLower}`,
          description: `Portal access for ${contractor.name}`,
          permissions: activitiesToPermissionKeys(input.activities),
          isSystem: false,
          externalManaged: true,
        });

        const token = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
        // Reuse an existing active invite for this email, else insert.
        const active = await ctx.db
          .select({ id: invitations.id })
          .from(invitations)
          .where(
            and(
              eq(invitations.tenantId, ctx.tenantId),
              eq(invitations.email, emailLower),
              isNull(invitations.acceptedAt),
            ),
          )
          .limit(1);
        let invitationId: string;
        if (active[0] !== undefined) {
          invitationId = active[0].id;
          await ctx.db
            .update(invitations)
            .set({
              token,
              expiresAt,
              permissionSetId,
              contractorId: input.contractorId,
              contractorActivities: input.activities,
              ...(input.name !== undefined ? { name: input.name } : {}),
            })
            .where(eq(invitations.id, invitationId));
        } else {
          invitationId = newId();
          await ctx.db.insert(invitations).values({
            id: invitationId,
            tenantId: ctx.tenantId,
            email: emailLower,
            ...(input.name !== undefined ? { name: input.name } : {}),
            permissionSetId,
            token,
            invitedByUserId: ctx.auth.userId,
            expiresAt,
            contractorId: input.contractorId,
            contractorActivities: input.activities,
          });
        }

        if (contractorsDeps.sendEmail !== null) {
          try {
            const [tenantRow] = await ctx.db
              .select({ name: tenants.name })
              .from(tenants)
              .where(eq(tenants.id, ctx.tenantId))
              .limit(1);
            // DOC-A01: an invitee has no account yet and therefore no locale —
            // the app default is the only honest answer here.
            const inviteUrl = appLink(contractorsDeps.appUrl, null, `/invite/${token}`);
            const ACTIVITY_WORDS: Record<string, string> = {
              inspections: 'conduct inspections',
              observations: 'raise observations',
              actions: 'view and comment on actions',
              documents: 'view documents',
            };
            const activitiesText =
              input.activities.length > 0
                ? input.activities.map((a) => ACTIVITY_WORDS[a] ?? a).join(', ')
                : 'access the portal';
            await contractorsDeps.sendEmail({
              to: emailLower,
              templateKey: 'contractor-portal-invite',
              variables: {
                contractorName: contractor.name,
                tenantName: tenantRow?.name ?? contractorsDeps.productName,
                inviteUrl,
                expiresIn: '7 days',
                activities: activitiesText,
              },
            });
          } catch (err) {
            ctx.logger.error({ err, invitationId }, '[contractors] portal invite email failed');
          }
        }
        return { invitationId, token };
      }),

    /** Change a portal user's activities (updates their derived permission set). */
    updateActivities: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ userId: z.string(), activities: activitiesInput }))
      .mutation(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select({ id: contractorUsers.id })
          .from(contractorUsers)
          .where(
            and(
              eq(contractorUsers.tenantId, ctx.tenantId),
              eq(contractorUsers.userId, input.userId),
            ),
          )
          .limit(1);
        if (rows[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

        await ctx.db
          .update(contractorUsers)
          .set({ activities: input.activities })
          .where(eq(contractorUsers.id, rows[0].id));

        const [u] = await ctx.db
          .select({ permissionSetId: user.permissionSetId })
          .from(user)
          .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)))
          .limit(1);
        if (u !== undefined) {
          await ctx.db
            .update(permissionSets)
            .set({ permissions: activitiesToPermissionKeys(input.activities) })
            .where(
              and(
                eq(permissionSets.tenantId, ctx.tenantId),
                eq(permissionSets.id, u.permissionSetId),
                eq(permissionSets.externalManaged, true),
              ),
            );
        }
        return { ok: true as const };
      }),

    /**
     * Revoke portal access: unlink + deactivate the user (blocks login).
     *
     * CT-P06: this used to take a bare userId and UNCONDITIONALLY deactivate
     * whoever it named. `contractors.manage` — held by every seeded Manager —
     * therefore reached straight past `users.deactivate`, past the
     * self-deactivation block, and past the last-admin guard that exists so a
     * tenant cannot be left with nobody who can administer it. A Manager
     * could lock the company out of its own settings through the contractors
     * page.
     *
     * Now: the target must actually be a contractor portal user in this
     * tenant, and the same guards `users.deactivate` applies are applied
     * here. Deactivation is a strictly narrower power than it was.
     */
    remove: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ userId: z.string().min(1).max(64) }))
      .mutation(async ({ ctx, input }) => {
        // Self first: "you cannot remove your own access" is the useful
        // sentence, and it holds whether or not you are a portal user.
        if (input.userId === ctx.auth.userId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'cannot_remove_self' });
        }
        const linked = await ctx.db
          .select({ userId: contractorUsers.userId })
          .from(contractorUsers)
          .where(
            and(
              eq(contractorUsers.tenantId, ctx.tenantId),
              eq(contractorUsers.userId, input.userId),
            ),
          )
          .limit(1);
        if (linked[0] === undefined) {
          // Not a portal user of ours: refuse rather than deactivate a
          // colleague who merely shares an id shape.
          throw new TRPCError({ code: 'NOT_FOUND', message: 'contractor_user_not_found' });
        }
        // Belt and braces: a portal user should never hold admin rights, but
        // if one somehow does, the last-admin guard still applies.
        const dropped = await wouldDropBelowMinAdmins(ctx.db, {
          tenantId: ctx.tenantId,
          targetUserId: input.userId,
          afterPermissions: null,
        });
        if (dropped) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'cannot_remove_last_admin' });
        }

        await ctx.db
          .delete(contractorUsers)
          .where(
            and(
              eq(contractorUsers.tenantId, ctx.tenantId),
              eq(contractorUsers.userId, input.userId),
            ),
          );
        await ctx.db
          .update(user)
          .set({ deactivatedAt: new Date() })
          .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)));
        return { ok: true as const };
      }),

    /** Cancel a pending portal invite. */
    cancelInvite: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ invitationId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(invitations)
          .where(
            and(
              eq(invitations.tenantId, ctx.tenantId),
              eq(invitations.id, input.invitationId),
              isNull(invitations.acceptedAt),
            ),
          );
        return { ok: true as const };
      }),

    /** Portal: the signed-in external user's own membership (or null). */
    me: tenantProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          contractorId: contractorUsers.contractorId,
          contractorName: contractors.name,
          activities: contractorUsers.activities,
          acknowledgedAt: contractorUsers.acknowledgedAt,
          acknowledgedVersion: contractorUsers.acknowledgedVersion,
        })
        .from(contractorUsers)
        .innerJoin(contractors, eq(contractorUsers.contractorId, contractors.id))
        .where(
          and(
            eq(contractorUsers.tenantId, ctx.tenantId),
            eq(contractorUsers.userId, ctx.auth.userId),
          ),
        )
        .limit(1);
      const me = rows[0];
      if (me === undefined) return null;
      // PF-19: the portal needs the CURRENT induction text + whether this
      // user's acknowledgement still covers it (version-aware re-ack).
      const cfg = await ctx.db
        .select({
          body: contractorInductionConfig.body,
          version: contractorInductionConfig.version,
        })
        .from(contractorInductionConfig)
        .where(eq(contractorInductionConfig.tenantId, ctx.tenantId))
        .limit(1);
      const inductionVersion = cfg[0]?.version ?? 1;
      const ackVersion = me.acknowledgedVersion ?? (me.acknowledgedAt !== null ? 1 : 0);
      return {
        ...me,
        inductionBody: cfg[0]?.body ?? null,
        inductionVersion,
        inductionCurrent: ackVersion >= inductionVersion,
      };
    }),

    /** Portal: the external user acknowledges the CURRENT induction version. */
    acknowledge: tenantProcedure.mutation(async ({ ctx }) => {
      const cfg = await ctx.db
        .select({ version: contractorInductionConfig.version })
        .from(contractorInductionConfig)
        .where(eq(contractorInductionConfig.tenantId, ctx.tenantId))
        .limit(1);
      await ctx.db
        .update(contractorUsers)
        .set({ acknowledgedAt: new Date(), acknowledgedVersion: cfg[0]?.version ?? 1 })
        .where(
          and(
            eq(contractorUsers.tenantId, ctx.tenantId),
            eq(contractorUsers.userId, ctx.auth.userId),
          ),
        );
      return { ok: true as const };
    }),
  }),

  // ─── Versioned induction text (PF-19) ──────────────────────────────────
  induction: router({
    /** Any signed-in tenant user may read the current induction text. */
    get: tenantProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(contractorInductionConfig)
        .where(eq(contractorInductionConfig.tenantId, ctx.tenantId))
        .limit(1);
      return rows[0] ?? null;
    }),

    /**
     * Set the induction text. A changed body bumps the version, which forces
     * every portal user to re-acknowledge — so the tenant can always prove
     * which text a contractor saw.
     */
    set: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ body: z.string().min(1).max(20_000) }))
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select({
            body: contractorInductionConfig.body,
            version: contractorInductionConfig.version,
          })
          .from(contractorInductionConfig)
          .where(eq(contractorInductionConfig.tenantId, ctx.tenantId))
          .limit(1);
        const now = new Date();
        if (existing[0] === undefined) {
          await ctx.db.insert(contractorInductionConfig).values({
            tenantId: ctx.tenantId,
            body: input.body,
            version: 1,
            updatedBy: ctx.auth.userId,
            updatedAt: now,
          });
          return { version: 1 };
        }
        if (existing[0].body === input.body) return { version: existing[0].version };
        const version = existing[0].version + 1;
        await ctx.db
          .update(contractorInductionConfig)
          .set({ body: input.body, version, updatedBy: ctx.auth.userId, updatedAt: now })
          .where(eq(contractorInductionConfig.tenantId, ctx.tenantId));
        return { version };
      }),
  }),
});
