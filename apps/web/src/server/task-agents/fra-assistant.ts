/**
 * fra-assistant — drafts the WRITTEN sections of a fire risk assessment
 * (FreeHS module B4) for one existing FRA row: premises description,
 * persons at risk, the three fire-triangle source sections, the
 * evaluation, and significant findings. Apply (client-side,
 * `fire-safety/fra/[fraId]/page.tsx`) maps the proposal onto the
 * module's ordinary mutations — `fras.update` then `fras.addFinding`
 * per finding — so every tenant/permission check runs as the signed-in
 * user. `fras.publish` is never touched: attesting an FRA as suitable
 * and sufficient stays a signed human act behind its eight gates.
 *
 * Caps mirror `fraUpdateInput` / `findingInput` in
 * packages/api/src/routers/fireSafety.ts exactly, so a validated
 * proposal can never fail the router's input validation (the DH-E21
 * coupling discipline — if those inputs change, change this schema in
 * the same PR). `suggestedRiskRating` is PREVIEW ONLY and is never
 * written: the taken-together rating, the Responsible Person and the
 * review frequency remain the human assessor's call (ADR 0011).
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  fireBuildings,
  fireDoors,
  fireLogbookChecks,
  fireRiskAssessments,
  fireSignificantFindings,
} from '@forma360/db/schema';
import {
  FRA_FINDING_CATEGORIES,
  FRA_FINDING_PRIORITIES,
  FRA_PERSONS_AT_RISK_PRESETS,
  FRA_RISK_RATINGS,
  checkDisplayStatus,
  checkNeedsAttention,
  isAbove11mResidential,
  isHighRiseResidential,
} from '@forma360/shared/fire-safety';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { activeBrand } from '../../lib/brand';
import type { TaskAgentServerDef } from './index';

/** ~8k tokens of serialised context; truncate lists before exceeding it. */
const MAX_CONTEXT_CHARS = 32_000;

const findingSchema = z.object({
  category: z.enum(FRA_FINDING_CATEGORIES),
  priority: z.enum(FRA_FINDING_PRIORITIES).default('medium'),
  description: z.string().min(1).max(4000),
  requiresAction: z.boolean().default(true),
});

const proposalSchema = z
  .object({
    /** Plain-English decision summary — every agent proposal carries one. */
    summary: z.string().min(1).max(2000),
    premisesDescription: z.string().min(1).max(4000).optional(),
    /**
     * Enum-only: the editor renders `t('personsAtRisk.<group>')`, so a
     * free-text group would print a raw key path. Unusual groups go in
     * the evaluation text instead — the prompt says so.
     */
    personsAtRisk: z
      .array(z.enum(FRA_PERSONS_AT_RISK_PRESETS))
      .min(1)
      .max(20)
      .refine((groups) => new Set(groups).size === groups.length, {
        message: 'personsAtRisk must not contain duplicates',
      })
      .optional(),
    ignitionSources: z.string().min(1).max(8000).optional(),
    fuelSources: z.string().min(1).max(8000).optional(),
    oxygenSources: z.string().min(1).max(8000).optional(),
    evaluationNotes: z.string().min(1).max(8000).optional(),
    findings: z.array(findingSchema).max(30).default([]),
    /** Advisory only — shown to the assessor, never written to the record. */
    suggestedRiskRating: z.enum(FRA_RISK_RATINGS).optional(),
  })
  .refine(
    (p) =>
      p.premisesDescription !== undefined ||
      p.personsAtRisk !== undefined ||
      p.ignitionSources !== undefined ||
      p.fuelSources !== undefined ||
      p.oxygenSources !== undefined ||
      p.evaluationNotes !== undefined ||
      p.findings.length > 0,
    {
      message:
        'The proposal must contain at least one content section or at least one significant finding',
    },
  );

export type FraAssistantProposal = z.infer<typeof proposalSchema>;

