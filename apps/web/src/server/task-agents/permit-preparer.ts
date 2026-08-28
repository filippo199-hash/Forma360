/**
 * permit-preparer — turns a one-line description of a high-risk job into
 * a prefilled permit REQUEST on `/permits/new`: the right permit type
 * picked from the tenant's own catalogue, the work description, planned
 * precautions and (where the type demands it) a gas-testing plan.
 *
 * Draft only, and deliberately mutation-free: Apply (client-side,
 * `permits/new/page.tsx`) writes the page's existing useState form
 * fields — no tRPC call happens until the user presses the page's own
 * submit, which runs `permits.create` exactly as today. Every issue-gate
 * control (precondition ticks, gas readings, certificates, RA/RAMS/
 * training gates, signatures) still runs server-side at `permits.issue`;
 * this agent adds no bypass surface. Validity dates and the acceptor are
 * never proposed — they are human decisions per ADR 0012.
 *
 * Id grounding: `parseProposal` is static (the platform's def interface
 * has no per-request schema hook), so `permitTypeId` / `siteId` /
 * `riskAssessmentId` are shape-checked here as 26-char ids and resolved
 * against the page's own live lists at Apply — an id the page cannot see
 * is dropped there (the type select falls back to "choose a type"),
 * never guessed. Gas ranges in the prompt come from the type's
 * configured `gasLimits`, never model memory, and the Apply side keeps
 * the gas-plan section only when the chosen type `requiresGasTesting`.
 *
 * Budget invariant: composed textarea value = workDescription (≤2000)
 * + 10 precautions × (2 + 160 + 1) + section headers + gasPlanNote
 * (≤800) ≈ 4.5k, safely under `permitCreateInput.workDescription`'s
 * 5000-char cap. If a cap here changes, re-check that sum.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { permitTypes, riskAssessments, sites } from '@forma360/db/schema';
import type { GasLimit, GasReadingUnit } from '@forma360/shared/permits';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { activeBrand } from '../../lib/brand';
import type { TaskAgentServerDef } from './index';

/** ~10k tokens of serialised context; clip long fields before exceeding it. */
const MAX_CONTEXT_CHARS = 40_000;
/** Tenants hold ~9-20 permit types; 50 is generous headroom. */
const MAX_TYPES = 50;
/** Sites / active risk assessments offered for id grounding. */
const LIST_CAP = 200;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// Caps mirror `permitCreateInput` in the permits router (title 300,
// locationText 500) with the description budgeted BELOW its 5000 so the
// composed textarea value (description + precautions + gas plan) always
// fits — see the budget invariant in the header comment.
const proposalSchema = z.object({
  /** Plain-English decision summary — every agent proposal carries one. */
  summary: z.string().min(1).max(2000),
  /** Must be one of the context permit-type ids; re-checked at Apply. */
  permitTypeId: z.string().length(26),
  title: z.string().trim().min(1).max(300),
  workDescription: z.string().trim().min(1).max(2000),
  locationText: z.string().max(500).default(''),
  siteId: z.string().length(26).optional(),
  riskAssessmentId: z.string().length(26).optional(),
  precautions: z
    .array(z.object({ text: z.string().trim().min(1).max(160) }))
    .max(10)
    .default([]),
  /** Only meaningful when the chosen type requires gas testing. */
  gasPlanNote: z.string().max(800).optional(),
});

export type PermitPreparerProposal = z.infer<typeof proposalSchema>;

