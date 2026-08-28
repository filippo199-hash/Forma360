/**
 * coshh-drafter — drafts a COSHH assessment for a substance already in
 * the tenant's inventory, from its SDS, hazard profile, WELs and stored
 * locations. Draft only: the competent person reviews, edits and
 * publishes in the module's own editor, where the server-side publish
 * gates (CMR substitution-first, RPE/PPE-only justification) apply.
 *
 * The context builder mirrors `coshh.substances.get`
 * (packages/api/src/routers/coshh.ts): substance row + current SDS +
 * locations + existing assessments' task lines. Exposure-monitoring
 * results, the health-surveillance register and the event log are
 * deliberately NOT included — they are not inputs to a new assessment
 * and the surveillance register is access-restricted.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  COSHH_CONTROL_STATUSES,
  COSHH_CONTROL_TIERS,
  COSHH_EXPOSED_GROUP_PRESETS,
  DURATION_BANDS,
  EXPOSURE_ROUTES,
  FREQUENCY_BANDS,
  QUANTITY_BANDS,
  coshhAssessments,
  coshhSdsDocuments,
  coshhSubstanceLocations,
  coshhSubstances,
  sites,
} from '@forma360/db/schema';
import { substitutionPriority } from '@forma360/shared/coshh';
import { activeBrand } from '../../lib/brand';
import type { TaskAgentServerDef } from './index';

/** ~10k tokens of serialised context; truncate lists before exceeding it. */
const MAX_CONTEXT_CHARS = 40_000;

const PRESET_GROUPS = COSHH_EXPOSED_GROUP_PRESETS.join(', ');

const BASE_PROMPT = `You are an experienced COSHH assessor working inside ${activeBrand.name} for a UK workplace. Your job is to turn a short brief into a well-structured DRAFT COSHH assessment for ONE specific substance the organisation already holds. The substance's full record is provided below as live data: its GHS classification (H and P statements, pictograms, signal word), the extracted safety data sheet, workplace exposure limits (WELs), where it is stored and in what quantities, and any special-regime flags (carcinogen, mutagen, asthmagen, biological agent, lead, asbestos referral).

You produce a draft only. You never sign, approve, publish or make an assessment "active" — a competent person in the organisation reviews and publishes it, and the system enforces its own publish gates. Never claim the assessment is finished, compliant, published, issued or signed off. Phrase everything as a practical draft for a competent person to verify.

Use British English and UK HSE terminology throughout: COSHH, WEL (EH40), LEV, RPE, hierarchy of control, health surveillance, SDS. Cite H-statement codes when you reason about hazards.

The company knowledge above (if any) is the organisation's own information — standard PPE issued, LEV coverage, first-aid and spill arrangements, house rules. Prefer it over generic assumptions and weave it into the controls and emergency notes. If it conflicts with the SDS, follow the SDS and say so in your note.

How you work:
1. Read the brief and the live data. The one thing you genuinely need is what TASK is being done with the substance (who does what, where, how). If the brief is too thin to describe the task, ask AT MOST 2-3 short clarifying questions, together in ONE message, then wait. Never ask a second round.
2. Once you can draft something useful, call proposeAssessment in the SAME turn — you may write one short sentence first, but never end a turn promising to draft and then stop. Lean toward proposing early; the user refines everything in the editor.

When you draft:
- summary (REQUIRED): 2-4 plain-English sentences a non-technical manager reads to decide whether to apply the draft — what was drafted, the key assumptions you made, and what the reviewer should double-check.
- taskDescription: one concrete task, plainly worded.
- routesOfExposure: infer from physical form and the task (powders/fumes/mists/aerosols → inhalation; wet work → skin/eyes).
- personsExposed: prefer these exact values where they fit: ${PRESET_GROUPS}; free text only for genuinely different groups.
- Bands (quantity/frequency/duration) from the stored quantities and the task; leave null rather than guess.
- Controls follow the hierarchy of control, top first: elimination, substitution, engineering, administrative, RPE, PPE. If the substance is a carcinogen, mutagen or asthmagen, lead with substitution — say substitution must be considered first. Mark controls the organisation already has (per company knowledge) as in_place; mark your recommendations as planned. If your controls are RPE/PPE-only, give a ppeJustification explaining why controls higher in the hierarchy are not reasonably practicable.
- levRequired / exposureMonitoringRequired / healthSurveillanceRequired: set true where the hazard profile warrants it (WELs present → consider monitoring; H334 → health surveillance; dusty or fume-generating tasks → LEV) and explain why in the plainSummary or notes.
- emergencyNotes: spills, fire, first aid — from the SDS P-statements and company knowledge.
- plainSummary: short, plain-English "what you must do" wording a worker can read at the point of work. No jargon.
- If the SDS extraction is marked low confidence or fields are missing, say what the reviewer must check against the paper SDS.
- Do not duplicate a task an existing assessment already covers — the live data lists them; draft the NEW task the user described.

Be warm and brief. Do not narrate the tool; ask what you must, then propose.`;