const proposeTool: Anthropic.Tool = {
  name: 'proposeFraSections',
  description:
    'Propose drafted written sections (and significant findings) for the fire risk assessment in the live data. Call this in the same turn you decide to draft. The user reviews every word in the FRA editor — nothing is published, signed or attested by this call.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          '2-4 plain-English sentences a non-technical manager reads to decide whether to apply: what was drafted, the key assumptions made, and what to double-check on site. Required.',
      },
      premisesDescription: {
        type: 'string',
        description: 'Description of the premises and its use. Max 4000 chars.',
      },
      personsAtRisk: {
        type: 'array',
        items: { type: 'string', enum: [...FRA_PERSONS_AT_RISK_PRESETS] },
        description:
          'Preset group ids ONLY, no free text and no duplicates. Put any unusual group into evaluationNotes instead.',
      },
      ignitionSources: {
        type: 'string',
        description: 'Sources of ignition section. Max 8000 chars.',
      },
      fuelSources: { type: 'string', description: 'Sources of fuel section. Max 8000 chars.' },
      oxygenSources: {
        type: 'string',
        description: 'Sources of oxygen section. Max 8000 chars.',
      },
      evaluationNotes: {
        type: 'string',
        description:
          'Evaluation of the risk and the adequacy of existing measures. Max 8000 chars.',
      },
      findings: {
        type: 'array',
        maxItems: 30,
        description:
          'Significant findings — one concrete deficiency per entry, grounded in the live data.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: [...FRA_FINDING_CATEGORIES] },
            priority: { type: 'string', enum: [...FRA_FINDING_PRIORITIES] },
            description: { type: 'string', description: 'Max 4000 chars.' },
            requiresAction: {
              type: 'boolean',
              description: 'True unless the finding is purely observational.',
            },
          },
          required: ['category', 'description'],
        },
      },
      suggestedRiskRating: {
        type: 'string',
        enum: [...FRA_RISK_RATINGS],
        description:
          'Optional advisory taken-together rating with your reasoning in the summary — shown to the assessor only, never written to the record.',
      },
    },
    required: ['summary'],
  },
};

const BASE_PROMPT = `You are an experienced fire risk assessment assistant inside ${activeBrand.name}, a health-and-safety platform. You help a competent person draft the WRITTEN sections of a fire risk assessment (FRA) for one specific premises. You draft; you never assess, sign, attest or publish. The user reviews every word, and only a human Responsible Person can attest the assessment as suitable and sufficient. Never claim otherwise, and never describe your output as a completed or compliant FRA — it is a working draft to be verified on site.

You write in British English using recognised UK fire-safety terminology: the Regulatory Reform (Fire Safety) Order 2005, PAS 79 methodology, sources of ignition / fuel / oxygen, means of escape, compartmentation, detection and warning, emergency lighting, persons especially at risk, significant findings, and the taken-together risk rating. Phrase everything as findings-to-verify, not legal advice.

CONTEXT you receive with each request: the FRA's current section text (you are often revising, not starting blank — preserve what is right and improve it; do not discard the assessor's own observations), the building record (use, construction, height, storeys, residential/sleeping risk, fire protection systems, external wall system, compartmentation and escape notes, and the FSR 2022 regime classification), any existing significant findings, and recent attention signals from the building's logbook (failed or overdue checks and fire-door inspections — these are strong candidates for significant findings; cite them concretely). COMPANY KNOWLEDGE follows these instructions: the organisation's own policies, previous FRA extracts, insurer requirements and house style. Treat it as authoritative for how this company writes and what hazards recur across its estate, but never let it override site-specific facts in the context.

HOW YOU WORK:
1. Read the brief and the context. If the brief is thin but the building record and logbook give you enough to draft something genuinely useful, draft — lean strongly toward proposing early; the user refines in the editor.
2. Only when the brief is too thin to draft anything site-specific (for example: no building attached, no use description, and a one-word brief), ask AT MOST 2-3 short clarifying questions, together in ONE message, then wait. Never ask a second round.
3. When you decide to draft, call the proposeFraSections tool IN THE SAME TURN. You may write one short sentence first ("Drafting that now…"), but never end a turn promising to draft without calling the tool.
4. Every tool call MUST include a "summary" field: 2-4 plain-English sentences a non-technical manager reads to decide whether to apply — what was drafted, the key assumptions you made, and what they should double-check.

WHEN YOU PROPOSE:
- Fill only the sections the user asked for, or all content sections when they asked for a full draft. Ground every statement in the context or company knowledge; where you must assume, mark it inline as "[verify on site: …]" rather than stating it as fact.
- Persons at risk: choose from the preset group ids only, no duplicates; put any unusual group into the evaluation text instead.
- Significant findings: one deficiency per finding, concrete and actionable ("Fire door to Stair 2 wedged open — self-closer defective", not "doors need attention"), with the correct category and a defensible priority. Set requiresAction true unless the finding is purely observational. Do not restate a finding the assessment already records.
- You may include a suggestedRiskRating with one sentence of reasoning in the summary — it is shown to the assessor only and is never written to the record. The rating, the Responsible Person's name and the review frequency are always the human assessor's call.

Be warm, brief and professional. Do not narrate the tool; ask what you must, then propose.`;

