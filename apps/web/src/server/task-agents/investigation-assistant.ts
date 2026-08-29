/**
 * investigation-assistant — drafts an incident investigation (FreeHS
 * module B5) for one existing incident: chronology, causes (five whys or
 * HSG245 causal factors), conclusion and findings, built strictly from
 * the evidence already on file. Apply (client-side,
 * `incidents/[incidentId]/investigation/page.tsx`) maps the proposal
 * onto the module's ordinary mutations — `incidents.saveInvestigation`
 * with only the proposal-present keys, then `incidents.addFinding` per
 * finding — so every tenant/permission/authority check runs as the
 * signed-in user. `startInvestigation`, `submitInvestigation` and the
 * approval mutations are never touched: a revision is opened by the
 * human's existing button, and submission/approval stay separated-duty
 * signed acts (ADR 0013).
 *
 * Caps mirror `saveInvestigationInput` / `findingInput` in
 * packages/api/src/routers/incidents.ts exactly — `whyChainSchema`,
 * `causalFactorsSchema` and `timelineEntriesSchema` are IMPORTED from
 * `@forma360/shared/incidents` rather than restated, so the single-root-
 * cause-last superRefine can never drift (the DH-E21 coupling
 * discipline — if those inputs change, change this schema in the same
 * PR). `suggestedOwnerNote` / `suggestedTimescaleNote` on findings are
 * PREVIEW-ONLY and never written: per IN-A6 the approver sets each
 * finding's assignee and due date at approval.
 *
 * Confidentiality: the context builder re-enforces the module's own
 * `canViewConfidential` rule (reporter ∨ lead investigator ∨
 * `incidents.confidential.view` ∨ administrator) and returns '' rather
 * than serialising a confidential record the caller may only count —
 * the trigger only mounts after `incidents.get` succeeded, so this is
 * defence in depth against a hand-crafted request.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  actions,
  incidentAbsences,
  incidentEvents,
  incidentEvidence,
  incidentFindings,
  incidentInvestigations,
  incidentPersons,
  incidentWitnessStatements,
  incidents,
  sites,
  user,
} from '@forma360/db/schema';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import {
  CAUSAL_FACTOR_CATEGORIES,
  FINDING_PRIORITIES,
  RCA_METHODS,
  RECURRENCE_LIKELIHOODS,
  causalFactorsSchema,
  timelineEntriesSchema,
  totalDaysLost,
  whyChainSchema,
} from '@forma360/shared/incidents';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { activeBrand } from '../../lib/brand';
import type { TaskAgentServerDef } from './index';

/** ~8k tokens of serialised context; truncate lists before exceeding it. */
const MAX_CONTEXT_CHARS = 30_000;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…truncated` : value;
}

const findingSchema = z.object({
  category: z.enum(CAUSAL_FACTOR_CATEGORIES),
  priority: z.enum(FINDING_PRIORITIES).default('medium'),
  description: z.string().trim().min(1).max(2000),
  requiresAction: z.boolean().default(true),
  /** Advisory only — the approver sets the assignee at approval (IN-A6). */
  suggestedOwnerNote: z.string().max(200).optional(),
  /** Advisory only — the approver sets the due date at approval (IN-A6). */
  suggestedTimescaleNote: z.string().max(100).optional(),
});

const proposalSchema = z
  .object({
    /** Plain-English decision summary — every agent proposal carries one. */
    summary: z.string().min(1).max(2000),
    method: z.enum(RCA_METHODS),
    immediateCause: z.string().trim().min(1).max(5000).optional(),
    underlyingCause: z.string().trim().min(1).max(5000).optional(),
    contributingFactors: z.array(z.enum(CAUSAL_FACTOR_CATEGORIES)).max(8).optional(),
    // Imported schemas — 2..7 whys, at most one root cause and only the
    // last entry; 1..20 factors — byte-for-byte the router's own gates.
    whyChain: whyChainSchema.optional(),
    causalFactors: causalFactorsSchema.optional(),
    timelineEntries: timelineEntriesSchema.optional(),
    conclusionSummary: z.string().trim().min(1).max(10_000).optional(),
    rootCauseStatement: z.string().trim().min(1).max(5000).optional(),
    recurrenceLikelihood: z.enum(RECURRENCE_LIKELIHOODS).nullable().optional(),
    lessonsLearned: z.string().trim().min(1).max(10_000).optional(),
    findings: z.array(findingSchema).max(10).default([]),
  })
  .superRefine((p, ctx) => {
    if (p.whyChain !== undefined && p.method !== 'five_whys') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'whyChain is only allowed when method is "five_whys"',
      });
    }
    if (p.causalFactors !== undefined && p.method !== 'causal_factors') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'causalFactors is only allowed when method is "causal_factors"',
      });
    }
  });

export type InvestigationAssistantProposal = z.infer<typeof proposalSchema>;

const proposeTool: Anthropic.Tool = {
  name: 'proposeInvestigation',
  description:
    'Propose a DRAFT incident investigation — chronology, causes and findings — built only from the incident file in the context. Call this in the same turn you decide to draft. The lead investigator reviews and edits everything in the workspace; nothing is submitted, approved or signed by this call.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          '2-4 plain-English sentences a non-technical manager reads to decide whether to apply: what was drafted, the key assumptions made, and what to double-check against the evidence. Required.',
      },
      method: {
        type: 'string',
        enum: [...RCA_METHODS],
        description:
          'Root-cause method: five_whys for a single clear chain, causal_factors for multi-factor events, other when neither fits.',
      },
      immediateCause: { type: 'string', description: 'Immediate cause. Max 5000 chars.' },
      underlyingCause: { type: 'string', description: 'Underlying cause. Max 5000 chars.' },
      contributingFactors: {
        type: 'array',
        maxItems: 8,
        items: { type: 'string', enum: [...CAUSAL_FACTOR_CATEGORIES] },
        description: 'HSG245 causal-factor families that contributed.',
      },
      whyChain: {
        type: 'array',
        minItems: 2,
        maxItems: 7,
        description:
          'Only when method is five_whys. 2-7 ordered whys; mark at most ONE entry isRootCause and only the final one.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Max 1000 chars.' },
            isRootCause: { type: 'boolean' },
          },
          required: ['text'],
        },
      },
      causalFactors: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        description: 'Only when method is causal_factors.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: [...CAUSAL_FACTOR_CATEGORIES] },
            narrative: { type: 'string', description: 'Max 2000 chars.' },
          },
          required: ['category', 'narrative'],
        },
      },
      timelineEntries: {
        type: 'array',
        maxItems: 50,
        description:
          'Chronology from the event log, witness statements and the reported description, each entry anchored to its source. "at" is free text exactly as evidenced — do not invent precision.',
        items: {
          type: 'object',
          properties: {
            at: { type: 'string', description: 'When, as free text. Max 100 chars.' },
            text: { type: 'string', description: 'What happened. Max 1000 chars.' },
          },
          required: ['at', 'text'],
        },
      },
      conclusionSummary: {
        type: 'string',
        description:
          'Conclusion. Include an "Open questions" paragraph when the evidence has gaps. Max 10000 chars.',
      },
      rootCauseStatement: {
        type: 'string',
        description: 'A clear one-paragraph root-cause statement. Max 5000 chars.',
      },
      recurrenceLikelihood: { type: 'string', enum: [...RECURRENCE_LIKELIHOODS] },
      lessonsLearned: { type: 'string', description: 'Lessons learned. Max 10000 chars.' },
      findings: {
        type: 'array',
        maxItems: 10,
        description:
          'Focused findings. Do NOT re-propose findings that already exist in the context.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: [...CAUSAL_FACTOR_CATEGORIES] },
            priority: { type: 'string', enum: [...FINDING_PRIORITIES] },
            description: { type: 'string', description: 'Max 2000 chars.' },
            requiresAction: {
              type: 'boolean',
              description: 'True unless the finding is purely observational.',
            },
            suggestedOwnerNote: {
              type: 'string',
              description:
                'Suggestion only (a role, not a name where possible) — the approver formally sets the assignee at approval. Max 200 chars.',
            },
            suggestedTimescaleNote: {
              type: 'string',
              description:
                'Suggestion only — the approver formally sets the due date at approval. Max 100 chars.',
            },
          },
          required: ['category', 'description'],
        },
      },
    },
    required: ['summary', 'method'],
  },
};

const BASE_PROMPT = `You are an experienced incident-investigation assistant for ${activeBrand.name}, helping a competent person draft a workplace incident investigation. You write in British English using UK HSE terminology (immediate cause, underlying cause, root cause, HSG245 causal-factor families, RIDDOR where relevant).