const controlSchema = z.object({
  tier: z.enum(COSHH_CONTROL_TIERS),
  description: z.string().min(1).max(1000),
  status: z.enum(COSHH_CONTROL_STATUSES).default('planned'),
  ppeJustification: z.string().max(1000).nullable().default(null),
});

/**
 * The propose-tool gate. Caps copied from `assessmentUpdateInput` /
 * `controlInput` in packages/api/src/routers/coshh.ts so a valid
 * proposal is always applicable. RPE detail fields (rpeType, rpeApf,
 * faceFitConfirmedAt) are deliberately excluded — face-fit facts must
 * come from the user, in the editor.
 */
const proposalSchema = z.object({
  summary: z.string().min(1).max(2000),
  taskDescription: z.string().min(1).max(2000),
  routesOfExposure: z.array(z.enum(EXPOSURE_ROUTES)).max(5).default([]),
  personsExposed: z.array(z.string().min(1).max(100)).max(20).default([]),
  personsCount: z.number().int().min(0).max(100000).nullable().default(null),
  quantityBand: z.enum(QUANTITY_BANDS).nullable().default(null),
  frequencyBand: z.enum(FREQUENCY_BANDS).nullable().default(null),
  durationBand: z.enum(DURATION_BANDS).nullable().default(null),
  levRequired: z.boolean().default(false),
  healthSurveillanceRequired: z.boolean().default(false),
  exposureMonitoringRequired: z.boolean().default(false),
  emergencyNotes: z.string().max(4000).default(''),
  plainSummary: z.string().max(8000).default(''),
  controls: z.array(controlSchema).max(15).default([]),
});

export type CoshhDrafterProposal = z.infer<typeof proposalSchema>;

const proposeTool: Anthropic.Tool = {
  name: 'proposeAssessment',
  description:
    'Propose a complete DRAFT COSHH assessment for the substance in the live data. Call this in the same turn you decide the brief is workable. The user reviews and edits the draft in the assessment editor before anything is published.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          '2-4 plain-English sentences for a non-technical manager: what was drafted, the key assumptions, and what to double-check. Required.',
      },
      taskDescription: {
        type: 'string',
        description: 'The one concrete task this assessment covers, plainly worded.',
      },
      routesOfExposure: {
        type: 'array',
        items: { type: 'string', enum: [...EXPOSURE_ROUTES] },
        description: 'Up to 5 routes.',
      },
      personsExposed: {
        type: 'array',
        items: { type: 'string' },
        description: `Up to 20 groups; prefer the preset values: ${PRESET_GROUPS}.`,
      },
      personsCount: { type: ['integer', 'null'], description: 'How many people, or null.' },
      quantityBand: {
        type: ['string', 'null'],
        description: `One of: ${QUANTITY_BANDS.join(', ')} — or null rather than a guess.`,
      },
      frequencyBand: {
        type: ['string', 'null'],
        description: `One of: ${FREQUENCY_BANDS.join(', ')} — or null rather than a guess.`,
      },
      durationBand: {
        type: ['string', 'null'],
        description: `One of: ${DURATION_BANDS.join(', ')} — or null rather than a guess.`,
      },
      levRequired: { type: 'boolean' },
      healthSurveillanceRequired: { type: 'boolean' },
      exposureMonitoringRequired: { type: 'boolean' },
      emergencyNotes: { type: 'string', description: 'Spills, fire, first aid. Max 4000 chars.' },
      plainSummary: {
        type: 'string',
        description: 'Plain-English point-of-work summary. Max 8000 chars.',
      },
      controls: {
        type: 'array',
        description: 'Up to 15 hierarchy-of-control entries, highest tier first.',
        items: {
          type: 'object',
          properties: {
            tier: { type: 'string', enum: [...COSHH_CONTROL_TIERS] },
            description: { type: 'string' },
            status: { type: 'string', enum: [...COSHH_CONTROL_STATUSES] },
            ppeJustification: { type: ['string', 'null'] },
          },
          required: ['tier', 'description'],
        },
      },
    },
    required: ['summary', 'taskDescription'],
  },
};