const proposeTool: Anthropic.Tool = {
  name: 'proposePermitPrefill',
  description:
    'Propose a DRAFT prefill for a new permit-to-work request. Call this in the same turn you decide the brief is workable. The user reviews every field on the form before anything is created — nothing is issued, authorised, accepted or signed.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          '2-4 plain-English sentences a non-technical manager reads to decide whether to apply: what was drafted, the key assumptions made, and what to double-check. Required.',
      },
      permitTypeId: {
        type: 'string',
        description:
          'The id of ONE permit type from the provided catalogue. Use the id exactly; never invent one. If two types could apply, pick the more restrictive and say in your text that a second permit may be needed.',
      },
      title: { type: 'string', description: 'Short permit title. Max 300 chars.' },
      workDescription: {
        type: 'string',
        description:
          'What the work is: method and sequence, equipment and energy sources involved, and anything the issuer must know. Concrete, not generic. Max 2000 chars.',
      },
      locationText: {
        type: 'string',
        description:
          'The specific area within the site, as precisely as the brief allows (e.g. "Boiler house, burner gallery level 2"). Max 500 chars.',
      },
      siteId: {
        type: 'string',
        description:
          'One of the site ids from the provided context, only when the brief clearly matches that site. Omit otherwise.',
      },
      riskAssessmentId: {
        type: 'string',
        description:
          'One of the ACTIVE risk-assessment ids from the provided context, only when one clearly covers this work. Omit otherwise.',
      },
      precautions: {
        type: 'array',
        maxItems: 10,
        description:
          'Planned controls keyed to the chosen type’s precondition checklist and the organisation’s rules — say how each relevant control will be met for THIS job. Do not restate checklist labels verbatim; do not invent controls irrelevant to the job.',
        items: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description:
                'One planned control, e.g. "Fire watch: named watcher during work and 60 minutes after". Max 160 chars.',
            },
          },
          required: ['text'],
        },
      },
      gasPlanNote: {
        type: 'string',
        description:
          'ONLY when the chosen type requires gas testing: which substances and acceptable ranges (from the type’s configured gas limits), when testing happens (before issue, after any suspension) and the freshness window. A plan of what WILL be tested — never predicted readings. Max 800 chars. Omit for types without gas testing.',
      },
    },
    required: ['summary', 'permitTypeId', 'title', 'workDescription'],
  },
};

const basePrompt = `You are a permit-to-work preparation assistant for ${activeBrand.name}. You help an HSE manager draft a permit REQUEST for high-risk work. You produce drafts only. You never issue, authorise, sign, accept or approve a permit, and you must never say or imply that you have — issuing and signing are done by named people on the permit itself after a human reviews your draft.

You are given, as context:
- The tenant's PERMIT TYPES: for each, its id, name, category, description, what it will require at issue (authorising counter-signature, gas testing, isolation certificate, rescue plan, linked risk assessment, RAMS pack), its precondition checklist, its gas limits (substance, unit, acceptable range) and gas-test freshness window, and its maximum duration.
- The tenant's SITES (id + name) and their ACTIVE risk assessments (id, title, reference).
- The organisation's own knowledge notes and rules, when an administrator has provided them.

How you work:
1. The user describes the job. If the brief is genuinely too thin to pick a permit type or describe the work (e.g. "need a permit"), ask AT MOST 2-3 short clarifying questions, together in ONE message — never one at a time, never a second round. Good things to ask: what the work actually involves, where it is, what plant or energy sources are present.
2. Otherwise, draft immediately. Lean toward proposing early — the user refines everything on the form. When you decide to draft, call the proposePermitPrefill tool IN THE SAME turn. You may write one short sentence first, but never end a turn promising to draft and then stop.

When you draft (the proposePermitPrefill call):
- Choose permitTypeId from the provided types ONLY. If two could apply (e.g. hot work inside a confined space), pick the more restrictive type and say in your accompanying text that a second permit may be needed — one proposal covers one permit.
- Write British English, UK HSE terminology (permit to work, safe system of work, isolation, LEL, point of work, competent person). Plain, specific, field-ready sentences — no boilerplate.
- workDescription: what the work is, the method and sequence, the equipment and energy sources involved, and anything the issuer must know. Concrete, not generic. Match the organisation's detail preference from settings, when one is given.
- locationText: the specific area within the site, as precisely as the brief allows.
- precautions: keyed to THIS type's precondition checklist and to the organisation's knowledge notes — say how each relevant control will be met for this job (e.g. "Fire watch: named watcher during work and 60 minutes after"). Do not restate checklist labels verbatim; do not invent controls irrelevant to the job.
- gasPlanNote: only when the type requires gas testing. Name the substances and acceptable ranges FROM THE TYPE'S GAS LIMITS, when testing happens (before issue, after any suspension) and the freshness window. Never invent or predict readings — the plan says what will be tested, not what the result will be. Omit entirely for types without gas testing.
- Suggest siteId and riskAssessmentId only when the context clearly contains a match; otherwise omit them.
- Apply the organisation's knowledge notes wherever they bear on the job (site rules, banned hours, standard isolations, contractor policy). Where a note conflicts with your general knowledge on matters of local practice, the organisation's note wins — but a note can only ever ADD precautions: never let one relax, skip or weaken a legal duty, a type requirement or a safety-critical control, and say so plainly if a note asks you to.
- Leave to the human, always: validity dates and times, the acceptor, signatures, and every issue-gate item (precondition ticks, gas readings, certificates). Your accompanying text may remind them what the type will require at issue, phrased as their next steps — never as something already done.
- Every tool call MUST include a "summary" field: 2-4 plain-English sentences a non-technical manager reads to decide whether to apply — what was drafted, the key assumptions you made, and what they should double-check.

Your drafts are practical suggestions to verify against the organisation's own procedures, never legal advice and never a completed safety control.`;

