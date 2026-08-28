/**
 * rams-drafter — turns a plain-English description of the job into a
 * full draft method statement for ONE RAMS pack: sequenced steps that
 * REFERENCE the pack's bound risk-assessment hazards (ADR 0015's
 * headline rule), plus PPE, hold points, emergency and logistics blocks.
 *
 * Draft only: Apply (client-side, `rams/[packId]/build/page.tsx`) maps
 * the proposal onto the module's ordinary `rams.packs.saveDraft`
 * mutation, so every tenant/permission check runs as the signed-in user
 * and the result lands as the pack's editable `draftContent`. Issue
 * stays a separate, attested act (`rams.issue`) and is never touched.
 *
 * Hazard grounding: the context labels every bound hazard with a stable
 * key (h1..hn, bound order) and every bound COSHH substance with c1..cn;
 * the proposal carries KEYS, never raw ULIDs, so the model cannot
 * hallucinate a plausible-looking `raVersionId`/`hazardIndex` pair. The
 * `parseProposal` gate is static (the platform's def interface has no
 * per-request schema hook), so keys are shape-checked here and resolved
 * against the SAME deterministic key assignment client-side at Apply —
 * a key that resolves to nothing is dropped there, never invented.
 * If the key-assignment order changes here it MUST change in the build
 * page's `applyAgentProposal` in the same PR (the DH-E21 discipline).
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  ramsPackCoshh,
  ramsPackRiskAssessments,
  ramsPacks,
  riskAssessmentVersions,
  riskAssessments,
  coshhAssessments,
  coshhSubstances,
  sites,
} from '@forma360/db/schema';
import {
  DEFAULT_HIGH_RISK_THRESHOLD,
  HOLD_POINT_KINDS,
  MAX_METHOD_STATEMENT_STEPS,
  PERSONNEL_ROLES,
  PPE_ITEMS,
  type MethodStatementContent,
} from '@forma360/shared/rams';
import { bandFor, bandRank } from '@forma360/shared/risk-matrix';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { activeBrand } from '../../lib/brand';
import type { TaskAgentServerDef } from './index';

/** ~10k tokens of serialised context; clip long fields before exceeding it. */
const MAX_CONTEXT_CHARS = 40_000;
/** Context cap on keyed hazards (schema max is 40/RA; 3 packs' worth). */
const MAX_KEYED_HAZARDS = 120;
/** Context cap on keyed COSHH bindings. */
const MAX_KEYED_SUBSTANCES = 30;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// Keys are h1..h999 / c1..c999 — assigned in bound order by buildContext
// and re-derived identically at Apply. Shape-checked here; resolved (and
// unknown keys dropped) client-side against the live key map.
const hazardKey = z.string().regex(/^h[1-9]\d{0,2}$/);
const substanceKey = z.string().regex(/^c[1-9]\d{0,2}$/);

// Caps copied from `methodStatementStepSchema` and friends in
// packages/shared/src/rams.ts so a valid proposal always parses against
// `methodStatementContentSchema` at Apply.
const stepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4000),
  hazardKeys: z.array(hazardKey).max(40).default([]),
  controlNotes: z.string().trim().max(2000).default(''),
  ppe: z.array(z.enum(PPE_ITEMS)).max(PPE_ITEMS.length).default([]),
  ppeOther: z.string().trim().max(300).default(''),
  plant: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        note: z.string().trim().max(300).default(''),
      }),
    )
    .max(30)
    .default([]),
  substanceKeys: z.array(substanceKey).max(30).default([]),
  personnel: z
    .array(
      z.object({
        role: z.enum(PERSONNEL_ROLES),
        roleOther: z.string().trim().max(120).default(''),
        count: z.number().int().min(1).max(200).default(1),
        competenceNote: z.string().trim().max(500).default(''),
      }),
    )
    .max(20)
    .default([]),
  holdPoint: z
    .object({
      kind: z.enum(HOLD_POINT_KINDS),
      description: z.string().trim().min(1).max(500),
      responsibleRole: z.string().trim().max(160).default(''),
    })
    .nullable()
    .default(null),
  environmentalNotes: z.string().trim().max(1000).default(''),
});