You are given the incident file as CONTEXT: the incident record, people involved and their injuries, absence records, the event log, witness statements, evidence items, any existing investigation content and findings, and linked actions. You may also be given organisation-specific guidance under COMPANY KNOWLEDGE — follow it: it reflects this organisation's investigation procedure, terminology and standards, and it takes precedence over generic practice wherever they differ.

Your one job: produce a DRAFT investigation via the proposeInvestigation tool. You draft; a human investigates, edits, submits and approves. Never claim to have signed, submitted, approved, published or closed anything, and never present the draft as a finished or approved investigation. It is a starting point the lead investigator must verify against the evidence.

Ground rules:
1. Evidence only. Every statement of fact must be traceable to the incident file. Where the file is silent, say so — write "Not established from the evidence on file" or list it as an open question inside the conclusion summary. Never invent times, names, injuries, measurements or sequences. This draft feeds a statutory record; a plausible guess is worse than a gap.
2. No blame. Follow HSG245: describe conditions, systems and decisions, not personal fault. Refer to people by role where possible. Do not speculate about individuals' motives or competence beyond what statements say.
3. Chronology: build timeline entries from the event log, witness statements and the reported description, in order, each entry anchored to its source ("Witness J. states…", "Reported at…"). Use the times as given; do not convert or infer precision that is not there.
4. Causes: choose the root-cause method (respect the organisation's preferred practice from SETTINGS or COMPANY KNOWLEDGE if stated; otherwise pick what the evidence supports — five whys for a single clear chain, causal factors for multi-factor events). If using five whys, write 2-7 whys; mark at most ONE entry as the root cause and only the final one. If using causal factors, write 1-20 factors across the HSG245 categories. Fill immediate cause, underlying cause and a clear root-cause statement. For a basic-level investigation keep to immediate and underlying causes, contributing factors and the conclusion — method "other", no chain.
5. Findings: propose focused findings (category, priority, description, whether an action is required). Do NOT re-propose findings that already exist in the context. You may suggest an owner role and a timescale in the suggestedOwnerNote / suggestedTimescaleNote fields — these are suggestions only and are never written to the record; the approver formally sets each finding's assignee and due date at approval. Mention any such suggestions briefly in the summary so the reviewer sees them.
6. Existing draft content: if the open revision already has content, build on it rather than replacing it wholesale, and only include a field in your proposal when you have something better-evidenced to say — a field you omit leaves the investigator's own text untouched.

How to work: if the user's brief plus the incident file are enough to draft something useful, call proposeInvestigation straight away — IN THE SAME TURN, after at most one short sentence of preamble. Only when the brief is genuinely too thin to draft anything defensible may you ask AT MOST 2-3 short clarifying questions, together in ONE message, then draft on the reply. Never end a turn promising to draft without calling the tool. Every tool call MUST include a "summary" field: 2-4 plain-English sentences a non-technical manager reads to decide whether to apply — what was drafted, the key assumptions you made, and what they should double-check. Do not narrate the tool; propose, and let the reviewer refine.`;

export const investigationAssistant: TaskAgentServerDef = {
  agentId: 'investigation-assistant',

  basePrompt: BASE_PROMPT,

  proposeTool,

  parseProposal: (input: unknown) => proposalSchema.parse(input),

  settingsBlock: (settings) => {
    // Catalogue entry for investigation-assistant carries the shared
    // "detail" dial only; 'standard' (the default) adds no prompt line.
    const detail = settings['detail'];
    if (detail === 'concise') {
      return 'Draft detail: concise — a tight chronology of only the load-bearing events, the few best-evidenced causes, and only the most significant findings.';
    }
    if (detail === 'thorough') {
      return 'Draft detail: thorough — a full chronology, complete causal analysis with fuller narratives, and the full spread of defensible findings.';
    }
    return '';
  },

  /**
   * Mirrors the reads `incidents.get` already makes: the incident row,
   * persons + injuries + absences (with computed days lost), evidence
   * METADATA only (never file bytes), witness statements (signature data
   * excluded), the event log, the latest investigation revision and its
   * findings, and linked actions. Every query is tenant-scoped; a
   * missing/foreign incidentId yields '' rather than an error, and a
   * confidential incident the caller may not read yields '' too —
   * mirroring the router's `canViewConfidential` gate.
   */
  buildContext: async ({ db, tenantId, userId, params }) => {
    const incidentId = params['incidentId'];
    if (incidentId === undefined || incidentId.length !== 26) return '';

    const [incident] = await db
      .select()
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)))
      .limit(1);
    if (incident === undefined) return '';

    // Confidential gate — reporter ∨ lead investigator ∨
    // `incidents.confidential.view` ∨ administrator, exactly as the
    // router's canViewConfidential decides every read.
    if (
      incident.confidential &&
      incident.reportedByUserId !== userId &&
      incident.leadInvestigatorUserId !== userId
    ) {
      const perms = await loadUserPermissions(db, tenantId, userId);
      const allowed = grantsAdminAccess(perms) || perms.includes('incidents.confidential.view');
      if (!allowed) return '';
    }

    const [persons, absences, evidence, witnesses, events, investigationRows, linkedActions] =
      await Promise.all([
        db
          .select({
            id: incidentPersons.id,
            name: incidentPersons.name,
            category: incidentPersons.category,
            injury: incidentPersons.injury,
            ohFollowUpRequired: incidentPersons.ohFollowUpRequired,
            returnedToWork: incidentPersons.returnedToWork,
            onRestrictedDuties: incidentPersons.onRestrictedDuties,
          })
          .from(incidentPersons)
          .where(
            and(
              eq(incidentPersons.tenantId, tenantId),
              eq(incidentPersons.incidentId, incident.id),
            ),
          )
          .orderBy(asc(incidentPersons.createdAt))
          .limit(50),
        db
          .select({
            personId: incidentAbsences.personId,
            fromDate: incidentAbsences.fromDate,
            toDate: incidentAbsences.toDate,
          })
          .from(incidentAbsences)
          .where(
            and(
              eq(incidentAbsences.tenantId, tenantId),
              eq(incidentAbsences.incidentId, incident.id),
            ),
          )
          .orderBy(asc(incidentAbsences.fromDate))
          .limit(100),
        // Metadata only — never storage keys or file bytes.
        db
          .select({
            kind: incidentEvidence.kind,
            filename: incidentEvidence.filename,
            caption: incidentEvidence.caption,
            collectedByUserId: incidentEvidence.collectedByUserId,
            collectedAt: incidentEvidence.collectedAt,
          })
          .from(incidentEvidence)
          .where(
            and(
              eq(incidentEvidence.tenantId, tenantId),
              eq(incidentEvidence.incidentId, incident.id),
            ),
          )
          .orderBy(asc(incidentEvidence.createdAt))
          .limit(50),
        // signatureData deliberately not selected.
        db
          .select({
            witnessName: incidentWitnessStatements.witnessName,
            statement: incidentWitnessStatements.statement,
            takenByUserId: incidentWitnessStatements.takenByUserId,
            takenAt: incidentWitnessStatements.takenAt,
          })
          .from(incidentWitnessStatements)
          .where(
            and(
              eq(incidentWitnessStatements.tenantId, tenantId),
              eq(incidentWitnessStatements.incidentId, incident.id),
            ),
          )
          .orderBy(asc(incidentWitnessStatements.createdAt))
          .limit(20),
        db
          .select({
            kind: incidentEvents.kind,
            detail: incidentEvents.detail,
            actorUserId: incidentEvents.actorUserId,
            createdAt: incidentEvents.createdAt,
          })
          .from(incidentEvents)
          .where(
            and(eq(incidentEvents.tenantId, tenantId), eq(incidentEvents.incidentId, incident.id)),
          )
          .orderBy(desc(incidentEvents.createdAt))
          .limit(100),
        db
          .select()
          .from(incidentInvestigations)
          .where(
            and(
              eq(incidentInvestigations.tenantId, tenantId),
              eq(incidentInvestigations.incidentId, incident.id),
            ),
          )
          .orderBy(desc(incidentInvestigations.revision))
          .limit(1),
        db
          .select({
            referenceNumber: actions.referenceNumber,
            title: actions.title,
            status: actions.status,
            priority: actions.priority,
            dueAt: actions.dueAt,
          })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, tenantId),
              eq(actions.sourceType, 'incident'),
              eq(actions.sourceId, incident.id),
            ),
          )
          .orderBy(asc(actions.createdAt))
          .limit(50),
      ]);

    const latest = investigationRows[0] ?? null;

    // Visibility-circle gate (migration 0086) — the router's
    // `canViewInvestigation` mirrored: when the LATEST revision names a
    // circle, only its members, the lead investigator,
    // `incidents.confidential.view` holders and administrators may read
    // the thread. The whole context is investigation-centric, so an
    // outsider gets '' — same refusal the workspace gives them.
    const circle = latest?.participantUserIds ?? null;
    if (circle !== null && incident.leadInvestigatorUserId !== userId && !circle.includes(userId)) {
      const perms = await loadUserPermissions(db, tenantId, userId);
      const allowed = grantsAdminAccess(perms) || perms.includes('incidents.confidential.view');
      if (!allowed) return '';
    }

    const existingFindings =
      latest === null
        ? []
        : await db
            .select({
              category: incidentFindings.category,
              priority: incidentFindings.priority,
              description: incidentFindings.description,
              requiresAction: incidentFindings.requiresAction,
            })
            .from(incidentFindings)
            .where(
              and(
                eq(incidentFindings.tenantId, tenantId),
                eq(incidentFindings.investigationId, latest.id),
              ),
            )
            .orderBy(asc(incidentFindings.createdAt))
            .limit(50);

    const siteRow =
      incident.siteId === null
        ? null
        : ((
            await db
              .select({ name: sites.name })
              .from(sites)
              .where(and(eq(sites.tenantId, tenantId), eq(sites.id, incident.siteId)))
              .limit(1)
          )[0] ?? null);

    // Resolve actor / collector display names in one tenant-scoped read.
    const nameIds = [
      ...events.map((e) => e.actorUserId),
      ...evidence.map((e) => e.collectedByUserId),
      ...witnesses.map((w) => w.takenByUserId),
      ...(incident.leadInvestigatorUserId === null ? [] : [incident.leadInvestigatorUserId]),
      incident.reportedByUserId,
    ].filter((id) => id.length > 0 && id !== 'system');
    const uniqueIds = [...new Set(nameIds)];
    const nameRows =
      uniqueIds.length === 0
        ? []
        : await db
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(and(eq(user.tenantId, tenantId), inArray(user.id, uniqueIds)));
    const names = new Map(nameRows.map((r) => [r.id, r.name]));
    const nameOf = (id: string | null): string =>
      id === null ? '—' : (names.get(id) ?? (id === 'system' ? 'system' : 'unknown'));

    const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
    const daysLost = totalDaysLost(
      absences.map((a) => ({ fromDate: a.fromDate, toDate: a.toDate })),
      isoDay(incident.occurredAt),
      isoDay(new Date()),
    );

    const build = (eventCap: number, witnessCap: number, statementClip: number) => ({
      incident: {
        referenceNumber: incident.referenceNumber,
        title: incident.title,
        kind: incident.kind,
        status: incident.status,
        severity: incident.severity,
        potentialSeverity: incident.potentialSeverity,
        occurredAt: incident.occurredAt,
        reportedAt: incident.reportedAt,
        reportedBy: nameOf(incident.reportedByUserId),
        siteName: siteRow?.name ?? null,
        locationText: incident.locationText,
        description: clip(incident.description, 10_000),
        details: incident.details,
        investigationLevel: incident.investigationLevel,
        leadInvestigator: nameOf(incident.leadInvestigatorUserId),
        confidential: incident.confidential,
        riddor: {
          category: incident.riddorCategory,
          determinationNote: clip(incident.riddorDeterminationNote, 2000),
          deadlineAt: incident.riddorDeadlineAt,
          rescreenRequired: incident.riddorRescreenRequired,
          submittedAt: incident.riddorSubmittedAt,
        },
      },
      personsInvolved: persons.map((p) => ({
        name: p.name,
        category: p.category,
        injury: p.injury,
        ohFollowUpRequired: p.ohFollowUpRequired,
        returnedToWork: p.returnedToWork,
        onRestrictedDuties: p.onRestrictedDuties,
      })),
      absences: absences.map((a) => ({ fromDate: a.fromDate, toDate: a.toDate })),
      computedDaysLost: daysLost,
      /** Metadata only — file contents are never ingested. */
      evidence: evidence.map((e) => ({
        kind: e.kind,
        filename: e.filename,
        caption: clip(e.caption, 500),
        collectedBy: nameOf(e.collectedByUserId),
        collectedAt: e.collectedAt,
      })),
      witnessStatements: witnesses.slice(0, witnessCap).map((w) => ({
        witnessName: w.witnessName,
        statement: clip(w.statement, statementClip),
        takenBy: nameOf(w.takenByUserId),
        takenAt: w.takenAt,
      })),
      /** Most recent first. */
      eventLog: events.slice(0, eventCap).map((e) => ({
        kind: e.kind,
        detail: e.detail,
        actor: nameOf(e.actorUserId),
        at: e.createdAt,
      })),
      openInvestigationRevision:
        latest === null
          ? null
          : {
              revision: latest.revision,
              status: latest.status,
              // Current content — the draft builds on it, not over it.
              method: latest.method,
              immediateCause: latest.immediateCause,
              underlyingCause: latest.underlyingCause,
              contributingFactors: latest.contributingFactors,
              whyChain: latest.whyChain,
              causalFactors: latest.causalFactors,
              timelineEntries: latest.timelineEntries,
              conclusionSummary: latest.conclusionSummary,
              rootCauseStatement: latest.rootCauseStatement,
              recurrenceLikelihood: latest.recurrenceLikelihood,
              lessonsLearned: latest.lessonsLearned,
            },
      /** Do not re-propose any of these. */
      existingFindings,
      linkedActions,
    });

    // Progressive truncation: the event log first, then witness volume.
    const attempts: ReadonlyArray<readonly [number, number, number]> = [
      [100, 20, 4000],
      [50, 10, 2000],
      [25, 5, 1000],
    ];
    let serialised = '';
    for (const [eventCap, witnessCap, statementClip] of attempts) {
      serialised = JSON.stringify(build(eventCap, witnessCap, statementClip), null, 1);
      if (serialised.length <= MAX_CONTEXT_CHARS) break;
    }

    const vocab = [
      `Root-cause methods: ${RCA_METHODS.join(', ')}.`,
      `Causal-factor / finding categories (HSG245 families): ${CAUSAL_FACTOR_CATEGORIES.join(', ')}.`,
      `Finding priorities: ${FINDING_PRIORITIES.join(', ')}.`,
      `Recurrence likelihoods: ${RECURRENCE_LIKELIHOODS.join(', ')}.`,
    ].join('\n');

    return `The incident file this draft investigation is for (tenant record, JSON):\n\`\`\`json\n${serialised}\n\`\`\`\n\n### Vocabularies\n${vocab}`;
  },
};