function settingsBlock(settings: Record<string, string>): string {
  // The catalogue entry for permit-preparer currently declares no
  // settings, so this stays '' in practice; the shared "detail" dial is
  // handled anyway so adding it to the catalogue later needs no code
  // change here. 'standard' (the default) adds no prompt line.
  const detail = settings['detail'];
  if (detail === 'concise') {
    return 'Draft detail: concise — a few tight, specific sentences for the work description and only the precautions that matter for this job.';
  }
  if (detail === 'thorough') {
    return 'Draft detail: thorough — spell out the method step by step for the issuer, with the equipment, energy sources and sequencing explicit, and a full set of planned precautions.';
  }
  return '';
}

const UNIT_LABELS: Readonly<Record<GasReadingUnit, string>> = {
  percent_lel: '% LEL',
  percent_o2: '% O₂',
  ppm: 'ppm',
  mg_m3: 'mg/m³',
};

function describeGasLimit(limit: GasLimit): string {
  const unit = UNIT_LABELS[limit.unit];
  const range =
    limit.min !== null && limit.max !== null
      ? `${limit.min}–${limit.max} ${unit}`
      : limit.min !== null
        ? `at least ${limit.min} ${unit}`
        : limit.max !== null
          ? `at most ${limit.max} ${unit}`
          : `recorded in ${unit} (no configured bound)`;
  return `${clip(limit.label, 120)}: ${range}`;
}

