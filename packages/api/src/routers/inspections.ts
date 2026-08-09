/**
 * Inspections router — Phase 2 PR 28.
 *
 * The conduct-side surface. An inspection:
 *   1. Starts — pins the currently-published template version (T-E04),
 *      snapshots the caller's access state (ADR 0007), stamps the
 *      template's monotonic document-number counter and renders the
 *      initial title + document number.
 *   2. Progresses — autosave via `saveProgress` (optimistic concurrency
 *      via expectedUpdatedAt, T-E18 style).
 *   3. Submits — `submit` transitions to awaiting_signature_workflow /
 *      awaiting_signatures / awaiting_approval / completed depending on
 *      what the pinned version requires. Workflow takes precedence over
 *      the item-level signature path when both are configured (workflow
 *      is the post-submission review gate).
 *   4. Ends — via approvals router or an explicit `reject`.
 *
 * ADR 0007 snapshot columns are populated in `create`; the ADR 0007 read
 * path (gating in-flight actions on the snapshot) lives in Phase 2.2 and
 * later modules. Phase 2 PR 28 just lays the foundation.
 *
 * Also registers dependents resolvers:
 *   - 'inspections' — counts actions referencing this inspection.
 *   - 'templates' — REPLACES the shim registered by the templates router
 *     with a real resolver that counts inspections referencing any
 *     version of the template.
 *
 * Built as a factory `createInspectionsRouter({ sendEmail, appUrl, logger })`
 * so the signature-workflow email side-effects can be tested.
 */
import {
  actions,
  accessRules,
  groupMembers,
  inspectionApprovals,
  inspectionAssetSelections,
  inspectionSignatures,
  inspectionWorkflowSigners,
  inspections,
  permissionSets,
  scheduledInspectionOccurrences,
  siteMembers,
  sites,
  templateVersions,
  templates,
  user,
  type AccessSnapshot,
} from '@forma360/db/schema';
import { resolveAccessRule } from '@forma360/permissions/access';
import { isPermissionKey } from '@forma360/permissions/catalogue';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { appLink } from '@forma360/shared/app-link';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import { newId } from '@forma360/shared/id';
import { usersHoldingPermission } from '@forma360/permissions/holders';
import { notifyInApp } from '../notify';
import type { Logger } from '@forma360/shared/logger';
import { parseTemplateContent } from '@forma360/shared/template-schema';
import type { SignatureWorkflow } from '@forma360/shared/template-schema';
import {
  collectActiveTriggers,
  missingEvidence,
  missingNotes,
} from '@forma360/shared/inspection-eval';
import { createInspectionActionIfAbsent } from './actions';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { callerSatisfiesAccessRule, loadCallerAccessSnapshot } from '../access-rule';
import { loadContractorScope } from '../contractor-scope';
import { z } from 'zod';
import { boundedRecord } from '../bounded-json';
import { requirePermission, tenantProcedure } from '../procedures';
import { assertSitesInTenant } from '../tenant-guards';
import { router } from '../trpc';

// ─── Title / documentNumber rendering ──────────────────────────────────────

interface TitleRenderContext {
  date: Date;
  site?: string | undefined;
  conductedBy?: string | undefined;
  documentNumber?: string | undefined;
}

/**
 * Render a template's titleFormat into a concrete title. Supported tokens:
 *   {date}         — ISO date (YYYY-MM-DD)
 *   {site}         — the site id (placeholder; later phases render name)
 *   {conductedBy}  — the user id (placeholder)
 *   {docNumber}    — the rendered document number, if already stamped
 *
 * Unknown tokens are left literal so an admin sees them in the rendered
 * title and knows to fix the format. Truncated to 250 chars per T-E09.
 */
export function renderTitle(format: string, ctx: TitleRenderContext): string {
  const iso = ctx.date.toISOString().slice(0, 10);
  const replaced = format
    .replaceAll('{date}', iso)
    .replaceAll('{site}', ctx.site ?? '')
    .replaceAll('{conductedBy}', ctx.conductedBy ?? '')
    .replaceAll('{docNumber}', ctx.documentNumber ?? '');
  return replaced.slice(0, 250);
}

/**
 * Render a template's documentNumberFormat. The only required token is
 * {counter:N} which zero-pads the monotonic counter to N digits.
 */
export function renderDocumentNumber(format: string, counter: number): string {
  return format.replace(/\{counter:(\d+)\}/g, (_m, digitsStr: string) => {
    const digits = Number.parseInt(digitsStr, 10);
    return counter.toString().padStart(digits, '0');
  });
}

// ─── Dependents resolvers ───────────────────────────────────────────────────

const inspectionsResolver: DependentResolver = async (deps, input) => {
  if (input.entity !== 'inspection') return 0;
  const rows = await deps.db
    .select({ id: actions.id })
    .from(actions)
    .where(
      and(
        eq(actions.tenantId, input.tenantId),
        eq(actions.sourceType, 'inspection'),
        eq(actions.sourceId, input.id),
      ),
    );
  return rows.length;
};
registerDependentResolver('inspections', inspectionsResolver);

// Replace the PR 26 templates shim with a real resolver now that we can
// count inspections referencing a template.
const templatesResolverReal: DependentResolver = async (deps, input) => {
  if (input.entity !== 'template') return 0;
  const rows = await deps.db
    .select({ id: inspections.id })
    .from(inspections)
    .where(and(eq(inspections.tenantId, input.tenantId), eq(inspections.templateId, input.id)));
  return rows.length;
};
registerDependentResolver('templates', templatesResolverReal);

// ─── Input schemas ──────────────────────────────────────────────────────────

const listInput = z
  .object({
    status: z
      .enum([
        'in_progress',
        'awaiting_signatures',
        'awaiting_signature_workflow',
        'awaiting_approval',
        'completed',
        'rejected',
      ])
      .optional(),
    templateId: z.string().length(26).optional(),
    /** Filter to inspections conducted at a specific site/project. */
    siteId: z.string().length(26).optional(),
    /** Filter by the user who conducted the inspection (inspections.createdBy). */
    conductedById: z.string().min(1).max(64).optional(),
    /** Conducted-on date range (inclusive), filtered on inspections.startedAt. */
    conductedFrom: z.string().datetime().optional(),
    conductedTo: z.string().datetime().optional(),
    /** Filter to inspections linked to a specific issue (observation). */
    sourceIssueId: z.string().length(26).optional(),
    includeArchived: z.boolean().default(false),
  })
  .default({});

const getInput = z.object({ inspectionId: z.string().length(26) });

