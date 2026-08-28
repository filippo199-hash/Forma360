/**
 * ra-drafter — the Risk Assessment Drafter task agent (FreeHS module B1).
 *
 * Turns a one-line description of a job or activity into a complete
 * HSE five-step risk-assessment DRAFT: hazards, who might be harmed,
 * initial/residual scores against the tenant's own matrix, and tiered
 * controls. Apply (client-side, `risk-assessments/page.tsx`) maps the
 * proposal onto the module's ordinary tRPC mutations — `create`,
 * `update`, `addHazard`, `addControl` — so every tenant/permission
 * check runs as the signed-in user, and the result is a plain draft the
 * editor finishes. `publish` is never touched: publishing stays a
 * signed act by a competent person (ADR 0011).
 *
 * The proposal schema's refines deliberately mirror the router's
 * `validateHazardsForPublish` gates (residual ≤ initial, high/critical
 * residual needs a planned control or a justification, PPE-only needs a
 * PPE justification) so an applied draft is already publish-shaped. The
 * band refine evaluates against DEFAULT_RISK_MATRIX — the tenant's own
 * snapshot is only known at apply time — so a stricter tenant matrix may
 * still ask for a justification in the editor at publish; that is the
 * editor's job, not a failure here. If the router's publish rules change,
 * change this schema in the same PR (the DH-E21 coupling discipline).
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  AFFECTED_GROUP_PRESETS,
  CONTROL_STATUSES,
  CONTROL_TIERS,
  RISK_ASSESSMENT_TYPES,
  riskAssessments,
  sites,
  tenantRiskMatrixSettings,
} from '@forma360/db/schema';
import { DEFAULT_RISK_MATRIX, bandFor, type RiskMatrixConfig } from '@forma360/shared/risk-matrix';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { activeBrand } from '../../lib/brand';
import { HAZARD_LIBRARY } from '../../lib/hazard-library';
import type { TaskAgentServerDef } from './index';

const score = z.number().int().min(1).max(5);

const controlSchema = z.object({
  description: z.string().min(1).max(1000),
  tier: z.enum(CONTROL_TIERS),
  status: z.enum(CONTROL_STATUSES).default('in_place'),
  ppeJustification: z.string().min(1).max(1000).optional(),
});

const hazardSchema = z
  .object({
    hazard: z.string().min(1).max(500),
    harmDescription: z.string().max(2000).default(''),
    affectedGroups: z.array(z.string().min(1).max(100)).max(20).default([]),
    initialLikelihood: score,
    initialSeverity: score,
    existingControls: z.string().max(4000).default(''),
    residualLikelihood: score,
    residualSeverity: score,
    residualJustification: z.string().max(2000).default(''),
    controls: z.array(controlSchema).max(15).default([]),
  })
  .superRefine((h, ctx) => {
    if (h.residualLikelihood * h.residualSeverity > h.initialLikelihood * h.initialSeverity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Hazard "${h.hazard.slice(0, 60)}": residual risk must not exceed initial risk`,
      });
    }
    // Mirrors the publish gate: a high/critical residual needs either a
    // planned improvement or a written justification. Evaluated against
    // the default matrix (the tenant snapshot lives server-side at apply).
    const band = bandFor(h.residualLikelihood, h.residualSeverity, DEFAULT_RISK_MATRIX);
    const hasPlanned = h.controls.some((c) => c.status === 'planned');
    if (
      (band === 'high' || band === 'critical') &&
      !hasPlanned &&
      h.residualJustification.trim().length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Hazard "${h.hazard.slice(0, 60)}": a high or critical residual risk needs either a planned control or a residualJustification explaining why the risk is tolerable`,
      });
    }
    if (
      h.controls.length > 0 &&
      h.controls.every((c) => c.tier === 'ppe') &&
      !h.controls.some(
        (c) => c.ppeJustification !== undefined && c.ppeJustification.trim().length > 0,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Hazard "${h.hazard.slice(0, 60)}": PPE-only controls need a ppeJustification on at least one control explaining why higher-tier controls are not reasonably practicable`,
      });
    }
  });

const proposalSchema = z.object({
  title: z.string().min(1).max(200),
  activity: z.string().max(2000).default(''),
  type: z.enum(RISK_ASSESSMENT_TYPES).default('standing'),
  siteId: z.string().length(26).optional(),
  locationText: z.string().max(500).optional(),
  reviewFrequencyMonths: z.number().int().min(1).max(60).optional(),
  /** Plain-English decision summary — every agent proposal carries one. */
  summary: z.string().min(1).max(2000),
  hazards: z.array(hazardSchema).min(1).max(20),
});

export type RaDrafterProposal = z.infer<typeof proposalSchema>;