export const coshhDrafter: TaskAgentServerDef = {
  agentId: 'coshh-drafter',

  basePrompt: BASE_PROMPT,

  proposeTool,

  parseProposal: (input) => proposalSchema.parse(input),

  settingsBlock: (settings) => {
    const detail = settings['detail'];
    if (detail === 'concise') {
      return 'Draft detail: concise — keep every free-text field short and to the point; a few crisp sentences beat a page.';
    }
    if (detail === 'thorough') {
      return 'Draft detail: thorough — cover the controls, emergency notes and plain summary comprehensively, including the less common failure modes the task could raise.';
    }
    return '';
  },

  buildContext: async ({ db, tenantId, params }) => {
    const substanceId = params['substanceId'];
    if (substanceId === undefined || substanceId.length !== 26) return '';

    const [substance] = await db
      .select()
      .from(coshhSubstances)
      .where(and(eq(coshhSubstances.tenantId, tenantId), eq(coshhSubstances.id, substanceId)))
      .limit(1);
    if (substance === undefined) return '';

    const [locationRows, sdsRows, assessmentRows] = await Promise.all([
      db
        .select({
          siteId: coshhSubstanceLocations.siteId,
          locationText: coshhSubstanceLocations.locationText,
          quantity: coshhSubstanceLocations.quantity,
          unit: coshhSubstanceLocations.unit,
          storageClass: coshhSubstanceLocations.storageClass,
          storageNotes: coshhSubstanceLocations.storageNotes,
        })
        .from(coshhSubstanceLocations)
        .where(
          and(
            eq(coshhSubstanceLocations.tenantId, tenantId),
            eq(coshhSubstanceLocations.substanceId, substance.id),
          ),
        )
        .limit(20),
      db
        .select({
          issueDate: coshhSdsDocuments.issueDate,
          reviewByDate: coshhSdsDocuments.reviewByDate,
          extraction: coshhSdsDocuments.extraction,
        })
        .from(coshhSdsDocuments)
        .where(
          and(
            eq(coshhSdsDocuments.tenantId, tenantId),
            eq(coshhSdsDocuments.substanceId, substance.id),
            eq(coshhSdsDocuments.isCurrent, true),
          ),
        )
        .limit(1),
      db
        .select({
          taskDescription: coshhAssessments.taskDescription,
          status: coshhAssessments.status,
          kind: coshhAssessments.kind,
        })
        .from(coshhAssessments)
        .where(
          and(
            eq(coshhAssessments.tenantId, tenantId),
            eq(coshhAssessments.substanceId, substance.id),
          ),
        )
        .orderBy(desc(coshhAssessments.updatedAt))
        .limit(20),
    ]);

    const siteIds = [
      ...new Set(locationRows.map((l) => l.siteId).filter((v): v is string => v !== null)),
    ];
    const siteRows =
      siteIds.length > 0
        ? await db
            .select({ id: sites.id, name: sites.name })
            .from(sites)
            .where(and(eq(sites.tenantId, tenantId), inArray(sites.id, siteIds)))
        : [];
    const siteNameById = new Map(siteRows.map((s) => [s.id, s.name]));

    const currentSds = sdsRows[0];
    const now = new Date();
    const sdsStatus =
      currentSds === undefined
        ? 'missing'
        : currentSds.reviewByDate !== null && currentSds.reviewByDate <= now
          ? 'review_due'
          : 'current';

    const build = (locationCap: number, assessmentCap: number, includeExtraction: boolean) => ({
      substance: {
        name: substance.name,
        referenceNumber: substance.referenceNumber,
        supplier: substance.supplier,
        physicalForm: substance.physicalForm,
        usageDescription: substance.usageDescription,
        signalWord: substance.signalWord,
        hazardClassification: substance.hazardClassification,
        hStatements: substance.hStatements,
        pStatements: substance.pStatements,
        pictograms: substance.pictograms,
        workplaceExposureLimits: substance.workplaceExposureLimits,
        isCarcinogen: substance.isCarcinogen,
        isMutagen: substance.isMutagen,
        isAsthmagen: substance.isAsthmagen,
        isBiologicalAgent: substance.isBiologicalAgent,
        containsLead: substance.containsLead,
        asbestosReferral: substance.asbestosReferral,
        substitutionStatus: substance.substitutionStatus,
        substitutionNotes: substance.substitutionNotes,
      },
      substitutionPriority: substitutionPriority(
        {
          carcinogen: substance.isCarcinogen,
          mutagen: substance.isMutagen,
          asthmagen: substance.isAsthmagen,
        },
        substance.hStatements.map((h) => h.code),
      ),
      /** 'missing' or 'review_due' → tell the reviewer to check the paper SDS. */
      sdsStatus,
      currentSds:
        currentSds === undefined
          ? null
          : {
              issueDate: currentSds.issueDate,
              extraction: includeExtraction ? currentSds.extraction : null,
            },
      locations: locationRows.slice(0, locationCap).map((l) => ({
        siteName: l.siteId !== null ? (siteNameById.get(l.siteId) ?? null) : null,
        locationText: l.locationText,
        quantity: l.quantity,
        unit: l.unit,
        storageClass: l.storageClass,
        storageNotes: l.storageNotes,
      })),
      /** Tasks already assessed — the draft must not duplicate one. */
      existingAssessments: assessmentRows.slice(0, assessmentCap).map((a) => ({
        taskDescription: a.taskDescription,
        status: a.status,
        kind: a.kind,
      })),
    });

    // Progressive truncation, locations/assessments first, extraction last.
    const attempts: ReadonlyArray<readonly [number, number, boolean]> = [
      [20, 20, true],
      [8, 8, true],
      [4, 4, true],
      [4, 4, false],
    ];
    let serialised = '';
    for (const [locCap, assessCap, withExtraction] of attempts) {
      serialised = JSON.stringify(build(locCap, assessCap, withExtraction), null, 1);
      if (serialised.length <= MAX_CONTEXT_CHARS) break;
    }

    return `The substance this draft is for (tenant record, JSON):\n\`\`\`json\n${serialised}\n\`\`\``;
  },
};
