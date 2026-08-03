/**
 * Incident & Accident Management router (FreeHS module B5).
 *
 * Record → triage → investigate → act → close → prove it worked:
 *   - `create` is open to every `incidents.report` holder (reporting
 *     friction suppresses the statistics that make the module
 *     worthwhile); `occurredAt` may not be in the future and a > 24 h
 *     reporting gap is flagged, never blocked.
 *   - Triage (manage) confirms kind/severity, sets the investigation
 *     level and confidentiality, appoints the lead investigator and
 *     walks the RIDDOR screening. The determination is guided, never
 *     auto-decided; a negative determination is itself a record.
 *   - Investigations are versioned: revision n is frozen at approval,
 *     reopening starts revision n+1 pre-filled from n. The lead
 *     investigator submits; a *different* `incidents.manage` holder
 *     approves (separation of duties, router-enforced).
 *   - Approval generates one action per `requiresAction` finding exactly
 *     once — `sourceType 'incident'` + the actions source unique index
 *     back the race; assignee + due date are set per finding in the
 *     approval call (never hard-coded).
 *   - Closure demands every linked action terminal and the RIDDOR duty
 *     discharged, then schedules the effectiveness review.
 *   - Confidential incidents (defaulted on for sharps / V&A) are counted
 *     for everyone, readable only by the reporter, the lead investigator
 *     and `incidents.confidential.view` holders — enforced here on every
 *     read, not in the UI.
 *
 * Cross-module surfaces owned by this router: observation → incident
 * promotion (links both ways), post-incident review prompts that pull
 * RA / COSHH / FRA `nextReviewAt` to now citing the incident, and the
 * register CSV export.
 *
 * Everything mutating writes an `incident_events` row — append-only,
 * evidence not state. Evidence and witness statements have no update or
 * delete surface at all: corrections are new rows.
 */
import {
  actions,
  assets,
  coshhAssessments,
  coshhEvents,
  contractors,
  fireEvents,
  fireRiskAssessments,
  incidentAbsences,
  incidentEvents,
  incidentEvidence,
  incidentFindings,
  incidentInvestigations,
  incidentPersons,
  incidentWitnessStatements,
  incidents,
  issueActivity,
  issueAttachments,
  issues,
  permits,
  riskAssessmentEvents,
  riskAssessments,
  sites,
  user,
  type Incident,
  type IncidentEventKind,
  type IncidentInvestigation,
} from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import {
  causalFactorsSchema,
  canTransition,
  CAUSAL_FACTOR_CATEGORIES,
  defaultConfidential,
  effectivenessDueAt,
  EFFECTIVENESS_VERDICTS,
  EVIDENCE_KINDS,
  FINDING_PRIORITIES,
  formatIncidentReference,
  INCIDENT_KINDS,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INVESTIGATION_LEVELS,
  isLateReport,
  isoDateSchema,
  isRiddorReportable,
  needsImmediateAlert,
  needsRiddorRescreen,
  parseIncidentDetails,
  PERSON_CATEGORIES,
  personInjurySchema,
  RCA_METHODS,
  RECURRENCE_LIKELIHOODS,
  RIDDOR_CATEGORIES,
  RIDDOR_SUBMISSION_ROUTES,
  riddorDeadlineFor,
  timelineEntriesSchema,
  totalDaysLost,
  whyChainSchema,
  type IncidentStatus,
} from '@forma360/shared/incidents';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { newId } from '@forma360/shared/id';
import { toCsv } from '@forma360/shared/csv';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { nextReferenceValue } from '../reference-counter';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';
import { computeAutoDueAt, loadPriorityDueDateDays } from './actions';

export interface IncidentsRouterDeps {
  /** Wired from the brand module catalogue (ADR 0010). */
  enabled: boolean;
  /**
   * PDF renderer for the incident report pack. Optional: absent in
   * non-web callers — `renderPdf` refuses when missing, everything else
   * works.
   */
  renderPdf?: (input: {
    tenantId: string;
    incidentId: string;
  }) => Promise<{ key: string; bytes: number; stub: boolean }>;
  /**
   * Templated-email dispatcher for the in-request notifications
   * (investigator appointed, finding-action assigned). Optional; sends
   * are best-effort and never roll a mutation back.
   */
  sendEmail?: (input: {
    to: string;
    templateKey: string;
    variables: Record<string, string>;
  }) => Promise<unknown>;
  /**
   * Enqueue the immediate-alert fan-out job (the worker resolves
   * recipients + sends + stamps). Optional; failure to enqueue is
   * logged, never thrown.
   */
  enqueueIncidentAlert?: (payload: { tenantId: string; incidentId: string }) => Promise<void>;
  /** Public origin for links in notification emails. */
  appUrl?: string;
}

type Db = Database;

interface CallerCtx {
  auth: { userId: string };
  permissions: readonly string[];
}

// ─── Scoped loaders ─────────────────────────────────────────────────────────

async function loadIncident(db: Db, tenantId: string, id: string): Promise<Incident> {
  const rows = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, id)))
    .limit(1);
  const incident = rows[0];
  if (incident === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'incident-not-found' });
  }
  return incident;
}

async function loadSiteInTenant(db: Db, tenantId: string, siteId: string): Promise<void> {
  const rows = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.id, siteId)))
    .limit(1);
  if (rows[0] === undefined) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'site-not-found' });
  }
}

async function loadUserInTenant(
  db: Db,
  tenantId: string,
  userId: string,
): Promise<{ id: string; name: string; email: string }> {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(and(eq(user.tenantId, tenantId), eq(user.id, userId)))
    .limit(1);
  const found = rows[0];
  if (found === undefined) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'user-not-found' });
  }
  return found;
}

async function assertLinkedRecordsInTenant(
  db: Db,
  tenantId: string,
  links: {
    permitId?: string | null | undefined;
    contractorId?: string | null | undefined;
    assetId?: string | null | undefined;
  },
): Promise<void> {
  if (links.permitId !== undefined && links.permitId !== null) {
    const rows = await db
      .select({ id: permits.id })
      .from(permits)
      .where(and(eq(permits.tenantId, tenantId), eq(permits.id, links.permitId)))
      .limit(1);
    if (rows[0] === undefined) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'permit-not-found' });
    }
  }
  if (links.contractorId !== undefined && links.contractorId !== null) {
    const rows = await db
      .select({ id: contractors.id })
      .from(contractors)
      .where(and(eq(contractors.tenantId, tenantId), eq(contractors.id, links.contractorId)))
      .limit(1);
    if (rows[0] === undefined) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'contractor-not-found' });
    }
  }
  if (links.assetId !== undefined && links.assetId !== null) {
    const rows = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), eq(assets.id, links.assetId)))
      .limit(1);
    if (rows[0] === undefined) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'asset-not-found' });
    }
  }
}

// ─── Access helpers ─────────────────────────────────────────────────────────

/**
 * Confidential-detail access: reporter ∨ lead investigator ∨
 * `incidents.confidential.view` ∨ administrator. Everyone else sees the
 * incident *counted* (register rows minimal) but never its detail.
 */
function canViewConfidential(incident: Incident, ctx: CallerCtx): boolean {
  if (!incident.confidential) return true;
  if (grantsAdminAccess(ctx.permissions)) return true;
  if (ctx.permissions.includes('incidents.confidential.view')) return true;
  return (
    incident.reportedByUserId === ctx.auth.userId ||
    incident.leadInvestigatorUserId === ctx.auth.userId
  );
}

function assertDetailAccess(incident: Incident, ctx: CallerCtx): void {
  if (!canViewConfidential(incident, ctx)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'confidential' });
  }
}

/**
 * Investigation-workspace authority: the lead investigator, or any
 * `incidents.manage` holder / administrator. `incidents.investigate` is
 * the base competent-person key required by the procedures themselves.
 */
function assertInvestigationAuthority(incident: Incident, ctx: CallerCtx): void {
  if (grantsAdminAccess(ctx.permissions)) return;
  if (ctx.permissions.includes('incidents.manage')) return;
  if (incident.leadInvestigatorUserId === ctx.auth.userId) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'not-lead-investigator' });
}

function assertTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!canTransition(from, to)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
  }
}

// ─── Event log ──────────────────────────────────────────────────────────────

async function logEvent(
  db: Db,
  input: {
    tenantId: string;
    incidentId: string;
    actorUserId: string;
    kind: IncidentEventKind;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(incidentEvents).values({
    id: newId(),
    tenantId: input.tenantId,
    incidentId: input.incidentId,
    actorUserId: input.actorUserId,
    kind: input.kind,
    detail: input.detail ?? {},
  });
}

// ─── Misc helpers ───────────────────────────────────────────────────────────

async function latestInvestigation(
  db: Db,
  tenantId: string,
  incidentId: string,
): Promise<IncidentInvestigation | null> {
  const rows = await db
    .select()
    .from(incidentInvestigations)
    .where(
      and(
        eq(incidentInvestigations.tenantId, tenantId),
        eq(incidentInvestigations.incidentId, incidentId),
      ),
    )
    .orderBy(desc(incidentInvestigations.revision))
    .limit(1);
  return rows[0] ?? null;
}

async function hasApprovedInvestigation(
  db: Db,
  tenantId: string,
  incidentId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: incidentInvestigations.id })
    .from(incidentInvestigations)
    .where(
      and(
        eq(incidentInvestigations.tenantId, tenantId),
        eq(incidentInvestigations.incidentId, incidentId),
        eq(incidentInvestigations.status, 'approved'),
      ),
    )
    .limit(1);
  return rows[0] !== undefined;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function incidentDaysLost(db: Db, incident: Incident, now: Date): Promise<number> {
  const rows = await db
    .select({ fromDate: incidentAbsences.fromDate, toDate: incidentAbsences.toDate })
    .from(incidentAbsences)
    .where(
      and(
        eq(incidentAbsences.tenantId, incident.tenantId),
        eq(incidentAbsences.incidentId, incident.id),
      ),
    );
  return totalDaysLost(rows, isoDate(incident.occurredAt), isoDate(now));
}