const proposeTool: Anthropic.Tool = {
  name: 'proposeRiskAssessment',
  description:
    'Propose a complete five-step risk-assessment draft. Call this in the same turn you decide to draft. The draft is reviewed and applied by the user — nothing is published or signed.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Assessment title, max 200 chars.' },
      activity: {
        type: 'string',
        description: 'What the task involves, in plain prose. Max 2000 chars.',
      },
      type: { type: 'string', enum: ['standing', 'dynamic'] },
      siteId: {
        type: 'string',
        description:
          'One of the site ids from the provided context, only when the brief clearly matches that site. Omit otherwise.',
      },
      locationText: {
        type: 'string',
        description: 'Finer free-text location, e.g. "Loading bay 2". Max 500 chars.',
      },
      reviewFrequencyMonths: {
        type: 'integer',
        minimum: 1,
        maximum: 60,
        description:
          'Only when the brief or company knowledge implies a non-default review cadence; omit otherwise.',
      },
      summary: {
        type: 'string',
        description:
          '2-4 plain-English sentences a non-technical manager reads to decide whether to apply: what was drafted, the key assumptions made, and what they should double-check.',
      },
      hazards: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            hazard: { type: 'string' },
            harmDescription: {
              type: 'string',
              description: 'Concrete injury / ill-health outcome, not a restatement of the hazard.',
            },
            affectedGroups: {
              type: 'array',
              items: { type: 'string' },
              description: 'Preset slugs from the context, plus free text where named.',
            },
            initialLikelihood: { type: 'integer', minimum: 1, maximum: 5 },
            initialSeverity: { type: 'integer', minimum: 1, maximum: 5 },
            existingControls: {
              type: 'string',
              description: 'Free-text controls already in place; may be empty.',
            },
            residualLikelihood: { type: 'integer', minimum: 1, maximum: 5 },
            residualSeverity: { type: 'integer', minimum: 1, maximum: 5 },
            residualJustification: {
              type: 'string',
              description:
                'Required when the residual band is high/critical and no control below is planned.',
            },
            controls: {
              type: 'array',
              maxItems: 15,
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  tier: {
                    type: 'string',
                    enum: ['eliminate', 'substitute', 'engineering', 'administrative', 'ppe'],
                  },
                  status: { type: 'string', enum: ['in_place', 'planned'] },
                  ppeJustification: {
                    type: 'string',
                    description:
                      'Why higher-tier controls are not reasonably practicable — required when a hazard has only PPE controls.',
                  },
                },
                required: ['description', 'tier'],
              },
            },
          },
          required: [
            'hazard',
            'harmDescription',
            'initialLikelihood',
            'initialSeverity',
            'residualLikelihood',
            'residualSeverity',
          ],
        },
      },
    },
    required: ['title', 'summary', 'hazards'],
  },
};

const basePrompt = `You are a risk-assessment drafting assistant for ${activeBrand.name}, working to the HSE's five-step method: identify hazards; decide who might be harmed and how; evaluate the risks and decide on controls; record the findings; review. You write practitioner-quality first drafts that a competent person will review, amend and sign. You are British: use British English spelling and UK HSE terminology throughout (e.g. "risk assessment", "control measure", "competent person", "PPE", "so far as is reasonably practicable").

You will be given: (a) the company's own knowledge — their conventions, standard controls, workforce groups and site specifics; treat it as authoritative for wording and local practice and prefer it over generic phrasing; (b) the company's risk matrix (band thresholds and any severity floors) — score against it; (c) their sites (with ids), the affected-group presets, and recent assessment titles.

How to work:
1. Read the user's brief. If it is genuinely too thin to draft from (no identifiable activity, or you cannot tell the setting), ask AT MOST 2-3 short clarifying questions — all together in ONE message, never one at a time, and never a second round. Good questions: what the activity actually involves, where it happens, who does it. Otherwise do not ask: draft. Lean strongly toward drafting; the user refines everything in the editor afterwards.
2. When you draft, call the proposeRiskAssessment tool IN THE SAME TURN. You may write one short sentence first ("Drafting that now…"), but never end a turn promising a draft without the tool call.
3. Every tool call MUST include a "summary" field: 2-4 plain-English sentences a non-technical manager reads to decide whether to apply — what was drafted, the key assumptions you made, and what they should double-check.

Drafting rules:
- 3-10 hazards for a typical activity; each specific to the task, not boilerplate. For each: a concrete harm description (injury/ill-health outcome, not a restatement of the hazard), affected groups (prefer the provided presets; add free-text groups like "agency night staff" only when the brief or company knowledge names them), and scores.
- Scoring is likelihood 1-5 × severity 1-5, for initial risk (before the controls you propose) and residual risk (with all proposed in-place controls). Residual must never exceed initial. Score honestly against the company's matrix: do not deflate severity to dodge a band — severity floors exist precisely so a rare fatality risk is not called "low". If a residual lands high or critical, either include a planned (not-yet-in-place) control that would reduce it, or write a clear residualJustification saying why the risk is tolerable.
- Controls follow the hierarchy of control and each carries a tier: eliminate, substitute, engineering, administrative, ppe. Start at the top of the hierarchy; never propose only PPE for a hazard unless you also give a ppeJustification explaining why higher-tier controls are not reasonably practicable. Mark controls the brief or company knowledge says already exist as "in_place"; mark genuine improvements as "planned" (each planned control becomes an action needing an owner at publish, so propose them only where they earn their place).
- Set siteId only if the brief clearly matches one of the provided sites (use its id exactly); otherwise leave it unset. Use locationText for anything finer ("Loading bay 2").
- Avoid duplicating an existing assessment title you were shown; if the brief looks like a duplicate, say so in one line and draft anyway with a distinct title.

You produce DRAFTS only. Never state or imply that the assessment is published, signed off, approved, distributed or in force — publishing is a separate signed act by a competent person, and your output is a starting point they must verify. Do not present anything as legal advice or regulatory compliance.`;