const createInput = z.object({
  templateId: z.string().length(26),
  siteId: z.string().length(26).optional(),
  /** Observation/issue that triggered this inspection. Sets sourceType='issue'. */
  sourceIssueId: z.string().length(26).optional(),
  /**
   * Scheduled occurrence being started (PF-3). Links the occurrence to
   * this inspection and flips it to in_progress so the scheduler can
   * finally tell done from missed.
   */
  occurrenceId: z.string().length(26).optional(),
});

const saveProgressInput = z.object({
  inspectionId: z.string().length(26),
  responses: boundedRecord,
  expectedUpdatedAt: z.string().datetime().optional(),
});

const submitInput = z.object({ inspectionId: z.string().length(26) });

const rejectInput = z.object({
  inspectionId: z.string().length(26),
  reason: z.string().min(1).max(2000),
});

const deleteInput = z.object({ inspectionId: z.string().length(26) });

const reopenInput = z.object({ inspectionId: z.string().length(26) });

const signWorkflowInput = z.object({
  inspectionId: z.string().length(26),
  signatureData: z.string().min(1).max(2_000_000),
  comment: z.string().max(2000).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadAccessSnapshot(
  db: Parameters<DependentResolver>[0]['db'],
  tenantId: string,
  userId: string,
): Promise<AccessSnapshot> {
  const groupRows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.tenantId, tenantId), eq(groupMembers.userId, userId)));
  const siteRows = await db
    .select({ siteId: siteMembers.siteId })
    .from(siteMembers)
    .where(and(eq(siteMembers.tenantId, tenantId), eq(siteMembers.userId, userId)));
  const permRows = await db
    .select({ permissions: permissionSets.permissions })
    .from(user)
    .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
    .where(and(eq(user.id, userId), eq(user.tenantId, tenantId)))
    .limit(1);
  const perms = permRows[0]?.permissions.filter((p): p is string => isPermissionKey(p)) ?? [];
  return {
    groups: groupRows.map((r) => r.groupId),
    sites: siteRows.map((r) => r.siteId),
    permissions: perms,
    snapshotAt: new Date().toISOString(),
  };
}

// ─── Router factory ─────────────────────────────────────────────────────────

/** Injected dependencies for the inspections router (wired at app boot). */
export interface InspectionsRouterDeps {
  /** Sends templated emails. Resend in prod, pino-console in dev. */
  sendEmail: SendTemplatedEmail;
  /** Canonical APP_URL — e.g. "https://app.forma360.com" (no trailing slash). */
  appUrl: string;
  /** Pino logger. Per-request child loggers also flow through ctx.logger. */
  logger: Logger;
}

type Db = Parameters<Parameters<typeof tenantProcedure.query>[0]>[0]['ctx']['db'];

/**
 * Resolve an inspection for the CALLER, applying every predicate the
 * canonical read applies (IS-S01..S04).
 *
 * `loadContractorScope` was called in exactly two places in this router —
 * `list` and `get` — while every other door the same permissions open
 * resolved the inspection by tenant + id and stopped there. A portal
 * contractor user's `inspections` activity grants THREE permissions
 * tenant-wide (`view`, `conduct`, `sign`), so `get` returned NOT_FOUND on
 * another company's inspection while the same caller could still read its
 * signature sheet, overwrite its answers, sign it, and collect a working
 * public share URL for it.
 *
 * The scope stopped at the procedure NAME rather than at the boundary —
 * the identical shape the issues router had, and the reason this is one
 * function rather than four copies of a predicate: four siblings can
 * dissent from `get`; four call sites of the same helper cannot.
 *
 * Both predicates travel together, because "every predicate the canonical
 * read applies" is the whole rule:
 *   1. contractor scope — a portal user sees only their own company's;
 *   2. the template's access rule — extended to instances by `get`, and
 *      bypassed by `inspections.manage` exactly as `get` bypasses it.
 *
 * It also restores PF-19's server-side induction gate on those paths: a
 * path that never called `loadContractorScope` never checked induction
 * either.
 *
 * NOT_FOUND rather than FORBIDDEN for the contractor case, matching `get`:
 * a portal user must not learn that an inspection they cannot see exists.
 */
export async function loadInspectionForCallerOrThrow(
  ctx: {
    db: Db;
    tenantId: string;
    auth: { userId: string };
    permissions: readonly string[];
  },
  inspectionId: string,
): Promise<typeof inspections.$inferSelect> {
  const rows = await ctx.db
    .select()
    .from(inspections)
    .where(and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, inspectionId)))
    .limit(1);
  const insp = rows[0];
  if (insp === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

  const scope = await loadContractorScope(ctx.db, ctx.tenantId, ctx.auth.userId);
  if (scope !== null && !scope.userIds.includes(insp.createdBy)) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  if (!ctx.permissions.includes('inspections.manage')) {
    const tplRows = await ctx.db
      .select({ accessRuleId: templates.accessRuleId })
      .from(templates)
      .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, insp.templateId)))
      .limit(1);
    const accessRuleId = tplRows[0]?.accessRuleId ?? null;
    if (
      accessRuleId !== null &&
      !(await callerSatisfiesAccessRule(ctx.db, ctx.tenantId, ctx.auth.userId, accessRuleId))
    ) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not satisfy this template’s access rule',
      });
    }
  }
  return insp;
}

/** Delete + re-insert inspection_asset_selections for every 'asset' question. */
async function syncAssetSelections(
  db: Db,
  tenantId: string,
  inspectionId: string,
  templateVersionId: string,
  responses: Record<string, unknown>,
): Promise<void> {
  const versionRows = await db
    .select({ content: templateVersions.content })
    .from(templateVersions)
    .where(eq(templateVersions.id, templateVersionId))
    .limit(1);
  const version = versionRows[0];
  if (version === undefined) return;

  const content = parseTemplateContent(version.content);

  // Collect all asset question IDs from the template content.
  const assetQuestionIds = new Set<string>();
  for (const page of content.pages)
    for (const section of page.sections)
      for (const item of section.items) if (item.type === 'asset') assetQuestionIds.add(item.id);

  if (assetQuestionIds.size === 0) return;

  // Wipe existing link rows for this inspection so we can replace them cleanly.
  await db
    .delete(inspectionAssetSelections)
    .where(eq(inspectionAssetSelections.inspectionId, inspectionId));

  const toInsert: {
    id: string;
    tenantId: string;
    inspectionId: string;
    questionId: string;
    assetId: string;
  }[] = [];
  for (const questionId of assetQuestionIds) {
    const raw = responses[questionId];
    if (raw === null || raw === undefined) continue;
    const assetIds =
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      'assetIds' in raw &&
      Array.isArray((raw as { assetIds: unknown }).assetIds)
        ? ((raw as { assetIds: unknown[] }).assetIds.filter(
            (id) => typeof id === 'string',
          ) as string[])
        : [];
    for (const assetId of assetIds) {
      toInsert.push({ id: newId(), tenantId, inspectionId, questionId, assetId });
    }
  }

  if (toInsert.length > 0) {
    await db.insert(inspectionAssetSelections).values(toInsert).onConflictDoNothing();
  }
}