/**
 * After any absence write: if accumulated lost time now contradicts a
 * `not_reportable` determination, flag re-screening (once) and log it.
 */
async function maybeFlagRescreen(
  db: Db,
  incident: Incident,
  actorUserId: string,
  now: Date,
): Promise<void> {
  if (incident.riddorRescreenRequired) return;
  const days = await incidentDaysLost(db, incident, now);
  if (!needsRiddorRescreen(incident.riddorCategory, days)) return;
  await db
    .update(incidents)
    .set({ riddorRescreenRequired: true, updatedAt: now })
    .where(and(eq(incidents.tenantId, incident.tenantId), eq(incidents.id, incident.id)));
  await logEvent(db, {
    tenantId: incident.tenantId,
    incidentId: incident.id,
    actorUserId,
    kind: 'riddor_rescreen_flagged',
    detail: { daysLost: days },
  });
}

async function userNamesById(
  db: Db,
  tenantId: string,
  ids: ReadonlyArray<string>,
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  if (unique.length === 0) return {};
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(and(eq(user.tenantId, tenantId), inArray(user.id, unique)));
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

function isUniqueViolation(err: unknown): boolean {
  const visit = (e: unknown): boolean => {
    if (typeof e !== 'object' || e === null) return false;
    const record = e as Record<string, unknown>;
    if (record.code === '23505') return true;
    const message = typeof record.message === 'string' ? record.message : '';
    if (/duplicate key|unique constraint|unique violation|UNIQUE/i.test(message)) return true;
    if ('cause' in record) return visit(record.cause);
    return false;
  };
  return visit(err);
}

// ─── Input schemas ──────────────────────────────────────────────────────────

const idInput = z.object({ incidentId: z.string().length(26) });

const personInput = z.object({
  userId: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(200),
  category: z.enum(PERSON_CATEGORIES),
  injury: personInjurySchema.default({}),
  ohFollowUpRequired: z.boolean().default(false),
});

const createInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10_000).default(''),
  kind: z.enum(INCIDENT_KINDS),
  occurredAt: z.coerce.date(),
  siteId: z.string().length(26).optional(),
  locationText: z.string().trim().max(500).default(''),
  details: z.record(z.unknown()).default({}),
  persons: z.array(personInput).max(50).default([]),
  potentialSeverity: z.enum(INCIDENT_SEVERITIES).optional(),
  permitId: z.string().length(26).optional(),
  contractorId: z.string().length(26).optional(),
  assetId: z.string().length(26).optional(),
});

const updateInput = z.object({
  incidentId: z.string().length(26),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(10_000).optional(),
  kind: z.enum(INCIDENT_KINDS).optional(),
  occurredAt: z.coerce.date().optional(),
  siteId: z.string().length(26).nullable().optional(),
  locationText: z.string().trim().max(500).optional(),
  details: z.record(z.unknown()).optional(),
  potentialSeverity: z.enum(INCIDENT_SEVERITIES).nullable().optional(),
  permitId: z.string().length(26).nullable().optional(),
  contractorId: z.string().length(26).nullable().optional(),
  assetId: z.string().length(26).nullable().optional(),
});

const triageInput = z.object({
  incidentId: z.string().length(26),
  severity: z.enum(INCIDENT_SEVERITIES),
  potentialSeverity: z.enum(INCIDENT_SEVERITIES).nullable().optional(),
  confidential: z.boolean().optional(),
  investigationLevel: z.enum(INVESTIGATION_LEVELS),
  leadInvestigatorUserId: z.string().max(64),
});

const saveInvestigationInput = z.object({
  incidentId: z.string().length(26),
  method: z.enum(RCA_METHODS).nullable().optional(),
  immediateCause: z.string().trim().max(5000).optional(),
  underlyingCause: z.string().trim().max(5000).optional(),
  contributingFactors: z.array(z.enum(CAUSAL_FACTOR_CATEGORIES)).max(8).optional(),
  whyChain: whyChainSchema.nullable().optional(),
  causalFactors: causalFactorsSchema.nullable().optional(),
  timelineEntries: timelineEntriesSchema.optional(),
  conclusionSummary: z.string().trim().max(10_000).optional(),
  rootCauseStatement: z.string().trim().max(5000).optional(),
  recurrenceLikelihood: z.enum(RECURRENCE_LIKELIHOODS).nullable().optional(),
  lessonsLearned: z.string().trim().max(10_000).optional(),
});

const findingInput = z.object({
  incidentId: z.string().length(26),
  category: z.enum(CAUSAL_FACTOR_CATEGORIES),
  priority: z.enum(FINDING_PRIORITIES).default('medium'),
  description: z.string().trim().min(1).max(2000),
  requiresAction: z.boolean().default(true),
});