function settingsBlock(settings: Record<string, string>): string {
  // Catalogue entry for ra-drafter carries the shared "detail" dial only;
  // 'standard' (the default) adds no prompt line.
  const detail = settings['detail'];
  if (detail === 'concise') {
    return 'Draft detail: concise — keep to the few most significant hazards (3-5) with short, direct harm descriptions and control wording.';
  }
  if (detail === 'thorough') {
    return 'Draft detail: thorough — cover the full spread of credible hazards (towards the top of the 3-10 range) with fuller harm descriptions and complete control sets at every practicable tier.';
  }
  return '';
}

function describeMatrix(matrix: RiskMatrixConfig): string {
  const lines = [
    `Score = likelihood (1-5) × severity (1-5), so 1-25.`,
    `Bands: low = score ≤ ${matrix.lowMax}; medium = score ≤ ${matrix.mediumMax}; high = score ≤ ${matrix.highMax}; critical = above ${matrix.highMax}.`,
  ];
  const floors = Object.entries(matrix.severityFloors ?? {}).filter(([, band]) => band.length > 0);
  if (floors.length > 0) {
    lines.push(
      `Severity floors (minimum band regardless of likelihood): ${floors
        .map(([severity, band]) => `severity ${severity} ⇒ at least ${band}`)
        .join('; ')}.`,
    );
  } else {
    lines.push('No severity floors are configured; thresholds alone decide the band.');
  }
  return lines.join('\n');
}

export const raDrafter: TaskAgentServerDef = {
  agentId: 'ra-drafter',
  basePrompt,
  proposeTool,
  parseProposal: (input: unknown) => proposalSchema.parse(input),
  settingsBlock,
  // No anchor params: the agent creates a new assessment from the register
  // page, so the context is catalogue-level, never per-record.
  buildContext: async ({ db, tenantId }) => {
    const siteRows = await db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), isNull(sites.archivedAt)))
      .orderBy(sites.name)
      .limit(200);

    const [matrixRow] = await db
      .select()
      .from(tenantRiskMatrixSettings)
      .where(eq(tenantRiskMatrixSettings.tenantId, tenantId))
      .limit(1);
    const matrix: RiskMatrixConfig =
      matrixRow !== undefined
        ? {
            lowMax: matrixRow.lowMax,
            mediumMax: matrixRow.mediumMax,
            highMax: matrixRow.highMax,
            severityFloors: matrixRow.severityFloors,
          }
        : DEFAULT_RISK_MATRIX;

    const recentRows = await db
      .select({ title: riskAssessments.title, referenceNumber: riskAssessments.referenceNumber })
      .from(riskAssessments)
      .where(and(eq(riskAssessments.tenantId, tenantId), isNull(riskAssessments.archivedAt)))
      .orderBy(desc(riskAssessments.createdAt))
      .limit(100);

    const parts: string[] = [];
    parts.push(
      siteRows.length > 0
        ? `### Sites (id — name; use the id exactly, or omit siteId)\n${siteRows
            .map((s) => `${s.id} — ${s.name}`)
            .join('\n')}`
        : '### Sites\nThis company has no sites recorded — always omit siteId and rely on locationText.',
    );
    parts.push(`### This company's risk matrix (score against it)\n${describeMatrix(matrix)}`);
    parts.push(
      `### Vocabularies\nAssessment types: ${RISK_ASSESSMENT_TYPES.join(', ')}.\nControl tiers (hierarchy order): ${CONTROL_TIERS.join(', ')}.\nAffected-group presets (prefer these slugs): ${AFFECTED_GROUP_PRESETS.join(', ')}.`,
    );
    parts.push(
      `### Hazard style exemplars (typical hazard titles in this product)\n${HAZARD_LIBRARY.map(
        (h) => h.label,
      ).join('; ')}`,
    );
    if (recentRows.length > 0) {
      parts.push(
        `### Recent assessments in this company (avoid duplicate titles)\n${recentRows
          .map((r) => `${r.referenceNumber ?? '—'} — ${r.title}`)
          .join('\n')}`,
      );
    }
    return parts.join('\n\n');
  },
};