// firstAid + emergencyProcedure are required with real content because
// `emergencyBlockComplete` gates issue on exactly those two fields.
const emergencySchema = z.object({
  firstAid: z.string().trim().min(1).max(2000),
  emergencyProcedure: z.string().trim().min(1).max(2000),
  rescuePlan: z.string().trim().max(2000).default(''),
  nearestHospital: z.string().trim().max(500).default(''),
  emergencyContacts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        role: z.string().trim().max(160).default(''),
        phone: z.string().trim().max(60).default(''),
      }),
    )
    .max(20)
    .default([]),
});

const logisticsSchema = z.object({
  welfare: z.string().trim().max(2000).default(''),
  environmental: z.string().trim().max(2000).default(''),
  accessEgress: z.string().trim().max(2000).default(''),
  permitsRequired: z.string().trim().max(1000).default(''),
  competence: z.string().trim().max(2000).default(''),
});

const proposalSchema = z.object({
  /** Plain-English decision summary — every agent proposal carries one. */
  summary: z.string().min(1).max(2000),
  scopeOfWorks: z.string().trim().min(1).max(4000),
  steps: z.array(stepSchema).min(1).max(MAX_METHOD_STATEMENT_STEPS),
  emergency: emergencySchema,
  logistics: logisticsSchema.default({}),
});

export type RamsDrafterProposal = z.infer<typeof proposalSchema>;

const proposeTool: Anthropic.Tool = {
  name: 'proposeMethodStatement',
  description:
    'Propose a complete DRAFT method statement for the RAMS pack in the live data. Call this in the same turn you decide the brief is workable. The author reviews and edits the draft in the pack builder — nothing is issued, briefed or signed.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          '2-4 plain-English sentences a non-technical manager reads to decide whether to apply: what was drafted, the key assumptions made, and what to double-check. Required.',
      },
      scopeOfWorks: {
        type: 'string',
        description: 'What the job actually is, in one paragraph. Max 4000 chars.',
      },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_METHOD_STATEMENT_STEPS,
        description:
          'The sequence of operations, in the order the work actually happens: arrival/induction and setup, isolations and permits as hold points BEFORE the exposed work, the work itself, reinstatement and demobilisation.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short step title. Max 200 chars.' },
            description: {
              type: 'string',
              description: 'What is done, by whom, with what controls. Max 4000 chars.',
            },
            hazardKeys: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Hazard keys (h1, h2, …) from the bound-hazards table for the hazards LIVE at this step. Use ONLY keys provided in the context; never invent one. Empty when no risk assessments are bound.',
            },
            controlNotes: {
              type: 'string',
              description: 'Step-specific control notes beyond the referenced RA controls.',
            },
            ppe: {
              type: 'array',
              items: { type: 'string', enum: [...PPE_ITEMS] },
              description: 'PPE required at this step, from the fixed list.',
            },
            ppeOther: {
              type: 'string',
              description: 'Any PPE not on the fixed list. Max 300 chars.',
            },
            plant: {
              type: 'array',
              maxItems: 30,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  note: {
                    type: 'string',
                    description: 'Certificate / inspection note, e.g. "LOLER cert in date".',
                  },
                },
                required: ['name'],
              },
            },
            substanceKeys: {
              type: 'array',
              items: { type: 'string' },
              description:
                'COSHH keys (c1, c2, …) from the bound-substances table where those substances are used at this step. Only keys provided in the context.',
            },
            personnel: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: [...PERSONNEL_ROLES] },
                  roleOther: { type: 'string', description: 'Used when role is "other".' },
                  count: { type: 'integer', minimum: 1, maximum: 200 },
                  competenceNote: { type: 'string' },
                },
                required: ['role', 'count'],
              },
            },
            holdPoint: {
              type: ['object', 'null'],
              description:
                'Stop-and-check before work continues: isolation proved, permit issued, atmosphere tested, supervisor check. Null when the step has none.',
              properties: {
                kind: { type: 'string', enum: [...HOLD_POINT_KINDS] },
                description: {
                  type: 'string',
                  description: 'What must be true before work continues. Max 500 chars.',
                },
                responsibleRole: {
                  type: 'string',
                  description: 'Who signs it off — a role name, not a person.',
                },
              },
              required: ['kind', 'description'],
            },
            environmentalNotes: { type: 'string', description: 'Max 1000 chars.' },
          },
          required: ['title', 'description'],
        },
      },
      emergency: {
        type: 'object',
        description:
          'firstAid and emergencyProcedure are required — the pack cannot be issued without them.',
        properties: {
          firstAid: { type: 'string', description: 'First-aid arrangements — who, where, what.' },
          emergencyProcedure: {
            type: 'string',
            description: 'Raise the alarm, muster, contact. Max 2000 chars.',
          },
          rescuePlan: { type: 'string' },
          nearestHospital: { type: 'string' },
          emergencyContacts: {
            type: 'array',
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                role: { type: 'string' },
                phone: { type: 'string' },
              },
              required: ['name'],
            },
          },
        },
        required: ['firstAid', 'emergencyProcedure'],
      },
      logistics: {
        type: 'object',
        properties: {
          welfare: { type: 'string', description: 'Toilets, water, rest area.' },
          environmental: { type: 'string', description: 'Waste, spill, noise, dust controls.' },
          accessEgress: { type: 'string', description: 'Site-specific access and egress.' },
          permitsRequired: { type: 'string', description: 'Permits the work is expected to need.' },
          competence: {
            type: 'string',
            description: 'Crew-wide training / competence expectations.',
          },
        },
      },
    },
    required: ['summary', 'scopeOfWorks', 'steps', 'emergency'],
  },
};