/**
 * Mirror the "Site conducted" (`type: 'site'`) answer into `inspection.siteId`
 * so the report, `?site=` filters, Sites-overview links and the `{site}` title
 * token all reflect the conducted site (bug B4). The response stores the raw
 * site id; we validate it belongs to the tenant before writing and clear the
 * column when the answer is empty/invalid. Returns the resolved site id so the
 * submit path can use it for its side-effects (e.g. actions raised on submit).
 * The first `site` question (conventionally the title-page one) wins.
 */
async function syncConductedSite(
  db: Db,
  tenantId: string,
  inspectionId: string,
  templateVersionId: string,
  responses: Record<string, unknown>,
): Promise<string | null> {
  const versionRows = await db
    .select({ content: templateVersions.content })
    .from(templateVersions)
    .where(eq(templateVersions.id, templateVersionId))
    .limit(1);
  const version = versionRows[0];
  if (version === undefined) return null;

  const content = parseTemplateContent(version.content);

  let siteQuestionId: string | undefined;
  for (const page of content.pages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        if (item.type === 'site') {
          siteQuestionId = item.id;
          break;
        }
      }
      if (siteQuestionId !== undefined) break;
    }
    if (siteQuestionId !== undefined) break;
  }
  // No site question in this template → don't touch a siteId that may have been
  // set another way.
  if (siteQuestionId === undefined) return null;

  const raw = responses[siteQuestionId];
  const answeredSiteId = typeof raw === 'string' && raw.length === 26 ? raw : null;

  let nextSiteId: string | null = null;
  if (answeredSiteId !== null) {
    const siteRows = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.id, answeredSiteId)))
      .limit(1);
    if (siteRows[0] !== undefined) nextSiteId = answeredSiteId;
  }

  await db.update(inspections).set({ siteId: nextSiteId }).where(eq(inspections.id, inspectionId));
  return nextSiteId;
}