export const fraAssistant: TaskAgentServerDef = {
  agentId: 'fra-assistant',

  basePrompt: BASE_PROMPT,

  proposeTool,

  parseProposal: (input) => proposalSchema.parse(input),

  settingsBlock: (settings) => {
    // Catalogue entry for fra-assistant carries the shared "detail" dial
    // only; 'standard' (the default) adds no prompt line.
    const detail = settings['detail'];
    if (detail === 'concise') {
      return 'Draft detail: concise — tight, audit-ready paragraphs and only the most significant findings.';
    }
    if (detail === 'thorough') {
      return 'Draft detail: thorough — fuller reasoning in every section and more granular significant findings.';
    }
    return '';
  },

  /**
   * Mirrors the reads `fireSafety.fras.get` already makes: the FRA row,
   * its building, its findings, plus the building's attention signals
   * (failed/overdue checks and doors — the raw material for concrete
   * findings). Every query is tenant-scoped; a missing/foreign fraId
   * yields '' rather than an error.
   */
  buildContext: async ({ db, tenantId, params }) => {
    const fraId = params['fraId'];
    if (fraId === undefined || fraId.length !== 26) return '';

    const [fra] = await db
      .select()
      .from(fireRiskAssessments)
      .where(and(eq(fireRiskAssessments.tenantId, tenantId), eq(fireRiskAssessments.id, fraId)))
      .limit(1);
    if (fra === undefined) return '';

    const findingRows = await db
      .select({
        category: fireSignificantFindings.category,
        priority: fireSignificantFindings.priority,
        description: fireSignificantFindings.description,
        requiresAction: fireSignificantFindings.requiresAction,
        resolvedAt: fireSignificantFindings.resolvedAt,
      })
      .from(fireSignificantFindings)
      .where(
        and(
          eq(fireSignificantFindings.tenantId, tenantId),
          eq(fireSignificantFindings.fraId, fra.id),
        ),
      )
      .orderBy(asc(fireSignificantFindings.sortOrder))
      .limit(50);

    const building =
      fra.buildingId !== null
        ? ((
            await db
              .select()
              .from(fireBuildings)
              .where(
                and(eq(fireBuildings.tenantId, tenantId), eq(fireBuildings.id, fra.buildingId)),
              )
              .limit(1)
          )[0] ?? null)
        : null;

    const now = new Date();
    let attentionChecks: ReadonlyArray<{
      check: string;
      frequency: string;
      status: string;
      lastResult: string | null;
      nextDueAt: Date;
    }> = [];
    let attentionDoors: ReadonlyArray<{
      doorRef: string;
      floor: string;
      lastOutcome: string | null;
      nextInspectionDueAt: Date;
    }> = [];

    if (building !== null) {
      const checkRows = await db
        .select({
          checkType: fireLogbookChecks.checkType,
          label: fireLogbookChecks.label,
          frequency: fireLogbookChecks.frequency,
          lastResult: fireLogbookChecks.lastResult,
          nextDueAt: fireLogbookChecks.nextDueAt,
        })
        .from(fireLogbookChecks)
        .where(
          and(
            eq(fireLogbookChecks.tenantId, tenantId),
            eq(fireLogbookChecks.buildingId, building.id),
            eq(fireLogbookChecks.active, true),
          ),
        )
        .orderBy(asc(fireLogbookChecks.nextDueAt))
        .limit(100);
      attentionChecks = checkRows
        .map((c) => ({
          check: c.checkType === 'custom' ? c.label : c.checkType,
          frequency: c.frequency,
          status: checkDisplayStatus(c.nextDueAt, c.frequency, c.lastResult, now),
          lastResult: c.lastResult,
          nextDueAt: c.nextDueAt,
        }))
        .filter((c) => checkNeedsAttention(c.status));

      const doorRows = await db
        .select({
          doorRef: fireDoors.doorRef,
          floor: fireDoors.floor,
          lastOutcome: fireDoors.lastOutcome,
          nextInspectionDueAt: fireDoors.nextInspectionDueAt,
        })
        .from(fireDoors)
        .where(
          and(
            eq(fireDoors.tenantId, tenantId),
            eq(fireDoors.buildingId, building.id),
            eq(fireDoors.status, 'active'),
          ),
        )
        .orderBy(asc(fireDoors.nextInspectionDueAt))
        .limit(200);
      attentionDoors = doorRows.filter(
        (d) => d.lastOutcome === 'fail' || d.nextInspectionDueAt.getTime() <= now.getTime(),
      );
    }

    const build = (findingCap: number, signalCap: number) => ({
      fra: {
        referenceNumber: fra.referenceNumber,
        title: fra.title,
        status: fra.status,
        methodology: fra.methodology,
        publishedAt: fra.publishedAt,
        riskRating: fra.riskRating,
        // Current section text — the draft revises, it does not replace.
        premisesDescription: fra.premisesDescription,
        personsAtRisk: fra.personsAtRisk,
        maxOccupancy: fra.maxOccupancy,
        sleepingOccupants: fra.sleepingOccupants,
        ignitionSources: fra.ignitionSources,
        fuelSources: fra.fuelSources,
        oxygenSources: fra.oxygenSources,
        evaluationNotes: fra.evaluationNotes,
      },
      building:
        building === null
          ? null
          : {
              name: building.name,
              address: building.address,
              useDescription: building.useDescription,
              isResidential: building.isResidential,
              heightMetres: building.heightMetres,
              storeys: building.storeys,
              hasFireAlarm: building.hasFireAlarm,
              hasEmergencyLighting: building.hasEmergencyLighting,
              hasSprinklers: building.hasSprinklers,
              hasDampers: building.hasDampers,
              hasRisers: building.hasRisers,
              externalWallSystem: building.externalWallSystem,
              compartmentationNotes: building.compartmentationNotes,
              meansOfEscapeNotes: building.meansOfEscapeNotes,
              serviceRisersNotes: building.serviceRisersNotes,
              /** Fire Safety (England) Regulations 2022 regime. */
              highRiseResidential: isHighRiseResidential(building),
              above11mResidential: isAbove11mResidential(building),
            },
      existingFindings: findingRows.slice(0, findingCap).map((f) => ({
        category: f.category,
        priority: f.priority,
        description: f.description,
        requiresAction: f.requiresAction,
        resolved: f.resolvedAt !== null,
      })),
      /** Failed/overdue logbook checks — concrete finding candidates. */
      attentionChecks: attentionChecks.slice(0, signalCap),
      /** Failed/overdue fire-door inspections — likewise. */
      attentionDoors: attentionDoors.slice(0, signalCap),
    });

    // Progressive truncation: findings first, then the attention lists.
    const attempts: ReadonlyArray<readonly [number, number]> = [
      [50, 20],
      [20, 10],
      [8, 5],
    ];
    let serialised = '';
    for (const [findingCap, signalCap] of attempts) {
      serialised = JSON.stringify(build(findingCap, signalCap), null, 1);
      if (serialised.length <= MAX_CONTEXT_CHARS) break;
    }

    const vocab = [
      `Persons-at-risk preset ids (the ONLY allowed personsAtRisk values): ${FRA_PERSONS_AT_RISK_PRESETS.join(', ')}.`,
      `Finding categories: ${FRA_FINDING_CATEGORIES.join(', ')}.`,
      `Finding priorities: ${FRA_FINDING_PRIORITIES.join(', ')}.`,
      `Risk ratings (advisory suggestion only): ${FRA_RISK_RATINGS.join(', ')}.`,
    ].join('\n');

    return `The fire risk assessment this draft is for (tenant record, JSON):\n\`\`\`json\n${serialised}\n\`\`\`\n\n### Vocabularies\n${vocab}`;
  },
};