const basePrompt = `You are the RAMS drafter for ${activeBrand.name}, working with UK HSE managers and supervisors. Your job: turn a short description of a piece of work into a draft method statement for ONE RAMS pack — the safe sequence of operations, written the way a competent UK site supervisor would write it.

You produce DRAFTS only. You never issue, sign, attest, brief or publish anything, and you never claim to. Never state or imply that the pack is issued, accepted, briefed, in force or compliant. The author reviews and edits everything in the pack builder, and issuing requires their own attestation. Say this plainly if asked.

CONTEXT you receive with each request: the pack's job details (title, client, site, dates), the pack's CURRENT draft content (preserve and build on it — do not silently discard existing steps or text the author wrote), the bound risk-assessment hazards as a keyed list (h1, h2, …) with each hazard's wording, who is affected, existing controls and residual risk band, and any bound COSHH assessments as a keyed list (c1, c2, …). You may also receive organisation knowledge (site rules, standard first-aid and welfare arrangements, PPE policy, client requirements). Treat that knowledge as the company's standing instructions and weave it in — it is why your drafts sound like this company and not a generic template.

Core rule of this document model: a step REFERENCES hazards from the bound risk assessments via hazardKeys; it never restates a hazard as its own source of truth. Attach hazard keys to the steps where each hazard is live, and make sure every hazard flagged HIGH (high or very-high residual risk) is referenced by at least one step — the pack cannot be issued otherwise. Use ONLY the keys provided in the context; never invent a key. The same goes for COSHH keys (c1, c2, …). If no risk assessments are bound yet, draft the steps anyway, leave hazardKeys empty, and tell the author clearly that they must bind the relevant risk assessments in the builder before the pack can be issued.

How to work:
1. If the brief is genuinely too thin to draft anything useful, ask AT MOST 2-3 short clarifying questions, together in ONE message, and never a second round (good ones: what the task physically involves, where/what environment, crew size and trades). Otherwise do not interrogate — lean strongly toward drafting; the author refines afterwards.
2. When you draft, write in British English with standard UK HSE terminology (permit to work, banksman, LOLER, isolation, exclusion zone, toolbox talk, welfare, RIDDOR). Steps are sequenced as work actually happens: arrival/induction and setup, isolations and permits as hold points BEFORE the exposed work, the work itself, then reinstatement and demobilisation. Each step gets a clear title and a practical description (what is done, by whom, with what controls); use hold points for isolation proved, permits issued, atmosphere tested or supervisor checks; assign PPE from the fixed list plus ppeOther for anything else; add personnel roles and plant where the work implies them; attach COSHH keys to steps where those substances are used. Fill the emergency block (first aid and emergency procedure at minimum — reuse the organisation's standard arrangements if provided) and the logistics block (welfare, access/egress, environmental controls, permits expected).
3. As soon as you can produce a solid draft, call the proposeMethodStatement tool IN THE SAME TURN. You may write one short sentence first, but never end a turn promising to draft without calling the tool. Keep it accurate and site-usable, not padded — this is a working document, not marketing copy.
4. Every tool call MUST include a "summary" field: 2-4 plain-English sentences a non-technical manager reads to decide whether to apply — what was drafted, the key assumptions you made, and what they should double-check. If applying will replace existing draft steps, say so in the summary.`;