export function createInspectionsRouter(deps: InspectionsRouterDeps) {
  const appUrl = deps.appUrl.replace(/\/$/, '');

  /**
   * Resolve a user's display name / email. Used to compose the
   * `requesterName` / `signerName` / `recipientName` email variables.
   * Falls back to userId when the row is missing — keeps the email
   * deliverable rather than swallowing the send.
   */
  async function userLabel(
    db: Parameters<DependentResolver>[0]['db'],
    tenantId: string,
    userId: string,
  ): Promise<{ name: string; email: string; locale: string | null }> {
    const rows = await db
      // DOC-A01: locale, so the sign link lands in the signer's language.
      .select({ name: user.name, email: user.email, locale: user.locale })
      .from(user)
      .where(and(eq(user.tenantId, tenantId), eq(user.id, userId)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return { name: userId, email: '', locale: null };
    }
    return { name: row.name, email: row.email, locale: row.locale };
  }

  /**
   * Send a signature-workflow-request email to one signer.
   *
   * Errors are logged but never thrown — email delivery is best-effort.
   * The signer can always reach the inspection via the in-app
   * `listAwaitingMySignature` query.
   */
  async function sendSignatureRequestEmail(args: {
    db: Parameters<DependentResolver>[0]['db'];
    tenantId: string;
    inspectionId: string;
    inspectionTitle: string;
    requesterUserId: string;
    signerUserId: string;
  }): Promise<void> {
    const [signer, requester] = await Promise.all([
      userLabel(args.db, args.tenantId, args.signerUserId),
      userLabel(args.db, args.tenantId, args.requesterUserId),
    ]);
    if (signer.email.length === 0) {
      deps.logger.warn(
        { signerUserId: args.signerUserId, inspectionId: args.inspectionId },
        '[inspections] skipped signature request email: signer has no email',
      );
      return;
    }
    try {
      await deps.sendEmail({
        to: signer.email,
        templateKey: 'signature-workflow-request',
        variables: {
          inspectionTitle: args.inspectionTitle,
          requesterName: requester.name,
          signerName: signer.name,
          signUrl: appLink(appUrl, signer.locale, `/inspections/${args.inspectionId}/sign`),
        },
      });
    } catch (err) {
      deps.logger.error(
        { err, inspectionId: args.inspectionId, signerUserId: args.signerUserId },
        '[inspections] signature request email failed',
      );
    }
  }

  async function sendCompletionEmails(args: {
    db: Parameters<DependentResolver>[0]['db'];
    tenantId: string;
    inspectionId: string;
    inspectionTitle: string;
    recipientUserIds: readonly string[];
  }): Promise<void> {
    for (const userId of args.recipientUserIds) {
      const recipient = await userLabel(args.db, args.tenantId, userId);
      if (recipient.email.length === 0) continue;
      try {
        await deps.sendEmail({
          to: recipient.email,
          templateKey: 'signature-workflow-complete',
          variables: {
            inspectionTitle: args.inspectionTitle,
            recipientName: recipient.name,
            viewUrl: appLink(appUrl, recipient.locale, `/inspections/${args.inspectionId}`),
          },
        });
      } catch (err) {
        deps.logger.error(
          { err, inspectionId: args.inspectionId, recipientUserId: userId },
          '[inspections] completion email failed',
        );
      }
    }
  }

  return router({
    list: tenantProcedure
      .use(requirePermission('inspections.view'))
      .input(listInput)
      .query(async ({ ctx, input }) => {
        const where = [eq(inspections.tenantId, ctx.tenantId)];
        if (input.status !== undefined) where.push(eq(inspections.status, input.status));
        if (input.templateId !== undefined)
          where.push(eq(inspections.templateId, input.templateId));
        if (input.siteId !== undefined) where.push(eq(inspections.siteId, input.siteId));
        if (input.conductedById !== undefined)
          where.push(eq(inspections.createdBy, input.conductedById));
        if (input.conductedFrom !== undefined)
          where.push(gte(inspections.startedAt, new Date(input.conductedFrom)));
        if (input.conductedTo !== undefined)
          where.push(lte(inspections.startedAt, new Date(input.conductedTo)));
        if (input.sourceIssueId !== undefined) {
          where.push(eq(inspections.sourceType, 'issue'));
          where.push(eq(inspections.sourceId, input.sourceIssueId));
        }
        if (!input.includeArchived) where.push(isNull(inspections.archivedAt));
        // External contractor portal users only see inspections authored within
        // their own contractor (internal users → scope null → unrestricted).
        const listScope = await loadContractorScope(ctx.db, ctx.tenantId, ctx.auth.userId);
        if (listScope !== null) where.push(inArray(inspections.createdBy, listScope.userIds));
        const rows = await ctx.db
          .select({
            id: inspections.id,
            templateId: inspections.templateId,
            templateVersionId: inspections.templateVersionId,
            status: inspections.status,
            title: inspections.title,
            documentNumber: inspections.documentNumber,
            siteId: inspections.siteId,
            score: inspections.score,
            startedAt: inspections.startedAt,
            submittedAt: inspections.submittedAt,
            completedAt: inspections.completedAt,
            archivedAt: inspections.archivedAt,
            createdBy: inspections.createdBy,
            updatedAt: inspections.updatedAt,
            sourceType: inspections.sourceType,
            sourceId: inspections.sourceId,
            templateName: templates.name,
            accessRuleId: templates.accessRuleId,
            conductedByName: user.name,
            siteName: sites.name,
            openActionsCount: sql<number>`(
              SELECT COUNT(*)::int FROM actions a
              WHERE a.tenant_id = ${ctx.tenantId}
                AND a.source_type = 'inspection'
                AND a.source_id = ${inspections.id}
                AND a.status IN ('open', 'in_progress')
                AND a.archived_at IS NULL
            )`,
          })
          .from(inspections)
          .leftJoin(templates, eq(templates.id, inspections.templateId))
          .leftJoin(user, eq(user.id, inspections.createdBy))
          .leftJoin(sites, eq(sites.id, inspections.siteId))
          .where(and(...where))
          .orderBy(desc(inspections.startedAt));

        // Non-managers only see inspections whose pinned template's access rule
        // they satisfy — extends the B3 template-content gate to the instances.
        // Managers (inspections.manage) bypass, matching templates.list.
        if (ctx.permissions.includes('inspections.manage')) return rows;
        const ruleIds = [
          ...new Set(rows.map((r) => r.accessRuleId).filter((id): id is string => id !== null)),
        ];
        if (ruleIds.length === 0) return rows;
        const rules = await ctx.db
          .select()
          .from(accessRules)
          .where(and(eq(accessRules.tenantId, ctx.tenantId), inArray(accessRules.id, ruleIds)));
        const ruleMap = new Map(rules.map((r) => [r.id, r]));
        const snap = await loadCallerAccessSnapshot(ctx.db, ctx.tenantId, ctx.auth.userId);
        return rows.filter((r) => {
          if (r.accessRuleId === null) return true;
          const rule = ruleMap.get(r.accessRuleId);
          if (rule === undefined) return false;
          return resolveAccessRule(
            {
              id: rule.id,
              groupIds: rule.groupIds,
              siteIds: rule.siteIds,
              invalidatedAt: rule.invalidatedAt,
            },
            snap,
          );
        });
      }),

    get: tenantProcedure
      .use(requirePermission('inspections.view'))
      .input(getInput)
      .query(async ({ ctx, input }) => {
        const insp = await loadInspectionForCallerOrThrow(ctx, input.inspectionId);

        // External contractor portal users may only read inspections authored
        // within their own contractor. Hidden as NOT_FOUND (indistinguishable
        // from a non-existent id).
        const getScope = await loadContractorScope(ctx.db, ctx.tenantId, ctx.auth.userId);
        if (getScope !== null && !getScope.userIds.includes(insp.createdBy)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }

        // Non-managers may only read an inspection whose template's access rule
        // they satisfy (extends the B3 template-content gate to instances).
        // Managers (inspections.manage) bypass, matching templates.get.
        if (!ctx.permissions.includes('inspections.manage')) {
          const tplRows = await ctx.db
            .select({ accessRuleId: templates.accessRuleId })
            .from(templates)
            .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, insp.templateId)))
            .limit(1);
          const accessRuleId = tplRows[0]?.accessRuleId ?? null;
          if (
            accessRuleId !== null &&
            !(await callerSatisfiesAccessRule(ctx.db, ctx.tenantId, ctx.auth.userId, accessRuleId))
          ) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'You do not satisfy this template’s access rule',
            });
          }
        }

        const versionRows = await ctx.db
          .select()
          .from(templateVersions)
          .where(eq(templateVersions.id, insp.templateVersionId))
          .limit(1);
        const version = versionRows[0];
        if (version === undefined) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Pinned version missing' });
        }

        const sigs = await ctx.db
          .select()
          .from(inspectionSignatures)
          .where(
            and(
              eq(inspectionSignatures.tenantId, ctx.tenantId),
              eq(inspectionSignatures.inspectionId, insp.id),
            ),
          )
          .orderBy(inspectionSignatures.slotIndex);

        const approvalRows = await ctx.db
          .select({
            id: inspectionApprovals.id,
            tenantId: inspectionApprovals.tenantId,
            inspectionId: inspectionApprovals.inspectionId,
            approverUserId: inspectionApprovals.approverUserId,
            decision: inspectionApprovals.decision,
            comment: inspectionApprovals.comment,
            decidedAt: inspectionApprovals.decidedAt,
            createdAt: inspectionApprovals.createdAt,
            approverNameRaw: user.name,
            approverFirstName: user.firstName,
            approverLastName: user.lastName,
          })
          .from(inspectionApprovals)
          .leftJoin(user, eq(user.id, inspectionApprovals.approverUserId))
          .where(
            and(
              eq(inspectionApprovals.tenantId, ctx.tenantId),
              eq(inspectionApprovals.inspectionId, insp.id),
            ),
          )
          .orderBy(inspectionApprovals.decidedAt);
        // Resolve each approver's display name (first+last, else the `name`
        // column) so the status / report pages show a person, not a raw ULID.
        // Falls back to null when the user row is gone; the UI renders the id.
        const approvals = approvalRows.map(
          ({ approverNameRaw, approverFirstName, approverLastName, ...row }) => ({
            ...row,
            approverName:
              approverFirstName !== null && approverLastName !== null
                ? `${approverFirstName} ${approverLastName}`
                : approverNameRaw,
          }),
        );

        const workflowSignerRows = await ctx.db
          .select({
            id: inspectionWorkflowSigners.id,
            tenantId: inspectionWorkflowSigners.tenantId,
            inspectionId: inspectionWorkflowSigners.inspectionId,
            position: inspectionWorkflowSigners.position,
            signerUserId: inspectionWorkflowSigners.signerUserId,
            status: inspectionWorkflowSigners.status,
            signedAt: inspectionWorkflowSigners.signedAt,
            signatureData: inspectionWorkflowSigners.signatureData,
            comment: inspectionWorkflowSigners.comment,
            createdAt: inspectionWorkflowSigners.createdAt,
            signerNameRaw: user.name,
            signerFirstName: user.firstName,
            signerLastName: user.lastName,
          })
          .from(inspectionWorkflowSigners)
          .leftJoin(user, eq(user.id, inspectionWorkflowSigners.signerUserId))
          .where(
            and(
              eq(inspectionWorkflowSigners.tenantId, ctx.tenantId),
              eq(inspectionWorkflowSigners.inspectionId, insp.id),
            ),
          )
          .orderBy(asc(inspectionWorkflowSigners.position));
        const workflowSigners = workflowSignerRows.map(
          ({ signerNameRaw, signerFirstName, signerLastName, ...row }) => ({
            ...row,
            signerName:
              signerFirstName !== null && signerLastName !== null
                ? `${signerFirstName} ${signerLastName}`
                : signerNameRaw,
          }),
        );

        // Whether the caller may sign the workflow *right now*. Mirrors the
        // turn rules enforced in `signWorkflow` (sequential = lowest pending;
        // parallel = any pending) so the status page can render the pad
        // without re-deriving the rules client-side. `viewerSignerName`
        // pre-fills the pad for the calling signer.
        const workflow = version.content.settings.signatureWorkflow;
        const viewerRow = workflowSigners.find((r) => r.signerUserId === ctx.auth.userId);
        const viewerSignerName = viewerRow?.signerName ?? null;
        let viewerCanSignWorkflow = false;
        if (
          insp.status === 'awaiting_signature_workflow' &&
          workflow?.enabled === true &&
          viewerRow !== undefined &&
          viewerRow.status === 'pending'
        ) {
          if (workflow.mode === 'sequential') {
            const lowestPending = workflowSigners.find((r) => r.status === 'pending');
            viewerCanSignWorkflow = lowestPending?.id === viewerRow.id;
          } else {
            viewerCanSignWorkflow = true;
          }
        }

        // Resolve names for the report's title page (site, conducted-by).
        const [siteRow] =
          insp.siteId !== null
            ? await ctx.db
                .select({ name: sites.name })
                .from(sites)
                .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, insp.siteId)))
                .limit(1)
            : [];
        // Fall back to whoever created the run when `conductedBy` is
        // null. A row without it is not a row without an author — the
        // conduct screen shows a name (it has the creator to hand) while
        // the finished report printed "Prepared by —", which is the one
        // field on an inspection report that has to be filled in for the
        // document to be worth anything.
        const conductorId = insp.conductedBy ?? insp.createdBy;
        const [conductedByRow] =
          conductorId !== null
            ? await ctx.db
                .select({ name: user.name })
                .from(user)
                .where(eq(user.id, conductorId))
                .limit(1)
            : [];

        return {
          inspection: {
            ...insp,
            siteName: siteRow?.name ?? null,
            conductedByName: conductedByRow?.name ?? null,
          },
          version,
          signatures: sigs,
          approvals,
          workflowSigners,
          viewerCanSignWorkflow,
          viewerSignerName,
        };
      }),

    create: tenantProcedure
      .use(requirePermission('inspections.conduct'))
      .input(createInput)
      .mutation(async ({ ctx, input }) => {
        // A referenced site must belong to this tenant (else `get` would leak
        // the foreign site's name on the report title page).
        await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
        // 1. Look up template — must exist, not be archived, be in current tenant.
        const tplRows = await ctx.db
          .select()
          .from(templates)
          .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, input.templateId)))
          .limit(1);
        const tpl = tplRows[0];
        if (tpl === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        if (tpl.archivedAt !== null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot start an inspection on an archived template',
          });
        }

        // 2. Access-rule gate. If the template has a rule, the caller must satisfy it.
        if (tpl.accessRuleId !== null) {
          const ruleRows = await ctx.db
            .select()
            .from(accessRules)
            .where(
              and(eq(accessRules.tenantId, ctx.tenantId), eq(accessRules.id, tpl.accessRuleId)),
            )
            .limit(1);
          const rule = ruleRows[0];
          if (rule === undefined) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Template references a missing access rule',
            });
          }
          // Load the caller's groups + sites for the rule check.
          const groupRows = await ctx.db
            .select({ groupId: groupMembers.groupId })
            .from(groupMembers)
            .where(
              and(
                eq(groupMembers.tenantId, ctx.tenantId),
                eq(groupMembers.userId, ctx.auth.userId),
              ),
            );
          const siteRows = await ctx.db
            .select({ siteId: siteMembers.siteId })
            .from(siteMembers)
            .where(
              and(eq(siteMembers.tenantId, ctx.tenantId), eq(siteMembers.userId, ctx.auth.userId)),
            );
          const allowed = resolveAccessRule(
            {
              id: rule.id,
              groupIds: rule.groupIds,
              siteIds: rule.siteIds,
              invalidatedAt: rule.invalidatedAt,
            },
            {
              groupIds: groupRows.map((r) => r.groupId),
              siteIds: siteRows.map((r) => r.siteId),
            },
          );
          if (!allowed) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'You do not satisfy this template’s access rule',
            });
          }
        }

        // 3. Find the currently-published version. No published → can't conduct.
        const currentVersionId = tpl.currentVersionId;
        if (currentVersionId === null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Template has no published version',
          });
        }
        const versionRows = await ctx.db
          .select()
          .from(templateVersions)
          .where(eq(templateVersions.id, currentVersionId))
          .limit(1);
        const version = versionRows[0];
        if (version === undefined) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Current template version missing',
          });
        }

        // 4. Build the access snapshot (ADR 0007).
        const accessSnapshot = await loadAccessSnapshot(ctx.db, ctx.tenantId, ctx.auth.userId);

        // 5. Increment document-number counter + render title / doc number.
        const inspectionId = newId();
        const now = new Date();
        const settings = version.content.settings;

        const inserted = await ctx.db.transaction(async (tx) => {
          // Atomic increment: `SET counter = counter + 1 … RETURNING` runs under
          // the row lock, so two concurrent starts serialize and receive
          // distinct numbers. A JS literal (`tpl.documentNumberCounter + 1`)
          // from the pre-tx read would let both writers stamp the same number.
          const counterRows = await tx
            .update(templates)
            .set({
              documentNumberCounter: sql`${templates.documentNumberCounter} + 1`,
              updatedAt: now,
            })
            .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, tpl.id)))
            .returning({ counter: templates.documentNumberCounter });
          const counter = counterRows[0]?.counter ?? tpl.documentNumberCounter + 1;
          const documentNumber = renderDocumentNumber(settings.documentNumberFormat, counter);
          const title = renderTitle(tpl.titleFormat, {
            date: now,
            site: input.siteId,
            conductedBy: ctx.auth.userId,
            documentNumber,
          });

          await tx.insert(inspections).values({
            id: inspectionId,
            tenantId: ctx.tenantId,
            templateId: tpl.id,
            templateVersionId: version.id,
            status: 'in_progress',
            title,
            documentNumber,
            conductedBy: ctx.auth.userId,
            siteId: input.siteId ?? null,
            sourceType: input.sourceIssueId !== undefined ? 'issue' : null,
            sourceId: input.sourceIssueId ?? null,
            responses: {},
            score: null,
            accessSnapshot,
            startedAt: now,
            createdBy: ctx.auth.userId,
            createdAt: now,
            updatedAt: now,
          });
          return { inspectionId, title, documentNumber };
        });

        // PF-3: starting from a scheduled occurrence links the two and
        // flips the occurrence to in_progress — the scheduler can finally
        // tell done from missed. Tenant + assignee checked; a foreign or
        // already-linked occurrence is ignored rather than failing the
        // freshly-created inspection.
        if (input.occurrenceId !== undefined) {
          await ctx.db
            .update(scheduledInspectionOccurrences)
            .set({ status: 'in_progress', inspectionId: inserted.inspectionId })
            .where(
              and(
                eq(scheduledInspectionOccurrences.tenantId, ctx.tenantId),
                eq(scheduledInspectionOccurrences.id, input.occurrenceId),
                inArray(scheduledInspectionOccurrences.status, ['pending', 'missed']),
              ),
            );
        }

        ctx.logger.info(
          { inspectionId: inserted.inspectionId, templateId: tpl.id },
          '[inspections] created',
        );
        return { inspectionId: inserted.inspectionId };
      }),

    saveProgress: tenantProcedure
      .use(requirePermission('inspections.conduct'))
      .input(saveProgressInput)
      .mutation(async ({ ctx, input }) => {
        // IS-S03: this resolved by tenant + id, so a portal contractor —
        // whose activity grants `inspections.conduct` tenant-wide — could
        // overwrite the answers on another company's walk-round, the
        // evidential record a regulator may read.
        const insp = await loadInspectionForCallerOrThrow(ctx, input.inspectionId);
        if (insp.status !== 'in_progress') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only in-progress inspections can be updated',
          });
        }
        if (input.expectedUpdatedAt !== undefined) {
          const expected = new Date(input.expectedUpdatedAt).getTime();
          const current = insp.updatedAt.getTime();
          if (current !== expected) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Inspection was modified elsewhere. Refresh before saving.',
              cause: {
                code: 'CONFLICT',
                serverUpdatedAt: insp.updatedAt.toISOString(),
              },
            });
          }
        }
        const now = new Date();
        await ctx.db
          .update(inspections)
          .set({ responses: input.responses, updatedAt: now })
          .where(eq(inspections.id, insp.id));

        // Sync asset-selection link rows for 'asset'-type questions.
        await syncAssetSelections(
          ctx.db,
          ctx.tenantId,
          insp.id,
          insp.templateVersionId,
          input.responses,
        );
        // Mirror the "Site conducted" answer into inspection.siteId (bug B4).
        await syncConductedSite(
          ctx.db,
          ctx.tenantId,
          insp.id,
          insp.templateVersionId,
          input.responses,
        );

        return { updatedAt: now.toISOString() };
      }),

    submit: tenantProcedure
      .use(requirePermission('inspections.conduct'))
      .input(submitInput)
      .mutation(async ({ ctx, input }) => {
        // IS-S03 sibling, found by the parity guard rather than the audit:
        // `submit` is gated on `inspections.conduct`, which the contractor
        // activity grants tenant-wide — so a portal user could submit
        // another company's walk-round for approval.
        const insp = await loadInspectionForCallerOrThrow(ctx, input.inspectionId);
        if (insp.status !== 'in_progress') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only in-progress inspections can be submitted',
          });
        }

        // Introspect the pinned version to decide the next status.
        const versionRows = await ctx.db
          .select()
          .from(templateVersions)
          .where(eq(templateVersions.id, insp.templateVersionId))
          .limit(1);
        const version = versionRows[0];
        if (version === undefined) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Pinned version missing' });
        }

        // ── Response-option triggers (requireEvidence / requireAction / notify) ──
        const responseMap = insp.responses as Record<string, unknown>;
        // requireEvidence is a hard gate on every submit path (defence in depth;
        // the conduct UI also disables submit until evidence is attached).
        const evMissing = missingEvidence(version.content, responseMap);
        if (evMissing.length > 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'evidence-required' });
        }
        // PF-25: requireNote is a promise too — a triggering option
        // demands an explanation before submit.
        const noteMissing = missingNotes(version.content, responseMap);
        if (noteMissing.length > 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'note-required' });
        }
        // Mirror the "Site conducted" answer into inspection.siteId before the
        // submit side-effects read it (bug B4). Belt-and-suspenders with the
        // per-change sync in saveProgress.
        const resolvedSiteId = await syncConductedSite(
          ctx.db,
          ctx.tenantId,
          insp.id,
          insp.templateVersionId,
          responseMap,
        );
        // Side-effects fire once on submit (responses are final after this).
        for (const active of collectActiveTriggers(version.content, responseMap)) {
          if (active.trigger.kind === 'requireAction') {
            await createInspectionActionIfAbsent(ctx.db, {
              tenantId: ctx.tenantId,
              inspectionId: insp.id,
              sourceItemId: active.itemId,
              title: active.trigger.actionTitle,
              siteId: resolvedSiteId,
              createdBy: ctx.auth.userId,
            });
          } else if (active.trigger.kind === 'notify' && active.trigger.email !== undefined) {
            try {
              await deps.sendEmail({
                to: active.trigger.email,
                templateKey: 'inspection-notify',
                variables: {
                  inspectionTitle: insp.title,
                  questionPrompt: active.prompt,
                  response: active.optionLabel,
                  // DOC-A01: a notify trigger emails an address configured
                  // on the template — there is no account and no locale, so
                  // the app default is the only honest answer.
                  viewUrl: appLink(appUrl, null, `/inspections/${insp.id}/report`),
                },
              });
            } catch (err) {
              deps.logger.error(
                { err, inspectionId: insp.id, itemId: active.itemId },
                '[inspections] notify email failed',
              );
            }
          }
        }

        const workflow: SignatureWorkflow | undefined = version.content.settings.signatureWorkflow;
        const workflowEnabled =
          workflow !== undefined && workflow.enabled && workflow.signatoryUserIds.length > 0;

        // Workflow takes precedence: it's the post-submission review gate.
        // Item-level signature slots / approval page are evaluated only when
        // the workflow is not in play.
        if (workflowEnabled && workflow !== undefined) {
          const now = new Date();
          await ctx.db.transaction(async (tx) => {
            await tx
              .update(inspections)
              .set({
                status: 'awaiting_signature_workflow',
                submittedAt: now,
                updatedAt: now,
              })
              .where(eq(inspections.id, insp.id));
            const rowsToInsert = workflow.signatoryUserIds.map((signerUserId, idx) => ({
              id: newId(),
              tenantId: ctx.tenantId,
              inspectionId: insp.id,
              position: idx,
              signerUserId,
              status: 'pending' as const,
            }));
            if (rowsToInsert.length > 0) {
              await tx.insert(inspectionWorkflowSigners).values(rowsToInsert);
            }
          });

          // Outside the tx, fire emails.
          const recipients =
            workflow.mode === 'sequential'
              ? workflow.signatoryUserIds.slice(0, 1)
              : workflow.signatoryUserIds;
          for (const signerUserId of recipients) {
            await sendSignatureRequestEmail({
              db: ctx.db,
              tenantId: ctx.tenantId,
              inspectionId: insp.id,
              inspectionTitle: insp.title,
              requesterUserId: ctx.auth.userId,
              signerUserId,
            });
          }
          return { status: 'awaiting_signature_workflow' as const };
        }

        const hasSignatureSlots = version.content.pages.some((p) =>
          p.sections.some((s) => s.items.some((i) => i.type === 'signature')),
        );
        const hasApprovalPage = version.content.settings.approvalPage !== undefined;

        const now = new Date();
        const nextStatus = hasSignatureSlots
          ? ('awaiting_signatures' as const)
          : hasApprovalPage
            ? ('awaiting_approval' as const)
            : ('completed' as const);

        await ctx.db
          .update(inspections)
          .set({
            status: nextStatus,
            submittedAt: now,
            completedAt: nextStatus === 'completed' ? now : null,
            updatedAt: now,
          })
          .where(eq(inspections.id, insp.id));
        // PF-3: the linked occurrence completes when the work is
        // submitted — the scheduler's question is "was it done", not
        // "has the sign-off chain finished".
        await ctx.db
          .update(scheduledInspectionOccurrences)
          .set({ status: 'completed' })
          .where(
            and(
              eq(scheduledInspectionOccurrences.tenantId, ctx.tenantId),
              eq(scheduledInspectionOccurrences.inspectionId, insp.id),
            ),
          );
        // PF-30: an approval gate nobody is told about is ceremonial —
        // every inspections.manage holder learns work is waiting.
        if (nextStatus === 'awaiting_approval') {
          try {
            const approvers = await usersHoldingPermission(
              ctx.db,
              ctx.tenantId,
              'inspections.manage',
            );
            for (const approver of approvers) {
              if (approver.userId === ctx.auth.userId || approver.email.length === 0) continue;
              // PF-23: the in-app bell mirrors the email.
              await notifyInApp(ctx.db, {
                tenantId: ctx.tenantId,
                userId: approver.userId,
                kind: 'approval_pending',
                title: insp.title,
                body: insp.documentNumber ?? '',
                href: `/approvals/${insp.id}`,
              });
              await deps.sendEmail({
                to: approver.email,
                locale: approver.locale ?? undefined,
                templateKey: 'inspection-approval-pending',
                variables: {
                  recipientName: approver.name,
                  title: insp.title,
                  documentNumber: insp.documentNumber ?? '',
                  viewUrl: appLink(deps.appUrl, approver.locale, `/approvals/${insp.id}`),
                },
              });
            }
          } catch (err) {
            ctx.logger.warn(
              { inspectionId: insp.id, err: err instanceof Error ? err.message : String(err) },
              '[inspections] approval-pending email failed',
            );
          }
        }
        return { status: nextStatus };
      }),

    /**
     * Workflow signer signs off. Caller must be the current pending signer:
     *   - Sequential: the lowest-position pending signer.
     *   - Parallel: any pending signer for this inspection.
     * If this sign brings every signer to `signed`, the inspection flips
     * to `completed` and (optionally) completion emails fan out. Otherwise
     * in sequential mode the next signer is notified.
     */
    signWorkflow: tenantProcedure.input(signWorkflowInput).mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(inspections)
        .where(and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, input.inspectionId)))
        .limit(1);
      const insp = rows[0];
      if (insp === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (insp.status !== 'awaiting_signature_workflow') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Inspection is not awaiting workflow signatures',
        });
      }

      const versionRows = await ctx.db
        .select()
        .from(templateVersions)
        .where(eq(templateVersions.id, insp.templateVersionId))
        .limit(1);
      const version = versionRows[0];
      if (version === undefined) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Pinned version missing' });
      }
      const workflow: SignatureWorkflow | undefined = version.content.settings.signatureWorkflow;
      if (workflow === undefined) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Inspection in workflow state but template has no workflow',
        });
      }

      const signerRows = await ctx.db
        .select()
        .from(inspectionWorkflowSigners)
        .where(
          and(
            eq(inspectionWorkflowSigners.tenantId, ctx.tenantId),
            eq(inspectionWorkflowSigners.inspectionId, insp.id),
          ),
        )
        .orderBy(asc(inspectionWorkflowSigners.position));

      const myRow = signerRows.find((r) => r.signerUserId === ctx.auth.userId);
      if (myRow === undefined) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not a signatory on this inspection',
        });
      }
      if (myRow.status !== 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You have already signed this inspection',
        });
      }
      if (workflow.mode === 'sequential') {
        const lowestPending = signerRows.find((r) => r.status === 'pending');
        if (lowestPending === undefined || lowestPending.id !== myRow.id) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'It is not your turn to sign',
          });
        }
      }

      const now = new Date();
      const allSignedAfter = signerRows.every((r) =>
        r.id === myRow.id ? true : r.status === 'signed',
      );

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(inspectionWorkflowSigners)
          .set({
            status: 'signed',
            signedAt: now,
            signatureData: input.signatureData,
            comment: input.comment ?? null,
          })
          .where(eq(inspectionWorkflowSigners.id, myRow.id));

        if (allSignedAfter) {
          await tx
            .update(inspections)
            .set({
              status: 'completed',
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(inspections.id, insp.id));
        } else {
          await tx.update(inspections).set({ updatedAt: now }).where(eq(inspections.id, insp.id));
        }
      });

      if (allSignedAfter) {
        if (workflow.notifyOnCompletion) {
          await sendCompletionEmails({
            db: ctx.db,
            tenantId: ctx.tenantId,
            inspectionId: insp.id,
            inspectionTitle: insp.title,
            recipientUserIds: workflow.signatoryUserIds,
          });
        }
        return { status: 'completed' as const, allSigned: true };
      }

      if (workflow.mode === 'sequential') {
        // Find the next pending signer (post-update) and notify them.
        const nextPending = signerRows
          .filter((r) => r.id !== myRow.id && r.status === 'pending')
          .sort((a, b) => a.position - b.position)[0];
        if (nextPending !== undefined) {
          await sendSignatureRequestEmail({
            db: ctx.db,
            tenantId: ctx.tenantId,
            inspectionId: insp.id,
            inspectionTitle: insp.title,
            // Forward the original requester (inspection creator) so the
            // email phrasing stays consistent across the chain.
            requesterUserId: insp.createdBy,
            signerUserId: nextPending.signerUserId,
          });
        }
      }
      return { status: 'awaiting_signature_workflow' as const, allSigned: false };
    }),

    /**
     * List inspections that the caller is currently expected to sign.
     *
     *   - Sequential: the caller's row must be the lowest-position pending
     *     signer (i.e. it's their turn now).
     *   - Parallel: any pending row keyed to the caller.
     */
    listAwaitingMySignature: tenantProcedure.query(async ({ ctx }) => {
      const myPending = await ctx.db
        .select({
          rowId: inspectionWorkflowSigners.id,
          inspectionId: inspectionWorkflowSigners.inspectionId,
          position: inspectionWorkflowSigners.position,
          title: inspections.title,
          submittedAt: inspections.submittedAt,
          createdBy: inspections.createdBy,
          status: inspections.status,
          templateVersionId: inspections.templateVersionId,
        })
        .from(inspectionWorkflowSigners)
        .innerJoin(inspections, eq(inspectionWorkflowSigners.inspectionId, inspections.id))
        .where(
          and(
            eq(inspectionWorkflowSigners.tenantId, ctx.tenantId),
            eq(inspectionWorkflowSigners.signerUserId, ctx.auth.userId),
            eq(inspectionWorkflowSigners.status, 'pending'),
            eq(inspections.status, 'awaiting_signature_workflow'),
          ),
        )
        .orderBy(desc(inspections.submittedAt));

      // For each row, fetch all signer rows so we can resolve the mode
      // and (for sequential) determine if it's actually this user's turn.
      const out: {
        inspectionId: string;
        title: string;
        requesterName: string;
        tenantId: string;
        mode: 'sequential' | 'parallel';
        position: number;
        submittedAt: Date | null;
      }[] = [];
      for (const row of myPending) {
        const versionRows = await ctx.db
          .select({ content: templateVersions.content })
          .from(templateVersions)
          .where(eq(templateVersions.id, row.templateVersionId))
          .limit(1);
        const version = versionRows[0];
        const mode: 'sequential' | 'parallel' =
          version?.content.settings.signatureWorkflow?.mode ?? 'parallel';
        if (mode === 'sequential') {
          // Confirm the caller is the lowest pending position.
          const allSigners = await ctx.db
            .select()
            .from(inspectionWorkflowSigners)
            .where(
              and(
                eq(inspectionWorkflowSigners.tenantId, ctx.tenantId),
                eq(inspectionWorkflowSigners.inspectionId, row.inspectionId),
              ),
            )
            .orderBy(asc(inspectionWorkflowSigners.position));
          const lowestPending = allSigners.find((s) => s.status === 'pending');
          if (lowestPending === undefined || lowestPending.signerUserId !== ctx.auth.userId) {
            continue;
          }
        }
        const requester = await userLabel(ctx.db, ctx.tenantId, row.createdBy);
        out.push({
          inspectionId: row.inspectionId,
          title: row.title,
          requesterName: requester.name,
          tenantId: ctx.tenantId,
          mode,
          position: row.position,
          submittedAt: row.submittedAt,
        });
      }
      return out;
    }),

    reject: tenantProcedure
      .use(requirePermission('inspections.manage'))
      .input(rejectInput)
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        const result = await ctx.db
          .update(inspections)
          .set({
            status: 'rejected',
            rejectedAt: now,
            rejectedReason: input.reason,
            updatedAt: now,
          })
          .where(
            and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, input.inspectionId)),
          )
          .returning({ id: inspections.id });
        if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
        return { ok: true as const };
      }),

    /**
     * Reopen a rejected inspection back to `in_progress` so the work can be
     * corrected and resubmitted. The captured `responses` are preserved; only
     * the rejection-terminal columns (`rejectedAt`, `rejectedReason`) are
     * cleared. Authorised for the original conductor (recovering their own
     * work) OR any manager (`inspections.manage` — the same key that gates
     * `reject`). The `inspections.view` floor matches the status page that
     * hosts the button (it already requires `view` to render). Any status
     * other than `rejected` is a BAD_REQUEST.
     */
    reopen: tenantProcedure
      .use(requirePermission('inspections.view'))
      .input(reopenInput)
      .mutation(async ({ ctx, input }) => {
        // Reachable by a portal contractor: `reopen` is gated on
        // `inspections.view`, which the contractor activity grants
        // tenant-wide. Reopening another company's rejected inspection
        // moves an evidential record back into play.
        const insp = await loadInspectionForCallerOrThrow(ctx, input.inspectionId);
        if (insp.status !== 'rejected') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only rejected inspections can be reopened',
          });
        }
        const isConductor = insp.conductedBy === ctx.auth.userId;
        const isManager = ctx.permissions.includes('inspections.manage');
        if (!isConductor && !isManager) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only the conductor or a manager can reopen this inspection',
          });
        }
        const now = new Date();
        await ctx.db
          .update(inspections)
          .set({
            status: 'in_progress',
            rejectedAt: null,
            rejectedReason: null,
            updatedAt: now,
          })
          .where(eq(inspections.id, insp.id));
        return { status: 'in_progress' as const };
      }),

    delete: tenantProcedure
      .use(requirePermission('inspections.manage'))
      .input(deleteInput)
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.db
          .delete(inspections)
          .where(
            and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, input.inspectionId)),
          )
          .returning({ id: inspections.id });
        if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
        return { ok: true as const };
      }),

    /** Attach (or detach) an existing inspection to a site/project. */
    setSite: tenantProcedure
      .use(requirePermission('inspections.manage'))
      .input(
        z.object({
          inspectionId: z.string().length(26),
          siteId: z.string().length(26).nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Same guard as create — the target site must belong to this tenant.
        if (input.siteId !== null) {
          await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
        }
        const result = await ctx.db
          .update(inspections)
          .set({ siteId: input.siteId, updatedAt: new Date() })
          .where(
            and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, input.inspectionId)),
          )
          .returning({ id: inspections.id });
        if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
        return { ok: true as const };
      }),
  });
}