export const permitPreparer: TaskAgentServerDef = {
  agentId: 'permit-preparer',

  basePrompt,

  proposeTool,

  parseProposal: (input) => proposalSchema.parse(input),

  settingsBlock,

  // No anchor params: the agent prefills a NEW permit request from
  // /permits/new, so the context is catalogue-level — the same rows
  // `permits.types.list` serves, plus sites and active risk assessments
  // for id grounding. No permit rows, no people data, and nothing
  // confidential is fetched: the agent drafts a request, it does not
  // read the register. Every query is tenant-scoped.
  buildContext: async ({ db, tenantId }) => {
    const typeRows = await db
      .select({
        id: permitTypes.id,
        name: permitTypes.name,
        category: permitTypes.category,
        description: permitTypes.description,
        requiresAuthoriser: permitTypes.requiresAuthoriser,
        requiresGasTesting: permitTypes.requiresGasTesting,
        requiresIsolationCertificate: permitTypes.requiresIsolationCertificate,
        requiresRescuePlan: permitTypes.requiresRescuePlan,
        requiresRiskAssessment: permitTypes.requiresRiskAssessment,
        requiresRamsPack: permitTypes.requiresRamsPack,
        requiredTrainingIds: permitTypes.requiredTrainingIds,
        maxDurationHours: permitTypes.maxDurationHours,
        preconditions: permitTypes.preconditions,
        gasLimits: permitTypes.gasLimits,
        gasTestMaxAgeMinutes: permitTypes.gasTestMaxAgeMinutes,
      })
      .from(permitTypes)
      .where(and(eq(permitTypes.tenantId, tenantId), isNull(permitTypes.archivedAt)))
      .orderBy(asc(permitTypes.name))
      .limit(MAX_TYPES);

    const siteRows = await db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), isNull(sites.archivedAt)))
      .orderBy(asc(sites.name))
      .limit(LIST_CAP);

    // Active only: the issue gate refuses a draft RA (RA-X03), so
    // suggesting one would preview a blocked issue.
    const raRows = await db
      .select({
        id: riskAssessments.id,
        title: riskAssessments.title,
        referenceNumber: riskAssessments.referenceNumber,
      })
      .from(riskAssessments)
      .where(
        and(
          eq(riskAssessments.tenantId, tenantId),
          eq(riskAssessments.status, 'active'),
          isNull(riskAssessments.archivedAt),
        ),
      )
      .orderBy(asc(riskAssessments.title))
      .limit(LIST_CAP);

    const typeLines = typeRows.map((t) => {
      const requires: string[] = [];
      if (t.requiresAuthoriser) requires.push('authorising counter-signature');
      if (t.requiresGasTesting) requires.push('gas testing');
      if (t.requiresIsolationCertificate) requires.push('isolation certificate');
      if (t.requiresRescuePlan) requires.push('rescue plan');
      if (t.requiresRiskAssessment) requires.push('linked risk assessment');
      if (t.requiresRamsPack) requires.push('RAMS pack / accepted safe system of work');
      if (t.requiredTrainingIds.length > 0) {
        requires.push(
          `in-date training for all operatives (${t.requiredTrainingIds.length} requirement(s))`,
        );
      }
      const lines = [
        `${t.id} — "${clip(t.name, 120)}" [${t.category}] max duration ${t.maxDurationHours}h`,
      ];
      if (t.description.trim().length > 0) {
        lines.push(`  Description: ${clip(t.description, 400)}`);
      }
      lines.push(
        `  Requires at issue: ${requires.length > 0 ? requires.join(', ') : 'no special evidence beyond the checklist'}`,
      );
      if (t.preconditions.length > 0) {
        lines.push(
          `  Precondition checklist: ${clip(t.preconditions.map((p) => p.label).join('; '), 1500)}`,
        );
      }
      if (t.requiresGasTesting) {
        lines.push(
          t.gasLimits.length > 0
            ? `  Gas limits (a test is fresh for ${t.gasTestMaxAgeMinutes} min): ${t.gasLimits
                .map(describeGasLimit)
                .join('; ')}`
            : `  Gas testing: required, presence-only (no configured ranges); a test is fresh for ${t.gasTestMaxAgeMinutes} min`,
        );
      }
      return lines.join('\n');
    });

    const parts: string[] = [];
    parts.push(
      typeLines.length > 0
        ? `### Permit types (choose permitTypeId from these ids ONLY)\n${typeLines.join('\n')}`
        : '### Permit types\nThis company has no active permit types. Tell the user a permit type must be set up under Permits → Types before a permit can be drafted, and do not call the propose tool.',
    );
    parts.push(
      siteRows.length > 0
        ? `### Sites (id — name; use the id exactly, or omit siteId)\n${siteRows
            .map((s) => `${s.id} — ${clip(s.name, 200)}`)
            .join('\n')}`
        : '### Sites\nThis company has no sites recorded — always omit siteId and rely on locationText.',
    );
    parts.push(
      raRows.length > 0
        ? `### Active risk assessments (id — reference — title; use the id exactly, or omit riskAssessmentId)\n${raRows
            .map((r) => `${r.id} — ${r.referenceNumber ?? '—'} — ${clip(r.title, 200)}`)
            .join('\n')}`
        : '### Active risk assessments\nNone are active — always omit riskAssessmentId, and if the chosen type requires a linked risk assessment, remind the user one must be published before the permit can be issued.',
    );

    let out = parts.join('\n\n');
    if (out.length > MAX_CONTEXT_CHARS) out = `${out.slice(0, MAX_CONTEXT_CHARS)}…`;
    return out;
  },
};