function settingsBlock(settings: Record<string, string>): string {
  // Catalogue entry for rams-drafter carries the shared "detail" dial
  // only; 'standard' (the default) adds no prompt line.
  const detail = settings['detail'];
  if (detail === 'concise') {
    return 'Draft detail: concise — short, site-card style steps a supervisor can brief from; keep descriptions to a few direct sentences and skip minor logistics.';
  }
  if (detail === 'thorough') {
    return 'Draft detail: thorough — full step descriptions with the controls spelled out per step, complete personnel and plant listings, and fully written emergency and logistics blocks (the register a principal contractor reviews).';
  }
  return '';
}

export const ramsDrafter: TaskAgentServerDef = {
  agentId: 'rams-drafter',

  basePrompt,

  proposeTool,

  parseProposal: (input) => proposalSchema.parse(input),

  settingsBlock,

  // Anchored on the pack: mirrors `rams.packs.get`'s data path (pack row,
  // bound RA versions in binding order, bound COSHH in sort order). Every
  // query is tenant-scoped. Returns '' when the anchor is absent, the
  // pack is missing, or the pack is not a draft — this agent applies only
  // into drafts (the builder gates the trigger the same way).
  buildContext: async ({ db, tenantId, params }) => {
    const packId = params['packId'];
    if (packId === undefined || packId.length !== 26) return '';

    const [pack] = await db
      .select({
        id: ramsPacks.id,
        referenceNumber: ramsPacks.referenceNumber,
        title: ramsPacks.title,
        status: ramsPacks.status,
        clientName: ramsPacks.clientName,
        siteId: ramsPacks.siteId,
        locationText: ramsPacks.locationText,
        plannedFrom: ramsPacks.plannedFrom,
        plannedTo: ramsPacks.plannedTo,
        draftContent: ramsPacks.draftContent,
      })
      .from(ramsPacks)
      .where(and(eq(ramsPacks.tenantId, tenantId), eq(ramsPacks.id, packId)))
      .limit(1);
    if (pack === undefined || pack.status !== 'draft') return '';

    const [site] =
      pack.siteId === null
        ? []
        : await db
            .select({ name: sites.name })
            .from(sites)
            .where(and(eq(sites.tenantId, tenantId), eq(sites.id, pack.siteId)))
            .limit(1);

    // Bound RA versions, in binding order — the same order `packs.get`
    // returns them, which is what the Apply-side key map derives from.
    const bindings = await db
      .select({
        raVersionId: ramsPackRiskAssessments.raVersionId,
      })
      .from(ramsPackRiskAssessments)
      .where(
        and(
          eq(ramsPackRiskAssessments.tenantId, tenantId),
          eq(ramsPackRiskAssessments.packId, pack.id),
        ),
      )
      .orderBy(asc(ramsPackRiskAssessments.sortOrder))
      .limit(50);

    const versionIds = bindings.map((b) => b.raVersionId).filter((v): v is string => v !== null);
    const unpublishedBindings = bindings.length - versionIds.length;

    const versionRows =
      versionIds.length === 0
        ? []
        : await db
            .select({
              id: riskAssessmentVersions.id,
              versionNumber: riskAssessmentVersions.versionNumber,
              content: riskAssessmentVersions.content,
              referenceNumber: riskAssessments.referenceNumber,
            })
            .from(riskAssessmentVersions)
            .innerJoin(riskAssessments, eq(riskAssessments.id, riskAssessmentVersions.assessmentId))
            .where(
              and(
                eq(riskAssessmentVersions.tenantId, tenantId),
                inArray(riskAssessmentVersions.id, versionIds),
              ),
            );
    const versionById = new Map(versionRows.map((r) => [r.id, r]));

    // Keyed hazard table, h1..hn in bound order. The build page's
    // `applyAgentProposal` derives the SAME keys from `packs.get` data —
    // keep the two assignments in lockstep.
    const hazardLines: string[] = [];
    /** Reverse map so the existing draft's hazardRefs print as keys. */
    const keyByRef = new Map<string, string>();
    let hazardCount = 0;
    let overflow = 0;
    for (const versionId of versionIds) {
      const row = versionById.get(versionId);
      if (row === undefined) continue;
      const content = row.content;
      for (const [index, hazard] of content.hazards.entries()) {
        hazardCount += 1;
        if (hazardCount > MAX_KEYED_HAZARDS) {
          overflow += 1;
          continue;
        }
        const key = `h${hazardCount}`;
        keyByRef.set(`${row.id}:${index}`, key);
        const band = bandFor(hazard.residualLikelihood, hazard.residualSeverity, content.matrix);
        const high = band !== 'none' && bandRank(band) >= bandRank(DEFAULT_HIGH_RISK_THRESHOLD);
        hazardLines.push(
          `${key} — [${row.referenceNumber ?? '—'} "${clip(content.title, 120)}" v${row.versionNumber}] ${clip(hazard.hazard, 300)} | Who: ${clip(hazard.affectedGroups.join(', '), 200)} | Controls: ${clip(
            [hazard.existingControls, ...hazard.controls.map((c) => c.description)]
              .filter((s) => s.trim().length > 0)
              .join('; '),
            400,
          )} | Residual band: ${band}${high ? ' (HIGH — must be referenced by at least one step)' : ''}`,
        );
      }
    }

    // Keyed COSHH table, c1..cn in bound order; rows whose substance link
    // is gone get no key (a substanceRef needs a substance id) — both
    // sides skip them identically.
    const coshhRows = await db
      .select({
        substanceId: ramsPackCoshh.substanceId,
        taskDescription: coshhAssessments.taskDescription,
        referenceNumber: coshhAssessments.referenceNumber,
        substanceName: coshhSubstances.name,
      })
      .from(ramsPackCoshh)
      .innerJoin(coshhAssessments, eq(coshhAssessments.id, ramsPackCoshh.coshhAssessmentId))
      .leftJoin(coshhSubstances, eq(coshhSubstances.id, ramsPackCoshh.substanceId))
      .where(and(eq(ramsPackCoshh.tenantId, tenantId), eq(ramsPackCoshh.packId, pack.id)))
      .orderBy(asc(ramsPackCoshh.sortOrder))
      .limit(MAX_KEYED_SUBSTANCES);
    const coshhLines: string[] = [];
    let substanceCount = 0;
    for (const row of coshhRows) {
      if (row.substanceId === null) continue;
      substanceCount += 1;
      coshhLines.push(
        `c${substanceCount} — ${clip(row.substanceName ?? '', 200)} (${row.referenceNumber ?? '—'}): ${clip(row.taskDescription, 300)}`,
      );
    }

    // The author's current draft, compact — refinement must preserve it.
    const draft: MethodStatementContent = pack.draftContent;
    const draftLines: string[] = [];
    if (draft.scopeOfWorks.trim().length > 0) {
      draftLines.push(`Scope of works: ${clip(draft.scopeOfWorks, 1000)}`);
    }
    for (const step of draft.steps) {
      const refs = step.hazardRefs
        .map((r) => keyByRef.get(`${r.raVersionId}:${r.hazardIndex}`) ?? clip(r.hazardLabel, 60))
        .join(', ');
      draftLines.push(
        `Step ${step.sequence}: ${clip(step.title, 200)}${
          step.description.trim().length > 0 ? ` — ${clip(step.description, 500)}` : ''
        }${refs.length > 0 ? ` [hazards: ${refs}]` : ''}${
          step.holdPoint !== null ? ` [hold point: ${step.holdPoint.kind}]` : ''
        }`,
      );
    }
    const emergencyBits = [
      draft.emergency.firstAid.trim().length > 0
        ? `first aid: ${clip(draft.emergency.firstAid, 300)}`
        : '',
      draft.emergency.emergencyProcedure.trim().length > 0
        ? `emergency procedure: ${clip(draft.emergency.emergencyProcedure, 300)}`
        : '',
    ].filter((s) => s.length > 0);
    if (emergencyBits.length > 0)
      draftLines.push(`Emergency block so far — ${emergencyBits.join('; ')}`);

    const fmt = (d: Date | null): string => (d === null ? '—' : d.toISOString().slice(0, 10));
    const parts: string[] = [];
    parts.push(
      `### The RAMS pack this draft is for\nReference: ${pack.referenceNumber ?? '—'}\nTitle: ${clip(pack.title, 200)}\nClient: ${clip(pack.clientName, 200) || '—'}\nSite: ${site?.name ?? '—'}${
        pack.locationText.trim().length > 0 ? ` (${clip(pack.locationText, 300)})` : ''
      }\nPlanned dates: ${fmt(pack.plannedFrom)} to ${fmt(pack.plannedTo)}\nStatus: draft`,
    );
    parts.push(
      draftLines.length > 0
        ? `### Current draft content (preserve and build on this — applying replaces it wholesale)\n${draftLines.join('\n')}`
        : '### Current draft content\nThe draft is empty — you are writing the first version.',
    );
    parts.push(
      hazardLines.length > 0
        ? `### Bound risk-assessment hazards (reference by key; use ONLY these keys)\n${hazardLines.join('\n')}${
            overflow > 0
              ? `\n(${overflow} further bound hazards exceed what can be listed here — tell the author the bindings exceed AI scope and the extra hazards must be referenced by hand in the builder.)`
              : ''
          }${
            unpublishedBindings > 0
              ? `\n(${unpublishedBindings} bound assessment(s) have never been published, so their hazards cannot be referenced yet — the author must publish and re-bind them.)`
              : ''
          }`
        : '### Bound risk-assessment hazards\nNo risk assessments are bound to this pack yet. Draft the steps with empty hazardKeys and tell the author clearly that they must bind the relevant risk assessments in the builder before the pack can be issued.',
    );
    if (coshhLines.length > 0) {
      parts.push(
        `### Bound COSHH assessments (reference by key where the substance is used)\n${coshhLines.join('\n')}`,
      );
    }
    parts.push(
      `### Vocabularies\nPPE items: ${PPE_ITEMS.join(', ')}.\nPersonnel roles: ${PERSONNEL_ROLES.join(', ')}.\nHold-point kinds: ${HOLD_POINT_KINDS.join(', ')}.`,
    );

    let out = parts.join('\n\n');
    if (out.length > MAX_CONTEXT_CHARS) out = `${out.slice(0, MAX_CONTEXT_CHARS)}…`;
    return out;
  },
};