const listInput = z
  .object({
    status: z.array(z.enum(INCIDENT_STATUSES)).optional(),
    kind: z.array(z.enum(INCIDENT_KINDS)).optional(),
    severity: z.array(z.enum(INCIDENT_SEVERITIES)).optional(),
    siteId: z.string().length(26).optional(),
    riddorOnly: z.boolean().default(false),
    query: z.string().trim().max(200).optional(),
    includeCancelled: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .default({ riddorOnly: false, includeCancelled: false, limit: 200 });

// ─── Router ─────────────────────────────────────────────────────────────────

export function createIncidentsRouter(deps: IncidentsRouterDeps) {
  function assertEnabled(): void {
    if (!deps.enabled) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'module-disabled' });
    }
  }

  async function maybeEnqueueAlert(
    ctx: { logger: { warn: (obj: unknown, msg: string) => void } },
    incident: Incident,
  ): Promise<void> {
    if (deps.enqueueIncidentAlert === undefined) return;
    if (incident.alertSentAt !== null) return;
    if (!needsImmediateAlert(incident.kind, incident.severity)) return;
    try {
      await deps.enqueueIncidentAlert({ tenantId: incident.tenantId, incidentId: incident.id });
    } catch (err) {
      ctx.logger.warn({ err, incidentId: incident.id }, '[incidents] failed to enqueue alert');
    }
  }

  async function sendBestEffort(
    ctx: { logger: { warn: (obj: unknown, msg: string) => void } },
    mail: { to: string; templateKey: string; variables: Record<string, string> },
  ): Promise<void> {
    if (deps.sendEmail === undefined) return;
    try {
      await deps.sendEmail(mail);
    } catch (err) {
      ctx.logger.warn({ err, templateKey: mail.templateKey }, '[incidents] email send failed');
    }
  }

  return router({
    // ─── Reads ──────────────────────────────────────────────────────────────

    list: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(listInput)
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const conditions = [eq(incidents.tenantId, ctx.tenantId)];
        if (input.status !== undefined && input.status.length > 0) {
          conditions.push(inArray(incidents.status, input.status));
        } else if (!input.includeCancelled) {
          conditions.push(ne(incidents.status, 'cancelled'));
        }
        if (input.kind !== undefined && input.kind.length > 0) {
          conditions.push(inArray(incidents.kind, input.kind));
        }
        if (input.severity !== undefined && input.severity.length > 0) {
          conditions.push(inArray(incidents.severity, input.severity));
        }
        if (input.siteId !== undefined) {
          conditions.push(eq(incidents.siteId, input.siteId));
        }
        if (input.riddorOnly) {
          conditions.push(
            sql`${incidents.riddorCategory} IS NOT NULL AND ${incidents.riddorCategory} <> 'not_reportable'`,
          );
        }
        const holdsKey =
          grantsAdminAccess(ctx.permissions) ||
          ctx.permissions.includes('incidents.confidential.view');
        if (input.query !== undefined && input.query.length > 0) {
          const q = `%${input.query}%`;
          // Confidential titles are only searchable for confidential-view
          // holders; the reference stays searchable for everyone.
          const titleMatch = holdsKey
            ? ilike(incidents.title, q)
            : and(eq(incidents.confidential, false), ilike(incidents.title, q));
          const cond = or(ilike(incidents.referenceNumber, q), titleMatch);
          if (cond !== undefined) conditions.push(cond);
        }

        const rows = await ctx.db
          .select()
          .from(incidents)
          .where(and(...conditions))
          .orderBy(desc(incidents.occurredAt))
          .limit(input.limit);

        const siteIds = [
          ...new Set(rows.flatMap((row) => (row.siteId === null ? [] : [row.siteId]))),
        ];
        const siteRows =
          siteIds.length === 0
            ? []
            : await ctx.db
                .select({ id: sites.id, name: sites.name })
                .from(sites)
                .where(and(eq(sites.tenantId, ctx.tenantId), inArray(sites.id, siteIds)));
        const siteNames = Object.fromEntries(siteRows.map((row) => [row.id, row.name]));

        const now = new Date();
        return rows.map((row) => {
          const restricted = !canViewConfidential(row, ctx);
          return {
            id: row.id,
            referenceNumber: row.referenceNumber,
            /** Null = confidential record the caller may only count. */
            title: restricted ? null : row.title,
            kind: row.kind,
            severity: row.severity,
            status: row.status,
            confidential: row.confidential,
            restricted,
            occurredAt: row.occurredAt,
            reportedAt: row.reportedAt,
            lateReport: isLateReport(row.occurredAt, row.reportedAt),
            siteId: row.siteId,
            siteName: row.siteId === null ? null : (siteNames[row.siteId] ?? null),
            riddorCategory: row.riddorCategory,
            riddorDeadlineAt: row.riddorDeadlineAt,
            riddorSubmittedAt: row.riddorSubmittedAt,
            riddorRescreenRequired: row.riddorRescreenRequired,
            riddorOverdue:
              row.riddorCategory !== null &&
              isRiddorReportable(row.riddorCategory) &&
              row.riddorSubmittedAt === null &&
              row.riddorDeadlineAt !== null &&
              row.riddorDeadlineAt <= now,
            investigationLevel: row.investigationLevel,
            effectivenessDueAt: row.effectivenessDueAt,
            effectivenessVerdict: row.effectivenessVerdict,
          };
        });
      }),

    get: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(idInput)
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);

        const [
          persons,
          absences,
          investigations,
          findings,
          evidence,
          witnesses,
          events,
          linkedActions,
        ] = await Promise.all([
          ctx.db
            .select()
            .from(incidentPersons)
            .where(
              and(
                eq(incidentPersons.tenantId, ctx.tenantId),
                eq(incidentPersons.incidentId, incident.id),
              ),
            )
            .orderBy(asc(incidentPersons.createdAt)),
          ctx.db
            .select()
            .from(incidentAbsences)
            .where(
              and(
                eq(incidentAbsences.tenantId, ctx.tenantId),
                eq(incidentAbsences.incidentId, incident.id),
              ),
            )
            .orderBy(asc(incidentAbsences.fromDate)),
          ctx.db
            .select()
            .from(incidentInvestigations)
            .where(
              and(
                eq(incidentInvestigations.tenantId, ctx.tenantId),
                eq(incidentInvestigations.incidentId, incident.id),
              ),
            )
            .orderBy(asc(incidentInvestigations.revision)),
          ctx.db
            .select()
            .from(incidentFindings)
            .where(
              and(
                eq(incidentFindings.tenantId, ctx.tenantId),
                eq(incidentFindings.incidentId, incident.id),
              ),
            )
            .orderBy(asc(incidentFindings.createdAt)),
          ctx.db
            .select()
            .from(incidentEvidence)
            .where(
              and(
                eq(incidentEvidence.tenantId, ctx.tenantId),
                eq(incidentEvidence.incidentId, incident.id),
              ),
            )
            .orderBy(asc(incidentEvidence.createdAt)),
          ctx.db
            .select()
            .from(incidentWitnessStatements)
            .where(
              and(
                eq(incidentWitnessStatements.tenantId, ctx.tenantId),
                eq(incidentWitnessStatements.incidentId, incident.id),
              ),
            )
            .orderBy(asc(incidentWitnessStatements.createdAt)),
          ctx.db
            .select()
            .from(incidentEvents)
            .where(
              and(
                eq(incidentEvents.tenantId, ctx.tenantId),
                eq(incidentEvents.incidentId, incident.id),
              ),
            )
            .orderBy(desc(incidentEvents.createdAt))
            .limit(200),
          ctx.db
            .select({
              id: actions.id,
              referenceNumber: actions.referenceNumber,
              title: actions.title,
              status: actions.status,
              priority: actions.priority,
              assigneeUserId: actions.assigneeUserId,
              dueAt: actions.dueAt,
            })
            .from(actions)
            .where(
              and(
                eq(actions.tenantId, ctx.tenantId),
                eq(actions.sourceType, 'incident'),
                eq(actions.sourceId, incident.id),
              ),
            )
            .orderBy(asc(actions.createdAt)),
        ]);

        // Linked-record display names.
        const [siteRow, observationRow, permitRow, contractorRow, assetRow] = await Promise.all([
          incident.siteId === null
            ? Promise.resolve(null)
            : ctx.db
                .select({ id: sites.id, name: sites.name })
                .from(sites)
                .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, incident.siteId)))
                .limit(1)
                .then((rows) => rows[0] ?? null),
          incident.observationId === null
            ? Promise.resolve(null)
            : ctx.db
                .select({
                  id: issues.id,
                  referenceNumber: issues.referenceNumber,
                  title: issues.title,
                })
                .from(issues)
                .where(
                  and(eq(issues.tenantId, ctx.tenantId), eq(issues.id, incident.observationId)),
                )
                .limit(1)
                .then((rows) => rows[0] ?? null),
          incident.permitId === null
            ? Promise.resolve(null)
            : ctx.db
                .select({
                  id: permits.id,
                  referenceNumber: permits.referenceNumber,
                  title: permits.title,
                })
                .from(permits)
                .where(and(eq(permits.tenantId, ctx.tenantId), eq(permits.id, incident.permitId)))
                .limit(1)
                .then((rows) => rows[0] ?? null),
          incident.contractorId === null
            ? Promise.resolve(null)
            : ctx.db
                .select({ id: contractors.id, name: contractors.name })
                .from(contractors)
                .where(
                  and(
                    eq(contractors.tenantId, ctx.tenantId),
                    eq(contractors.id, incident.contractorId),
                  ),
                )
                .limit(1)
                .then((rows) => rows[0] ?? null),
          incident.assetId === null
            ? Promise.resolve(null)
            : ctx.db
                .select({ id: assets.id, name: assets.name })
                .from(assets)
                .where(and(eq(assets.tenantId, ctx.tenantId), eq(assets.id, incident.assetId)))
                .limit(1)
                .then((rows) => rows[0] ?? null),
        ]);

        const now = new Date();
        const daysLost = totalDaysLost(
          absences.map((a) => ({ fromDate: a.fromDate, toDate: a.toDate })),
          isoDate(incident.occurredAt),
          isoDate(now),
        );

        const nameIds = [
          incident.reportedByUserId,
          incident.leadInvestigatorUserId ?? '',
          incident.riddorScreenedByUserId ?? '',
          incident.closedByUserId ?? '',
          ...events.map((e) => e.actorUserId),
          ...persons.flatMap((p) => (p.userId === null ? [] : [p.userId])),
          ...investigations.flatMap((i) => [i.submittedByUserId ?? '', i.approvedByUserId ?? '']),
          ...witnesses.map((w) => w.takenByUserId),
          ...evidence.map((e) => e.collectedByUserId),
          ...linkedActions.flatMap((a) => (a.assigneeUserId === null ? [] : [a.assigneeUserId])),
        ];
        const userNames = await userNamesById(ctx.db, ctx.tenantId, nameIds);

        return {
          incident,
          viewerUserId: ctx.auth.userId,
          persons,
          absences,
          investigations,
          findings,
          evidence,
          witnesses,
          events,
          actions: linkedActions,
          site: siteRow,
          observation: observationRow,
          permit: permitRow,
          contractor: contractorRow,
          asset: assetRow,
          userNames,
          daysLost,
          lateReport: isLateReport(incident.occurredAt, incident.reportedAt),
        };
      }),

    /** Minimal linked-incident info for the observation detail page. */
    forObservation: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(z.object({ observationId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(incidents)
          .where(
            and(
              eq(incidents.tenantId, ctx.tenantId),
              eq(incidents.observationId, input.observationId),
            ),
          )
          .orderBy(desc(incidents.createdAt))
          .limit(10);
        return rows.map((row) => {
          const restricted = !canViewConfidential(row, ctx);
          return {
            id: row.id,
            referenceNumber: row.referenceNumber,
            title: restricted ? null : row.title,
            status: row.status,
            severity: row.severity,
          };
        });
      }),

    overview: tenantProcedure.use(requirePermission('incidents.view')).query(async ({ ctx }) => {
      assertEnabled();
      const rows = await ctx.db
        .select({
          status: incidents.status,
          riddorCategory: incidents.riddorCategory,
          riddorDeadlineAt: incidents.riddorDeadlineAt,
          riddorSubmittedAt: incidents.riddorSubmittedAt,
          riddorRescreenRequired: incidents.riddorRescreenRequired,
          effectivenessDueAt: incidents.effectivenessDueAt,
          effectivenessVerdict: incidents.effectivenessVerdict,
        })
        .from(incidents)
        .where(eq(incidents.tenantId, ctx.tenantId));
      const now = new Date();
      const soon = new Date(now.getTime() + 5 * 86_400_000);
      let open = 0;
      let investigating = 0;
      let riddorDueSoon = 0;
      let riddorOverdue = 0;
      let rescreenRequired = 0;
      let effectivenessOverdue = 0;
      for (const row of rows) {
        if (row.status !== 'closed' && row.status !== 'cancelled') open += 1;
        if (row.status === 'investigating') investigating += 1;
        const clockRunning =
          row.riddorCategory !== null &&
          row.riddorCategory !== 'not_reportable' &&
          row.riddorSubmittedAt === null &&
          row.riddorDeadlineAt !== null &&
          row.status !== 'cancelled';
        if (clockRunning && row.riddorDeadlineAt !== null) {
          if (row.riddorDeadlineAt <= now) riddorOverdue += 1;
          else if (row.riddorDeadlineAt <= soon) riddorDueSoon += 1;
        }
        if (row.riddorRescreenRequired && row.status !== 'cancelled') rescreenRequired += 1;
        if (
          row.effectivenessDueAt !== null &&
          row.effectivenessVerdict === null &&
          row.effectivenessDueAt <= now &&
          row.status === 'closed'
        ) {
          effectivenessOverdue += 1;
        }
      }
      return {
        open,
        investigating,
        riddorDueSoon,
        riddorOverdue,
        rescreenRequired,
        effectivenessOverdue,
      };
    }),

    // ─── Report & amend ─────────────────────────────────────────────────────

    create: tenantProcedure
      .use(requirePermission('incidents.report'))
      .input(createInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const now = new Date();
        if (input.occurredAt.getTime() > now.getTime()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'occurred-in-future' });
        }
        let details: Record<string, unknown>;
        try {
          details = parseIncidentDetails(input.kind, input.details) as Record<string, unknown>;
        } catch {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-details' });
        }
        if (input.siteId !== undefined) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.siteId);
        }
        await assertLinkedRecordsInTenant(ctx.db, ctx.tenantId, input);
        for (const person of input.persons) {
          if (person.userId !== undefined) {
            await loadUserInTenant(ctx.db, ctx.tenantId, person.userId);
          }
        }

        const id = newId();
        const refValue = await nextReferenceValue(ctx.db, ctx.tenantId, 'incident');
        const referenceNumber = formatIncidentReference(refValue);
        await ctx.db.insert(incidents).values({
          id,
          tenantId: ctx.tenantId,
          referenceNumber,
          title: input.title,
          description: input.description,
          kind: input.kind,
          severity: 'minor',
          potentialSeverity: input.potentialSeverity ?? null,
          status: 'reported',
          confidential: defaultConfidential(input.kind),
          occurredAt: input.occurredAt,
          reportedAt: now,
          reportedByUserId: ctx.auth.userId,
          siteId: input.siteId ?? null,
          locationText: input.locationText,
          details,
          permitId: input.permitId ?? null,
          contractorId: input.contractorId ?? null,
          assetId: input.assetId ?? null,
          createdAt: now,
          updatedAt: now,
        });
        if (input.persons.length > 0) {
          await ctx.db.insert(incidentPersons).values(
            input.persons.map((person) => ({
              id: newId(),
              tenantId: ctx.tenantId,
              incidentId: id,
              userId: person.userId ?? null,
              name: person.name,
              category: person.category,
              injury: person.injury,
              ohFollowUpRequired: person.ohFollowUpRequired,
            })),
          );
        }
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: id,
          actorUserId: ctx.auth.userId,
          kind: 'reported',
          detail: { kind: input.kind, referenceNumber },
        });
        const incident = await loadIncident(ctx.db, ctx.tenantId, id);
        await maybeEnqueueAlert(ctx, incident);
        return { incidentId: id, referenceNumber };
      }),

    update: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(updateInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        const isManager =
          ctx.permissions.includes('incidents.manage') || grantsAdminAccess(ctx.permissions);
        const isReporterEditable =
          incident.reportedByUserId === ctx.auth.userId && incident.status === 'reported';
        if (!isManager && !isReporterEditable) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not-editable' });
        }
        if (incident.status === 'closed' || incident.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'incident-terminal' });
        }
        const now = new Date();
        if (input.occurredAt !== undefined && input.occurredAt.getTime() > now.getTime()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'occurred-in-future' });
        }
        const nextKind = input.kind ?? incident.kind;
        let nextDetails: Record<string, unknown> | undefined;
        if (input.details !== undefined || input.kind !== undefined) {
          try {
            nextDetails = parseIncidentDetails(
              nextKind,
              input.details ?? (input.kind !== undefined ? {} : incident.details),
            ) as Record<string, unknown>;
          } catch {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-details' });
          }
        }
        if (input.siteId !== undefined && input.siteId !== null) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.siteId);
        }
        await assertLinkedRecordsInTenant(ctx.db, ctx.tenantId, input);

        await ctx.db
          .update(incidents)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.kind !== undefined ? { kind: input.kind } : {}),
            ...(nextDetails !== undefined ? { details: nextDetails } : {}),
            ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
            ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
            ...(input.locationText !== undefined ? { locationText: input.locationText } : {}),
            ...(input.potentialSeverity !== undefined
              ? { potentialSeverity: input.potentialSeverity }
              : {}),
            ...(input.permitId !== undefined ? { permitId: input.permitId } : {}),
            ...(input.contractorId !== undefined ? { contractorId: input.contractorId } : {}),
            ...(input.assetId !== undefined ? { assetId: input.assetId } : {}),
            updatedAt: now,
          })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'updated',
        });
        return { ok: true };
      }),

    // ─── Triage ─────────────────────────────────────────────────────────────

    triage: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(triageInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertTransition(incident.status, 'triaged');
        const investigator = await loadUserInTenant(
          ctx.db,
          ctx.tenantId,
          input.leadInvestigatorUserId,
        );
        const now = new Date();
        await ctx.db
          .update(incidents)
          .set({
            status: 'triaged',
            severity: input.severity,
            potentialSeverity:
              input.potentialSeverity !== undefined
                ? input.potentialSeverity
                : incident.potentialSeverity,
            confidential: input.confidential ?? incident.confidential,
            investigationLevel: input.investigationLevel,
            leadInvestigatorUserId: input.leadInvestigatorUserId,
            updatedAt: now,
          })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'triaged',
          detail: { severity: input.severity, level: input.investigationLevel },
        });
        if (incident.leadInvestigatorUserId !== input.leadInvestigatorUserId) {
          await logEvent(ctx.db, {
            tenantId: ctx.tenantId,
            incidentId: incident.id,
            actorUserId: ctx.auth.userId,
            kind: 'investigator_assigned',
            detail: { userId: input.leadInvestigatorUserId },
          });
          await sendBestEffort(ctx, {
            to: investigator.email,
            templateKey: 'incident-investigator-assigned',
            variables: {
              recipientName: investigator.name,
              incidentRef: incident.referenceNumber,
              incidentTitle: incident.confidential ? incident.referenceNumber : incident.title,
              viewUrl: `${deps.appUrl ?? ''}/en/incidents/${incident.id}`,
            },
          });
        }
        const updated = await loadIncident(ctx.db, ctx.tenantId, incident.id);
        await maybeEnqueueAlert(ctx, updated);
        return { ok: true };
      }),

    setSeverity: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(z.object({ incidentId: z.string().length(26), severity: z.enum(INCIDENT_SEVERITIES) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        if (incident.status === 'closed' || incident.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'incident-terminal' });
        }
        if (await hasApprovedInvestigation(ctx.db, ctx.tenantId, incident.id)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'severity-frozen' });
        }
        const now = new Date();
        await ctx.db
          .update(incidents)
          .set({ severity: input.severity, updatedAt: now })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'severity_changed',
          detail: { from: incident.severity, to: input.severity },
        });
        const updated = await loadIncident(ctx.db, ctx.tenantId, incident.id);
        await maybeEnqueueAlert(ctx, updated);
        return { ok: true };
      }),

    assignInvestigator: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(z.object({ incidentId: z.string().length(26), userId: z.string().max(64) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        if (incident.status === 'closed' || incident.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'incident-terminal' });
        }
        const investigator = await loadUserInTenant(ctx.db, ctx.tenantId, input.userId);
        await ctx.db
          .update(incidents)
          .set({ leadInvestigatorUserId: input.userId, updatedAt: new Date() })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'investigator_assigned',
          detail: { userId: input.userId },
        });
        await sendBestEffort(ctx, {
          to: investigator.email,
          templateKey: 'incident-investigator-assigned',
          variables: {
            recipientName: investigator.name,
            incidentRef: incident.referenceNumber,
            incidentTitle: incident.confidential ? incident.referenceNumber : incident.title,
            viewUrl: `${deps.appUrl ?? ''}/en/incidents/${incident.id}`,
          },
        });
        return { ok: true };
      }),

    // ─── People & lost time ─────────────────────────────────────────────────

    addPerson: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(personInput.extend({ incidentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertRecordAuthority(incident, ctx);
        if (input.userId !== undefined) {
          await loadUserInTenant(ctx.db, ctx.tenantId, input.userId);
        }
        const id = newId();
        await ctx.db.insert(incidentPersons).values({
          id,
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          userId: input.userId ?? null,
          name: input.name,
          category: input.category,
          injury: input.injury,
          ohFollowUpRequired: input.ohFollowUpRequired,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'person_added',
          detail: { personId: id, name: input.name },
        });
        return { personId: id };
      }),

    updatePerson: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          personId: z.string().length(26),
          name: z.string().trim().min(1).max(200).optional(),
          category: z.enum(PERSON_CATEGORIES).optional(),
          injury: personInjurySchema.optional(),
          ohFollowUpRequired: z.boolean().optional(),
          returnedToWork: z.boolean().optional(),
          onRestrictedDuties: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertRecordAuthority(incident, ctx);
        const rows = await ctx.db
          .select({ id: incidentPersons.id })
          .from(incidentPersons)
          .where(
            and(
              eq(incidentPersons.tenantId, ctx.tenantId),
              eq(incidentPersons.incidentId, incident.id),
              eq(incidentPersons.id, input.personId),
            ),
          )
          .limit(1);
        if (rows[0] === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'person-not-found' });
        }
        await ctx.db
          .update(incidentPersons)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.injury !== undefined ? { injury: input.injury } : {}),
            ...(input.ohFollowUpRequired !== undefined
              ? { ohFollowUpRequired: input.ohFollowUpRequired }
              : {}),
            ...(input.returnedToWork !== undefined ? { returnedToWork: input.returnedToWork } : {}),
            ...(input.onRestrictedDuties !== undefined
              ? { onRestrictedDuties: input.onRestrictedDuties }
              : {}),
            updatedAt: new Date(),
          })
          .where(
            and(eq(incidentPersons.tenantId, ctx.tenantId), eq(incidentPersons.id, input.personId)),
          );
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'person_updated',
          detail: { personId: input.personId },
        });
        return { ok: true };
      }),

    removePerson: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(z.object({ incidentId: z.string().length(26), personId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        await ctx.db
          .delete(incidentPersons)
          .where(
            and(
              eq(incidentPersons.tenantId, ctx.tenantId),
              eq(incidentPersons.incidentId, incident.id),
              eq(incidentPersons.id, input.personId),
            ),
          );
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'person_removed',
          detail: { personId: input.personId },
        });
        return { ok: true };
      }),

    addAbsence: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          personId: z.string().length(26),
          fromDate: isoDateSchema,
          toDate: isoDateSchema.nullable().default(null),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertRecordAuthority(incident, ctx);
        if (input.toDate !== null && input.toDate < input.fromDate) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'absence-inverted' });
        }
        const personRows = await ctx.db
          .select({ id: incidentPersons.id })
          .from(incidentPersons)
          .where(
            and(
              eq(incidentPersons.tenantId, ctx.tenantId),
              eq(incidentPersons.incidentId, incident.id),
              eq(incidentPersons.id, input.personId),
            ),
          )
          .limit(1);
        if (personRows[0] === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'person-not-found' });
        }
        const id = newId();
        await ctx.db.insert(incidentAbsences).values({
          id,
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          personId: input.personId,
          fromDate: input.fromDate,
          toDate: input.toDate,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'absence_added',
          detail: { personId: input.personId, fromDate: input.fromDate, toDate: input.toDate },
        });
        await maybeFlagRescreen(ctx.db, incident, ctx.auth.userId, new Date());
        return { absenceId: id };
      }),

    updateAbsence: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          absenceId: z.string().length(26),
          fromDate: isoDateSchema.optional(),
          toDate: isoDateSchema.nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertRecordAuthority(incident, ctx);
        const rows = await ctx.db
          .select()
          .from(incidentAbsences)
          .where(
            and(
              eq(incidentAbsences.tenantId, ctx.tenantId),
              eq(incidentAbsences.incidentId, incident.id),
              eq(incidentAbsences.id, input.absenceId),
            ),
          )
          .limit(1);
        const absence = rows[0];
        if (absence === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'absence-not-found' });
        }
        const nextFrom = input.fromDate ?? absence.fromDate;
        const nextTo = input.toDate !== undefined ? input.toDate : absence.toDate;
        if (nextTo !== null && nextTo < nextFrom) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'absence-inverted' });
        }
        await ctx.db
          .update(incidentAbsences)
          .set({ fromDate: nextFrom, toDate: nextTo })
          .where(
            and(
              eq(incidentAbsences.tenantId, ctx.tenantId),
              eq(incidentAbsences.id, input.absenceId),
            ),
          );
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'absence_updated',
          detail: { absenceId: input.absenceId, fromDate: nextFrom, toDate: nextTo },
        });
        await maybeFlagRescreen(ctx.db, incident, ctx.auth.userId, new Date());
        return { ok: true };
      }),

    removeAbsence: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(z.object({ incidentId: z.string().length(26), absenceId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        await ctx.db
          .delete(incidentAbsences)
          .where(
            and(
              eq(incidentAbsences.tenantId, ctx.tenantId),
              eq(incidentAbsences.incidentId, incident.id),
              eq(incidentAbsences.id, input.absenceId),
            ),
          );
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'absence_removed',
          detail: { absenceId: input.absenceId },
        });
        return { ok: true };
      }),

    // ─── RIDDOR duty ────────────────────────────────────────────────────────

    riddorScreen: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          category: z.enum(RIDDOR_CATEGORIES),
          determinationNote: z.string().trim().min(1).max(5000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        if (incident.status === 'closed' || incident.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'incident-terminal' });
        }
        if (incident.riddorSubmittedAt !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'riddor-already-submitted' });
        }
        const now = new Date();
        const deadline = riddorDeadlineFor(input.category, incident.occurredAt);
        await ctx.db
          .update(incidents)
          .set({
            riddorCategory: input.category,
            riddorDeterminationNote: input.determinationNote,
            riddorScreenedByUserId: ctx.auth.userId,
            riddorScreenedAt: now,
            riddorDeadlineAt: deadline,
            riddorRescreenRequired: false,
            // A fresh determination restarts the warning ladder.
            riddorWarning5SentAt: null,
            riddorWarning2SentAt: null,
            riddorEscalatedAt: null,
            updatedAt: now,
          })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'riddor_screened',
          detail: { category: input.category, deadlineAt: deadline?.toISOString() ?? null },
        });
        return { deadlineAt: deadline };
      }),

    riddorRecordSubmission: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          route: z.enum(RIDDOR_SUBMISSION_ROUTES),
          hseReference: z.string().trim().max(200).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        if (incident.riddorCategory === null || !isRiddorReportable(incident.riddorCategory)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'riddor-not-reportable' });
        }
        if (incident.riddorSubmittedAt !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'riddor-already-submitted' });
        }
        const now = new Date();
        await ctx.db
          .update(incidents)
          .set({
            riddorSubmittedAt: now,
            riddorSubmittedByUserId: ctx.auth.userId,
            riddorSubmissionRoute: input.route,
            riddorHseReference: input.hseReference === '' ? null : input.hseReference,
            updatedAt: now,
          })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'riddor_submitted',
          detail: { route: input.route, hseReference: input.hseReference },
        });
        return { ok: true };
      }),

    // ─── Evidence & witnesses (append-only) ─────────────────────────────────

    addEvidence: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          kind: z.enum(EVIDENCE_KINDS),
          storageKey: z.string().max(500).optional(),
          filename: z.string().max(300).optional(),
          caption: z.string().trim().max(1000).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertRecordAuthority(incident, ctx);
        if (incident.status === 'closed' || incident.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'incident-terminal' });
        }
        if (
          input.storageKey !== undefined &&
          !input.storageKey.startsWith(`${ctx.tenantId}/incidents/${incident.id}/`)
        ) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-storage-key' });
        }
        const id = newId();
        await ctx.db.insert(incidentEvidence).values({
          id,
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          kind: input.kind,
          storageKey: input.storageKey ?? null,
          filename: input.filename ?? null,
          caption: input.caption,
          collectedByUserId: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'evidence_added',
          detail: { evidenceId: id, kind: input.kind },
        });
        return { evidenceId: id };
      }),

    addWitnessStatement: tenantProcedure
      .use(requirePermission('incidents.investigate'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          witnessUserId: z.string().max(64).optional(),
          witnessName: z.string().trim().min(1).max(200),
          statement: z.string().trim().min(1).max(20_000),
          signatureData: z.string().max(200_000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertInvestigationAuthority(incident, ctx);
        if (incident.status === 'closed' || incident.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'incident-terminal' });
        }
        if (input.witnessUserId !== undefined) {
          await loadUserInTenant(ctx.db, ctx.tenantId, input.witnessUserId);
        }
        const id = newId();
        await ctx.db.insert(incidentWitnessStatements).values({
          id,
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          witnessUserId: input.witnessUserId ?? null,
          witnessName: input.witnessName,
          statement: input.statement,
          takenByUserId: ctx.auth.userId,
          signatureData: input.signatureData ?? null,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'witness_statement_added',
          detail: { statementId: id, witnessName: input.witnessName },
        });
        return { statementId: id };
      }),

    // ─── Investigation lifecycle ────────────────────────────────────────────

    startInvestigation: tenantProcedure
      .use(requirePermission('incidents.investigate'))
      .input(idInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertInvestigationAuthority(incident, ctx);
        assertTransition(incident.status, 'investigating');
        const last = await latestInvestigation(ctx.db, ctx.tenantId, incident.id);
        if (last !== null && last.status !== 'approved') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'investigation-already-open' });
        }
        const now = new Date();
        const id = newId();
        const revision = (last?.revision ?? 0) + 1;
        // Reopen path: pre-fill revision n+1 from the frozen revision n.
        await ctx.db.insert(incidentInvestigations).values({
          id,
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          revision,
          method: last?.method ?? null,
          immediateCause: last?.immediateCause ?? '',
          underlyingCause: last?.underlyingCause ?? '',
          contributingFactors: last?.contributingFactors ?? [],
          whyChain: last?.whyChain ?? null,
          causalFactors: last?.causalFactors ?? null,
          timelineEntries: last?.timelineEntries ?? [],
          conclusionSummary: last?.conclusionSummary ?? '',
          rootCauseStatement: last?.rootCauseStatement ?? '',
          recurrenceLikelihood: last?.recurrenceLikelihood ?? null,
          lessonsLearned: last?.lessonsLearned ?? '',
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db
          .update(incidents)
          .set({ status: 'investigating', updatedAt: now })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'investigation_started',
          detail: { revision },
        });
        return { investigationId: id, revision };
      }),

    saveInvestigation: tenantProcedure
      .use(requirePermission('incidents.investigate'))
      .input(saveInvestigationInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertInvestigationAuthority(incident, ctx);
        const investigation = await latestInvestigation(ctx.db, ctx.tenantId, incident.id);
        if (investigation === null) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'investigation-not-found' });
        }
        if (investigation.status === 'approved') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'investigation-frozen' });
        }
        await ctx.db
          .update(incidentInvestigations)
          .set({
            ...(input.method !== undefined ? { method: input.method } : {}),
            ...(input.immediateCause !== undefined ? { immediateCause: input.immediateCause } : {}),
            ...(input.underlyingCause !== undefined
              ? { underlyingCause: input.underlyingCause }
              : {}),
            ...(input.contributingFactors !== undefined
              ? { contributingFactors: input.contributingFactors }
              : {}),
            ...(input.whyChain !== undefined ? { whyChain: input.whyChain } : {}),
            ...(input.causalFactors !== undefined ? { causalFactors: input.causalFactors } : {}),
            ...(input.timelineEntries !== undefined
              ? { timelineEntries: input.timelineEntries }
              : {}),
            ...(input.conclusionSummary !== undefined
              ? { conclusionSummary: input.conclusionSummary }
              : {}),
            ...(input.rootCauseStatement !== undefined
              ? { rootCauseStatement: input.rootCauseStatement }
              : {}),
            ...(input.recurrenceLikelihood !== undefined
              ? { recurrenceLikelihood: input.recurrenceLikelihood }
              : {}),
            ...(input.lessonsLearned !== undefined ? { lessonsLearned: input.lessonsLearned } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(incidentInvestigations.tenantId, ctx.tenantId),
              eq(incidentInvestigations.id, investigation.id),
            ),
          );
        return { ok: true };
      }),

    addFinding: tenantProcedure
      .use(requirePermission('incidents.investigate'))
      .input(findingInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertInvestigationAuthority(incident, ctx);
        const investigation = await latestInvestigation(ctx.db, ctx.tenantId, incident.id);
        if (investigation === null) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'investigation-not-found' });
        }
        if (investigation.status === 'approved') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'investigation-frozen' });
        }
        const id = newId();
        await ctx.db.insert(incidentFindings).values({
          id,
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          investigationId: investigation.id,
          category: input.category,
          priority: input.priority,
          description: input.description,
          requiresAction: input.requiresAction,
        });
        return { findingId: id };
      }),

    updateFinding: tenantProcedure
      .use(requirePermission('incidents.investigate'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          findingId: z.string().length(26),
          category: z.enum(CAUSAL_FACTOR_CATEGORIES).optional(),
          priority: z.enum(FINDING_PRIORITIES).optional(),
          description: z.string().trim().min(1).max(2000).optional(),
          requiresAction: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertInvestigationAuthority(incident, ctx);
        const rows = await ctx.db
          .select()
          .from(incidentFindings)
          .where(
            and(
              eq(incidentFindings.tenantId, ctx.tenantId),
              eq(incidentFindings.incidentId, incident.id),
              eq(incidentFindings.id, input.findingId),
            ),
          )
          .limit(1);
        const finding = rows[0];
        if (finding === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'finding-not-found' });
        }
        const invRows = await ctx.db
          .select({ status: incidentInvestigations.status })
          .from(incidentInvestigations)
          .where(
            and(
              eq(incidentInvestigations.tenantId, ctx.tenantId),
              eq(incidentInvestigations.id, finding.investigationId),
            ),
          )
          .limit(1);
        if (invRows[0]?.status === 'approved') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'investigation-frozen' });
        }
        await ctx.db
          .update(incidentFindings)
          .set({
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.requiresAction !== undefined ? { requiresAction: input.requiresAction } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(eq(incidentFindings.tenantId, ctx.tenantId), eq(incidentFindings.id, finding.id)),
          );
        return { ok: true };
      }),

    removeFinding: tenantProcedure
      .use(requirePermission('incidents.investigate'))
      .input(z.object({ incidentId: z.string().length(26), findingId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertInvestigationAuthority(incident, ctx);
        const rows = await ctx.db
          .select()
          .from(incidentFindings)
          .where(
            and(
              eq(incidentFindings.tenantId, ctx.tenantId),
              eq(incidentFindings.incidentId, incident.id),
              eq(incidentFindings.id, input.findingId),
            ),
          )
          .limit(1);
        const finding = rows[0];
        if (finding === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'finding-not-found' });
        }
        if (finding.actionId !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'finding-has-action' });
        }
        const invRows = await ctx.db
          .select({ status: incidentInvestigations.status })
          .from(incidentInvestigations)
          .where(
            and(
              eq(incidentInvestigations.tenantId, ctx.tenantId),
              eq(incidentInvestigations.id, finding.investigationId),
            ),
          )
          .limit(1);
        if (invRows[0]?.status === 'approved') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'investigation-frozen' });
        }
        await ctx.db
          .delete(incidentFindings)
          .where(
            and(eq(incidentFindings.tenantId, ctx.tenantId), eq(incidentFindings.id, finding.id)),
          );
        return { ok: true };
      }),

    submitInvestigation: tenantProcedure
      .use(requirePermission('incidents.investigate'))
      .input(idInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        // The *lead investigator* submits — managers reassign the lead
        // first if they need to take over (keeps the signature honest).
        if (
          incident.leadInvestigatorUserId !== ctx.auth.userId &&
          !grantsAdminAccess(ctx.permissions)
        ) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not-lead-investigator' });
        }
        const investigation = await latestInvestigation(ctx.db, ctx.tenantId, incident.id);
        if (investigation === null) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'investigation-not-found' });
        }
        if (investigation.status !== 'draft') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'investigation-not-draft' });
        }
        // Level-proportionate completeness gate.
        if (investigation.immediateCause.trim() === '') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'immediate-cause-required' });
        }
        if (investigation.conclusionSummary.trim() === '') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'conclusion-required' });
        }
        if (incident.investigationLevel === 'full') {
          if (investigation.method === null) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'rca-method-required' });
          }
          if (investigation.method === 'five_whys' && investigation.whyChain === null) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'why-chain-required' });
          }
          if (investigation.method === 'causal_factors' && investigation.causalFactors === null) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'causal-factors-required' });
          }
          if (investigation.rootCauseStatement.trim() === '') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'root-cause-required' });
          }
        }
        const now = new Date();
        await ctx.db
          .update(incidentInvestigations)
          .set({
            status: 'submitted',
            submittedByUserId: ctx.auth.userId,
            submittedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(incidentInvestigations.tenantId, ctx.tenantId),
              eq(incidentInvestigations.id, investigation.id),
            ),
          );
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'investigation_submitted',
          detail: { revision: investigation.revision },
        });
        return { ok: true };
      }),

    rejectInvestigation: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(
        z.object({ incidentId: z.string().length(26), note: z.string().trim().min(1).max(2000) }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        const investigation = await latestInvestigation(ctx.db, ctx.tenantId, incident.id);
        if (investigation === null || investigation.status !== 'submitted') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'investigation-not-submitted' });
        }
        const now = new Date();
        await ctx.db
          .update(incidentInvestigations)
          .set({ status: 'draft', submittedByUserId: null, submittedAt: null, updatedAt: now })
          .where(
            and(
              eq(incidentInvestigations.tenantId, ctx.tenantId),
              eq(incidentInvestigations.id, investigation.id),
            ),
          );
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'investigation_rejected',
          detail: { revision: investigation.revision, note: input.note },
        });
        return { ok: true };
      }),

    approveInvestigation: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          assignments: z
            .array(
              z.object({
                findingId: z.string().length(26),
                assigneeUserId: z.string().max(64).optional(),
                dueAt: z.coerce.date().optional(),
              }),
            )
            .max(100)
            .default([]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertTransition(incident.status, 'actions_outstanding');
        const investigation = await latestInvestigation(ctx.db, ctx.tenantId, incident.id);
        if (investigation === null || investigation.status !== 'submitted') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'investigation-not-submitted' });
        }
        // Separation of duties: the approver must not be the lead
        // investigator or the submitter (Marcus's condition, M-2/C-6).
        if (
          ctx.auth.userId === incident.leadInvestigatorUserId ||
          ctx.auth.userId === investigation.submittedByUserId
        ) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'approver-is-investigator' });
        }

        const findings = await ctx.db
          .select()
          .from(incidentFindings)
          .where(
            and(
              eq(incidentFindings.tenantId, ctx.tenantId),
              eq(incidentFindings.investigationId, investigation.id),
            ),
          )
          .orderBy(asc(incidentFindings.createdAt));
        const assignmentByFinding = new Map(input.assignments.map((a) => [a.findingId, a]));
        for (const findingId of assignmentByFinding.keys()) {
          if (!findings.some((f) => f.id === findingId)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'finding-not-found' });
          }
        }
        const assigneeIds = [
          ...new Set(
            input.assignments.flatMap((a) =>
              a.assigneeUserId === undefined ? [] : [a.assigneeUserId],
            ),
          ),
        ];
        for (const userId of assigneeIds) {
          await loadUserInTenant(ctx.db, ctx.tenantId, userId);
        }

        const pending = findings.filter((f) => f.requiresAction && f.actionId === null);
        const daysByPriority = await loadPriorityDueDateDays(ctx.db, ctx.tenantId);
        const now = new Date();

        // Pre-claim references outside the tx (the counter upsert
        // serialises on its own row; a rolled-back claim just skips a
        // number, which is harmless).
        const actionRefs = new Map<string, string>();
        for (const finding of pending) {
          const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'action');
          actionRefs.set(finding.id, `AC-${String(n).padStart(6, '0')}`);
        }

        const generated: Array<{
          actionId: string;
          findingId: string;
          assigneeUserId: string | null;
        }> = [];
        await ctx.db.transaction(async (tx) => {
          await tx
            .update(incidentInvestigations)
            .set({
              status: 'approved',
              approvedByUserId: ctx.auth.userId,
              approvedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(incidentInvestigations.tenantId, ctx.tenantId),
                eq(incidentInvestigations.id, investigation.id),
              ),
            );
          await tx
            .update(incidents)
            .set({ status: 'actions_outstanding', updatedAt: now })
            .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));

          for (const finding of pending) {
            const assignment = assignmentByFinding.get(finding.id);
            const assigneeUserId = assignment?.assigneeUserId ?? null;
            const dueAt = computeAutoDueAt(
              now,
              finding.priority,
              daysByPriority,
              assignment?.dueAt?.toISOString() ?? null,
            );
            const actionId = newId();
            try {
              // Nested tx = SAVEPOINT: a unique violation rolls back to
              // it instead of aborting the whole approval transaction.
              await tx.transaction(async (sp) => {
                await sp.insert(actions).values({
                  id: actionId,
                  tenantId: ctx.tenantId,
                  sourceType: 'incident',
                  sourceId: incident.id,
                  sourceItemId: finding.id,
                  referenceNumber: actionRefs.get(finding.id) ?? null,
                  title: `Incident finding: ${finding.description.slice(0, 200)}`,
                  description: `Raised by incident ${incident.referenceNumber} — category: ${finding.category}.`,
                  status: 'open',
                  priority: finding.priority,
                  assigneeUserId,
                  dueAt,
                  siteId: incident.siteId,
                  createdBy: ctx.auth.userId,
                  createdAt: now,
                  updatedAt: now,
                });
              });
              await tx
                .update(incidentFindings)
                .set({ actionId, updatedAt: now })
                .where(
                  and(
                    eq(incidentFindings.tenantId, ctx.tenantId),
                    eq(incidentFindings.id, finding.id),
                  ),
                );
              generated.push({ actionId, findingId: finding.id, assigneeUserId });
            } catch (err) {
              if (!isUniqueViolation(err)) throw err;
              // Once-only race: another approval already inserted this
              // finding's action — adopt the existing row.
              const existing = await tx
                .select({ id: actions.id })
                .from(actions)
                .where(
                  and(
                    eq(actions.tenantId, ctx.tenantId),
                    eq(actions.sourceType, 'incident'),
                    eq(actions.sourceId, incident.id),
                    eq(actions.sourceItemId, finding.id),
                  ),
                )
                .limit(1);
              const existingId = existing[0]?.id;
              if (existingId !== undefined) {
                await tx
                  .update(incidentFindings)
                  .set({ actionId: existingId, updatedAt: now })
                  .where(
                    and(
                      eq(incidentFindings.tenantId, ctx.tenantId),
                      eq(incidentFindings.id, finding.id),
                    ),
                  );
              }
            }
          }
        });

        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'investigation_approved',
          detail: { revision: investigation.revision },
        });
        if (generated.length > 0) {
          await logEvent(ctx.db, {
            tenantId: ctx.tenantId,
            incidentId: incident.id,
            actorUserId: ctx.auth.userId,
            kind: 'actions_generated',
            detail: { count: generated.length },
          });
        }
        // Assignment emails (best-effort, after commit).
        for (const item of generated) {
          if (item.assigneeUserId === null || item.assigneeUserId === ctx.auth.userId) continue;
          const assignee = await loadUserInTenant(ctx.db, ctx.tenantId, item.assigneeUserId);
          await sendBestEffort(ctx, {
            to: assignee.email,
            templateKey: 'action-assigned',
            variables: {
              recipientName: assignee.name,
              actionTitle: `Incident finding action (${incident.referenceNumber})`,
              sourceRef: incident.referenceNumber,
              viewUrl: `${deps.appUrl ?? ''}/en/actions/${item.actionId}`,
            },
          });
        }
        return { generatedActionIds: generated.map((g) => g.actionId) };
      }),

    // ─── Post-incident review prompts (§8.2) ────────────────────────────────

    promptReviews: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          riskAssessmentIds: z.array(z.string().length(26)).max(50).default([]),
          coshhAssessmentIds: z.array(z.string().length(26)).max(50).default([]),
          fraIds: z.array(z.string().length(26)).max(50).default([]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        const total =
          input.riskAssessmentIds.length + input.coshhAssessmentIds.length + input.fraIds.length;
        if (total === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'nothing-selected' });
        }
        const now = new Date();
        const citation = `Review prompted by incident ${incident.referenceNumber}`;

        if (input.riskAssessmentIds.length > 0) {
          const rows = await ctx.db
            .select({ id: riskAssessments.id })
            .from(riskAssessments)
            .where(
              and(
                eq(riskAssessments.tenantId, ctx.tenantId),
                inArray(riskAssessments.id, input.riskAssessmentIds),
                eq(riskAssessments.status, 'active'),
              ),
            );
          if (rows.length !== input.riskAssessmentIds.length) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'risk-assessment-not-found' });
          }
          await ctx.db
            .update(riskAssessments)
            .set({ nextReviewAt: now, updatedAt: now })
            .where(
              and(
                eq(riskAssessments.tenantId, ctx.tenantId),
                inArray(riskAssessments.id, input.riskAssessmentIds),
              ),
            );
          await ctx.db.insert(riskAssessmentEvents).values(
            input.riskAssessmentIds.map((id) => ({
              id: newId(),
              tenantId: ctx.tenantId,
              assessmentId: id,
              actorUserId: ctx.auth.userId,
              kind: 'review_prompted' as const,
              detail: citation,
            })),
          );
        }

        if (input.coshhAssessmentIds.length > 0) {
          const rows = await ctx.db
            .select({ id: coshhAssessments.id })
            .from(coshhAssessments)
            .where(
              and(
                eq(coshhAssessments.tenantId, ctx.tenantId),
                inArray(coshhAssessments.id, input.coshhAssessmentIds),
                eq(coshhAssessments.status, 'active'),
              ),
            );
          if (rows.length !== input.coshhAssessmentIds.length) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'coshh-assessment-not-found' });
          }
          await ctx.db
            .update(coshhAssessments)
            .set({ nextReviewAt: now, updatedAt: now })
            .where(
              and(
                eq(coshhAssessments.tenantId, ctx.tenantId),
                inArray(coshhAssessments.id, input.coshhAssessmentIds),
              ),
            );
          await ctx.db.insert(coshhEvents).values(
            input.coshhAssessmentIds.map((id) => ({
              id: newId(),
              tenantId: ctx.tenantId,
              entityType: 'assessment' as const,
              entityId: id,
              actorUserId: ctx.auth.userId,
              kind: 'review_prompted' as const,
              detail: citation,
            })),
          );
        }

        if (input.fraIds.length > 0) {
          const rows = await ctx.db
            .select({ id: fireRiskAssessments.id })
            .from(fireRiskAssessments)
            .where(
              and(
                eq(fireRiskAssessments.tenantId, ctx.tenantId),
                inArray(fireRiskAssessments.id, input.fraIds),
                eq(fireRiskAssessments.status, 'active'),
              ),
            );
          if (rows.length !== input.fraIds.length) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'fra-not-found' });
          }
          await ctx.db
            .update(fireRiskAssessments)
            .set({ nextReviewAt: now, updatedAt: now })
            .where(
              and(
                eq(fireRiskAssessments.tenantId, ctx.tenantId),
                inArray(fireRiskAssessments.id, input.fraIds),
              ),
            );
          await ctx.db.insert(fireEvents).values(
            input.fraIds.map((id) => ({
              id: newId(),
              tenantId: ctx.tenantId,
              entityType: 'fra' as const,
              entityId: id,
              actorUserId: ctx.auth.userId,
              kind: 'review_prompted' as const,
              detail: citation,
            })),
          );
        }

        await ctx.db
          .update(incidents)
          .set({ reviewPromptAt: now, reviewPromptSkippedReason: null, updatedAt: now })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'reviews_prompted',
          detail: {
            riskAssessments: input.riskAssessmentIds.length,
            coshhAssessments: input.coshhAssessmentIds.length,
            fras: input.fraIds.length,
          },
        });
        return { prompted: total };
      }),

    /**
     * Active assessments the prompt-reviews step can push into their
     * due-review state. Served from here so the UI needs no knowledge of
     * three other routers' shapes.
     */
    reviewPromptCandidates: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .query(async ({ ctx }) => {
        assertEnabled();
        const [ras, coshh, fras] = await Promise.all([
          ctx.db
            .select({
              id: riskAssessments.id,
              referenceNumber: riskAssessments.referenceNumber,
              title: riskAssessments.title,
            })
            .from(riskAssessments)
            .where(
              and(eq(riskAssessments.tenantId, ctx.tenantId), eq(riskAssessments.status, 'active')),
            )
            .orderBy(asc(riskAssessments.title))
            .limit(200),
          ctx.db
            .select({
              id: coshhAssessments.id,
              referenceNumber: coshhAssessments.referenceNumber,
              title: coshhAssessments.taskDescription,
            })
            .from(coshhAssessments)
            .where(
              and(
                eq(coshhAssessments.tenantId, ctx.tenantId),
                eq(coshhAssessments.status, 'active'),
              ),
            )
            .orderBy(asc(coshhAssessments.taskDescription))
            .limit(200),
          ctx.db
            .select({
              id: fireRiskAssessments.id,
              referenceNumber: fireRiskAssessments.referenceNumber,
              title: fireRiskAssessments.title,
            })
            .from(fireRiskAssessments)
            .where(
              and(
                eq(fireRiskAssessments.tenantId, ctx.tenantId),
                eq(fireRiskAssessments.status, 'active'),
              ),
            )
            .orderBy(asc(fireRiskAssessments.title))
            .limit(200),
        ]);
        return { riskAssessments: ras, coshhAssessments: coshh, fras };
      }),

    skipReviews: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(
        z.object({ incidentId: z.string().length(26), reason: z.string().trim().min(3).max(1000) }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        await ctx.db
          .update(incidents)
          .set({ reviewPromptSkippedReason: input.reason, updatedAt: new Date() })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'reviews_prompt_skipped',
          detail: { reason: input.reason },
        });
        return { ok: true };
      }),

    // ─── Closure, reopen, cancel, effectiveness ─────────────────────────────

    close: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          effectivenessDays: z.number().int().min(30).max(365).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertTransition(incident.status, 'closed');
        // RIDDOR duty must be discharged: screened, and submitted when
        // the determination is reportable.
        if (incident.riddorCategory === null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'riddor-unscreened' });
        }
        if (incident.riddorRescreenRequired) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'riddor-rescreen-required' });
        }
        if (isRiddorReportable(incident.riddorCategory) && incident.riddorSubmittedAt === null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'riddor-not-submitted' });
        }
        // Every linked action must be terminal.
        const openActions = await ctx.db
          .select({ id: actions.id })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, ctx.tenantId),
              eq(actions.sourceType, 'incident'),
              eq(actions.sourceId, incident.id),
              inArray(actions.status, ['open', 'in_progress']),
            ),
          )
          .limit(1);
        if (openActions[0] !== undefined) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'actions-open' });
        }
        const anyActions = await ctx.db
          .select({ id: actions.id })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, ctx.tenantId),
              eq(actions.sourceType, 'incident'),
              eq(actions.sourceId, incident.id),
            ),
          )
          .limit(1);
        const now = new Date();
        const dueAt =
          anyActions[0] !== undefined ? effectivenessDueAt(now, input.effectivenessDays) : null;
        await ctx.db
          .update(incidents)
          .set({
            status: 'closed',
            closedAt: now,
            closedByUserId: ctx.auth.userId,
            effectivenessDueAt: dueAt,
            updatedAt: now,
          })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'closed',
          detail: { effectivenessDueAt: dueAt?.toISOString() ?? null },
        });
        return { effectivenessDueAt: dueAt };
      }),

    reopen: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(
        z.object({ incidentId: z.string().length(26), reason: z.string().trim().min(3).max(2000) }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        assertTransition(incident.status, 'reopened');
        const now = new Date();
        await ctx.db
          .update(incidents)
          .set({ status: 'reopened', updatedAt: now })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'reopened',
          detail: { reason: input.reason },
        });
        return { ok: true };
      }),

    cancel: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(
        z.object({ incidentId: z.string().length(26), reason: z.string().trim().min(3).max(2000) }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        const isManager =
          ctx.permissions.includes('incidents.manage') || grantsAdminAccess(ctx.permissions);
        const isOwnReported =
          incident.reportedByUserId === ctx.auth.userId && incident.status === 'reported';
        if (!isManager && !isOwnReported) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not-allowed' });
        }
        assertTransition(incident.status, 'cancelled');
        const now = new Date();
        await ctx.db
          .update(incidents)
          .set({ status: 'cancelled', updatedAt: now })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'cancelled',
          detail: { reason: input.reason },
        });
        return { ok: true };
      }),

    recordEffectiveness: tenantProcedure
      .use(requirePermission('incidents.manage'))
      .input(
        z.object({
          incidentId: z.string().length(26),
          verdict: z.enum(EFFECTIVENESS_VERDICTS),
          note: z.string().trim().max(5000).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        if (incident.status !== 'closed') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'incident-not-closed' });
        }
        if (incident.effectivenessDueAt === null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'effectiveness-not-scheduled' });
        }
        const now = new Date();
        await ctx.db
          .update(incidents)
          .set({
            effectivenessVerdict: input.verdict,
            effectivenessNote: input.note,
            effectivenessRecordedAt: now,
            effectivenessRecordedByUserId: ctx.auth.userId,
            updatedAt: now,
          })
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incident.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: incident.id,
          actorUserId: ctx.auth.userId,
          kind: 'effectiveness_recorded',
          detail: { verdict: input.verdict },
        });
        // `not_effective` → the client offers the reopen path (IN-E20).
        return { promptReopen: input.verdict === 'not_effective' };
      }),

    // ─── Observation promotion (§8.1) ───────────────────────────────────────

    createFromObservation: tenantProcedure
      .use(requirePermission('incidents.report'))
      .input(
        z.object({
          observationId: z.string().length(26),
          kind: z.enum(INCIDENT_KINDS).default('near_miss'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const issueRows = await ctx.db
          .select()
          .from(issues)
          .where(and(eq(issues.tenantId, ctx.tenantId), eq(issues.id, input.observationId)))
          .limit(1);
        const issue = issueRows[0];
        if (issue === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'observation-not-found' });
        }
        const now = new Date();
        const occurredAt = issue.dateOccurred.getTime() > now.getTime() ? now : issue.dateOccurred;
        const id = newId();
        const refValue = await nextReferenceValue(ctx.db, ctx.tenantId, 'incident');
        const referenceNumber = formatIncidentReference(refValue);
        await ctx.db.insert(incidents).values({
          id,
          tenantId: ctx.tenantId,
          referenceNumber,
          title: issue.title,
          description: issue.description ?? '',
          kind: input.kind,
          severity: 'minor',
          status: 'reported',
          confidential: defaultConfidential(input.kind),
          occurredAt,
          reportedAt: now,
          reportedByUserId: ctx.auth.userId,
          siteId: issue.siteId,
          locationText: issue.locationAddress ?? '',
          details: {},
          observationId: issue.id,
          createdAt: now,
          updatedAt: now,
        });
        // Carry the observation's photos over as evidence references —
        // same storage keys, no blob copy; the rows record their origin.
        const attachments = await ctx.db
          .select()
          .from(issueAttachments)
          .where(
            and(
              eq(issueAttachments.tenantId, ctx.tenantId),
              eq(issueAttachments.issueId, issue.id),
            ),
          );
        if (attachments.length > 0) {
          await ctx.db.insert(incidentEvidence).values(
            attachments.map((att) => ({
              id: newId(),
              tenantId: ctx.tenantId,
              incidentId: id,
              kind: (att.mimeType.startsWith('image/') ? 'photo' : 'document') as
                | 'photo'
                | 'document',
              storageKey: att.storageKey,
              filename: att.filename,
              caption: `Carried over from observation ${issue.referenceNumber ?? issue.id}`,
              collectedByUserId: ctx.auth.userId,
            })),
          );
        }
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          incidentId: id,
          actorUserId: ctx.auth.userId,
          kind: 'promoted_from_observation',
          detail: { observationId: issue.id, observationRef: issue.referenceNumber },
        });
        // Cross-link on the observation side (its activity log renders it).
        await ctx.db.insert(issueActivity).values({
          id: newId(),
          tenantId: ctx.tenantId,
          issueId: issue.id,
          actorUserId: ctx.auth.userId,
          kind: 'escalated_to_incident',
          payload: { incidentId: id, incidentRef: referenceNumber },
        });
        return { incidentId: id, referenceNumber };
      }),

    // ─── Exports ────────────────────────────────────────────────────────────

    exportCsv: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(listInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const conditions = [eq(incidents.tenantId, ctx.tenantId)];
        if (input.status !== undefined && input.status.length > 0) {
          conditions.push(inArray(incidents.status, input.status));
        } else if (!input.includeCancelled) {
          conditions.push(ne(incidents.status, 'cancelled'));
        }
        if (input.kind !== undefined && input.kind.length > 0) {
          conditions.push(inArray(incidents.kind, input.kind));
        }
        if (input.siteId !== undefined) conditions.push(eq(incidents.siteId, input.siteId));
        const rows = await ctx.db
          .select()
          .from(incidents)
          .where(and(...conditions))
          .orderBy(desc(incidents.occurredAt))
          .limit(2000);

        const siteIds = [...new Set(rows.flatMap((r) => (r.siteId === null ? [] : [r.siteId])))];
        const siteRows =
          siteIds.length === 0
            ? []
            : await ctx.db
                .select({ id: sites.id, name: sites.name })
                .from(sites)
                .where(and(eq(sites.tenantId, ctx.tenantId), inArray(sites.id, siteIds)));
        const siteNames = Object.fromEntries(siteRows.map((r) => [r.id, r.name]));

        const absenceRows = await ctx.db
          .select({
            incidentId: incidentAbsences.incidentId,
            fromDate: incidentAbsences.fromDate,
            toDate: incidentAbsences.toDate,
          })
          .from(incidentAbsences)
          .where(eq(incidentAbsences.tenantId, ctx.tenantId));
        const absencesByIncident = new Map<
          string,
          Array<{ fromDate: string; toDate: string | null }>
        >();
        for (const row of absenceRows) {
          const list = absencesByIncident.get(row.incidentId) ?? [];
          list.push({ fromDate: row.fromDate, toDate: row.toDate });
          absencesByIncident.set(row.incidentId, list);
        }

        const now = new Date();
        const csvRows = rows.map((row) => {
          const restricted = !canViewConfidential(row, ctx);
          return {
            reference: row.referenceNumber,
            title: restricted ? 'Confidential' : row.title,
            kind: row.kind,
            severity: row.severity,
            status: row.status,
            confidential: row.confidential ? 'yes' : 'no',
            occurredAt: row.occurredAt.toISOString(),
            reportedAt: row.reportedAt.toISOString(),
            site: row.siteId === null ? '' : (siteNames[row.siteId] ?? ''),
            riddorCategory: row.riddorCategory ?? '',
            riddorDeadline: row.riddorDeadlineAt?.toISOString() ?? '',
            riddorSubmitted: row.riddorSubmittedAt?.toISOString() ?? '',
            daysLost: totalDaysLost(
              absencesByIncident.get(row.id) ?? [],
              isoDate(row.occurredAt),
              isoDate(now),
            ),
            effectivenessVerdict: row.effectivenessVerdict ?? '',
          };
        });
        const csv = toCsv(csvRows, [
          'reference',
          'title',
          'kind',
          'severity',
          'status',
          'confidential',
          'occurredAt',
          'reportedAt',
          'site',
          'riddorCategory',
          'riddorDeadline',
          'riddorSubmitted',
          'daysLost',
          'effectivenessVerdict',
        ]);
        return { csv, rowCount: csvRows.length };
      }),

    renderPdf: tenantProcedure
      .use(requirePermission('incidents.view'))
      .input(idInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const incident = await loadIncident(ctx.db, ctx.tenantId, input.incidentId);
        assertDetailAccess(incident, ctx);
        if (deps.renderPdf === undefined) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'render-unavailable' });
        }
        const rendered = await deps.renderPdf({ tenantId: ctx.tenantId, incidentId: incident.id });
        return {
          storageKey: rendered.key,
          filename: `${incident.referenceNumber}.pdf`,
          sizeBytes: rendered.bytes,
          stub: rendered.stub,
        };
      }),
  });
}

/**
 * Recording authority for the operational sub-records (people, absences,
 * evidence): the reporter, the lead investigator, or an
 * `incidents.investigate` / `incidents.manage` holder. Mirrors the
 * permits `assertCanRecord` stance — the person doing the work records
 * the facts; lifecycle authority stays with `manage`.
 */
function assertRecordAuthority(incident: Incident, ctx: CallerCtx): void {
  if (grantsAdminAccess(ctx.permissions)) return;
  if (ctx.permissions.includes('incidents.manage')) return;
  if (ctx.permissions.includes('incidents.investigate')) return;
  if (incident.reportedByUserId === ctx.auth.userId) return;
  if (incident.leadInvestigatorUserId === ctx.auth.userId) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'not-allowed' });
}

export type IncidentsRouter = ReturnType<typeof createIncidentsRouter>;
