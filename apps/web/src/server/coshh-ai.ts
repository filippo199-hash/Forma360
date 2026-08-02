/**
 * Claude helpers for the COSHH module (FreeHS B2).
 *
 * Three surfaces, all designed so the practitioner types as little as
 * possible:
 *   - `extractSdsFromPdf` — reads an uploaded safety data sheet natively
 *     (PDF document block) and returns the full hazard profile: product
 *     identity, GHS classification, H/P statements, pictograms, WELs,
 *     storage guidance and the sheet's issue date. Everything passes
 *     through `sdsExtractionSchema` before anyone trusts it (ground
 *     rule 2), with a correction loop when the model's tool call fails
 *     validation.
 *   - `recommendCoshhControls` — suggests hierarchy-of-control entries
 *     for a task, substitution first, engineering before RPE, with the
 *     substance's real hazard profile as input. Suggestions only — the
 *     assessor accepts or edits each one; nothing is persisted here.
 *   - `writeCoshhPlainSummary` — drafts the task-level plain-language
 *     summary for the people using the substance, in the caller's
 *     locale.
 *
 * Model: claude-opus-5 (successor to the opus-4-8 used by the earlier
 * AI surfaces — same pricing, drop-in upgrade). Streaming keeps long
 * extractions inside HTTP timeouts.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  GHS_PICTOGRAMS,
  parseSdsExtraction,
  PHYSICAL_FORMS,
  SIGNAL_WORDS,
  WEL_UNITS,
  type SdsExtraction,
} from '@forma360/shared/coshh';
import { COSHH_CONTROL_TIERS } from '@forma360/db/schema';
import { z } from 'zod';
import { env } from './env';

const MODEL = 'claude-opus-5';

// ─── SDS extraction ─────────────────────────────────────────────────────────

const welLimitJsonSchema = {
  type: 'object' as const,
  properties: {
    value: { type: 'number' as const, description: 'The numeric limit value.' },
    unit: { type: 'string' as const, enum: [...WEL_UNITS] },
  },
  required: ['value', 'unit'],
};

/**
 * Tool schema mirroring `sdsExtractionSchema`. The model must call this
 * exactly once; the input is then validated by the Zod schema (which is
 * stricter — H/P-code regexes — and produces the typed object).
 */
const RECORD_SDS_TOOL: Anthropic.Tool = {
  name: 'recordSdsData',
  description:
    'Record the structured data extracted from the safety data sheet. Call exactly once with everything you could read.',
  input_schema: {
    type: 'object',
    properties: {
      productName: {
        type: 'string',
        description: 'Product / trade name from SDS section 1.',
      },
      supplier: { type: 'string', description: 'Supplier or manufacturer name from section 1.' },
      productIdentifier: {
        type: 'string',
        description: 'Catalogue number, article number or UFI if present, else empty string.',
      },
      physicalForm: {
        type: ['string', 'null'],
        enum: [...PHYSICAL_FORMS],
        description: 'Physical form as supplied (section 9), null if unclear.',
      },
      signalWord: {
        type: ['string', 'null'],
        enum: [...SIGNAL_WORDS],
        description: 'GHS signal word from section 2, null if none.',
      },
      hazardClassification: {
        type: 'array',
        items: { type: 'string' },
        description: 'GHS/CLP hazard classes from section 2, e.g. "Flam. Liq. 2", "Skin Corr. 1B".',
      },
      hStatements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'e.g. H225, H350i, EUH066' },
            text: { type: 'string', description: 'The statement wording.' },
          },
          required: ['code', 'text'],
        },
        description: 'Hazard statements from section 2.',
      },
      pStatements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'e.g. P210, P305+P351+P338' },
            text: { type: 'string', description: 'The statement wording.' },
          },
          required: ['code', 'text'],
        },
        description: 'Precautionary statements from section 2.',
      },
      pictograms: {
        type: 'array',
        items: { type: 'string', enum: [...GHS_PICTOGRAMS] },
        description:
          'GHS pictogram codes from section 2. Map names to codes: explosive=GHS01, flame=GHS02, flame over circle (oxidising)=GHS03, gas cylinder=GHS04, corrosion=GHS05, skull and crossbones=GHS06, exclamation mark=GHS07, health hazard (silhouette)=GHS08, environment=GHS09.',
      },
      workplaceExposureLimits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'The constituent the limit applies to.' },
            twa8h: { ...welLimitJsonSchema, description: '8-hour TWA limit, null if not listed.' },
            stel15min: {
              ...welLimitJsonSchema,
              description: '15-minute STEL, null if not listed.',
            },
            source: { type: 'string', description: 'e.g. "EH40 WEL", empty if unstated.' },
          },
          required: ['agent'],
        },
        description:
          'Occupational exposure limits from section 8. Prefer UK EH40 WELs when several jurisdictions are listed.',
      },
      storageRequirements: {
        type: 'string',
        description: 'Condensed storage guidance from section 7 (2-3 sentences max).',
      },
      issueDate: {
        type: ['string', 'null'],
        description: 'Revision / issue date of the sheet as ISO yyyy-mm-dd, null if absent.',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description:
          'Your extraction quality: high = clean SDS, everything read; low = scan/partial/uncertain.',
      },
    },
    required: ['productName', 'confidence'],
  },
};

const SDS_SYSTEM_PROMPT =
  'You read safety data sheets (SDS / MSDS) for a COSHH management platform used by UK health-and-safety practitioners. ' +
  'Extract only what the document states — never invent hazard data, statements, limits or dates. ' +
  'If a field is absent or illegible, leave it empty/null and reflect that in `confidence`. ' +
  'Normalise H/P codes to their standard form (H225, P305+P351+P338). ' +
  'For workplace exposure limits prefer UK EH40 values; convert nothing — record the value and unit as printed. ' +
  'Call recordSdsData exactly once. Do not ask questions.';

/**
 * Extract the hazard profile from an SDS PDF. Throws on non-PDF input,
 * or when the model cannot produce a valid extraction after 3 attempts.
 */
export async function extractSdsFromPdf(input: {
  filename: string;
  bytes: Uint8Array;
}): Promise<SdsExtraction> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const base64 = Buffer.from(input.bytes).toString('base64');

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        {
          type: 'text',
          text: `Extract the COSHH-relevant data from this safety data sheet ("${input.filename}") by calling recordSdsData.`,
        },
      ],
    },
  ];

  let attempts = 0;
  while (true) {
    attempts += 1;
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: SDS_SYSTEM_PROMPT,
      tools: [RECORD_SDS_TOOL],
      messages,
    });
    const finalMsg = await stream.finalMessage();

    const toolBlock = finalMsg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'recordSdsData',
    );

    if (toolBlock !== undefined) {
      try {
        return parseSdsExtraction(toolBlock.input);
      } catch (err) {
        if (attempts >= 3) {
          throw err instanceof Error ? err : new Error('Invalid SDS extraction');
        }
        messages.push({ role: 'assistant', content: finalMsg.content });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: `The extraction was invalid: ${
                err instanceof Error ? err.message : 'unknown error'
              }. Call recordSdsData again with corrected data (fix the named fields; drop entries you cannot normalise).`,
              is_error: true,
            },
          ],
        });
        continue;
      }
    }

    if (attempts >= 3) {
      throw new Error('Could not read the safety data sheet.');
    }
    messages.push({ role: 'assistant', content: finalMsg.content });
    messages.push({
      role: 'user',
      content: 'Please record the extracted data now by calling recordSdsData.',
    });
  }
}

// ─── Control recommendations ────────────────────────────────────────────────

export const coshhRecommendationSchema = z.object({
  controls: z
    .array(
      z.object({
        tier: z.enum(COSHH_CONTROL_TIERS),
        description: z.string().min(1).max(500),
        rationale: z.string().max(500).default(''),
      }),
    )
    .min(1)
    .max(12),
  /** Concrete substitution idea when one plausibly exists, else empty. */
  substitutionSuggestion: z.string().max(600).default(''),
  levRecommended: z.boolean(),
  healthSurveillanceRecommended: z.boolean(),
  exposureMonitoringRecommended: z.boolean(),
});
export type CoshhRecommendation = z.infer<typeof coshhRecommendationSchema>;

const RECOMMEND_TOOL: Anthropic.Tool = {
  name: 'proposeControls',
  description: 'Propose the control measures for this COSHH assessment. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      controls: {
        type: 'array',
        description:
          'Ordered by the hierarchy of control: elimination, substitution, engineering, administrative, rpe, ppe. 3-8 entries. Every entry must be specific to THIS task and substance, not generic boilerplate.',
        items: {
          type: 'object',
          properties: {
            tier: { type: 'string', enum: [...COSHH_CONTROL_TIERS] },
            description: {
              type: 'string',
              description:
                'The control measure, concrete and actionable (equipment class, spec or practice — e.g. "On-tool M-class extraction", not "use extraction").',
            },
            rationale: {
              type: 'string',
              description: 'One sentence: why this control, tied to the hazard profile.',
            },
          },
          required: ['tier', 'description'],
        },
      },
      substitutionSuggestion: {
        type: 'string',
        description:
          'If a safer alternative product/process is plausibly available, name it in one sentence. Empty string otherwise. Never invent a specific commercial product that may not exist — describe the class of alternative.',
      },
      levRecommended: {
        type: 'boolean',
        description: 'True when local exhaust ventilation should control this exposure.',
      },
      healthSurveillanceRecommended: {
        type: 'boolean',
        description:
          'True when health surveillance is indicated (e.g. asthmagens, sensitisers, lead).',
      },
      exposureMonitoringRecommended: {
        type: 'boolean',
        description: 'True when exposure monitoring against a WEL is indicated.',
      },
    },
    required: [
      'controls',
      'levRecommended',
      'healthSurveillanceRecommended',
      'exposureMonitoringRecommended',
    ],
  },
};

export interface CoshhRecommendationInput {
  substanceName: string;
  physicalForm: string | null;
  hazardClassification: ReadonlyArray<string>;
  hStatements: ReadonlyArray<{ code: string; text: string }>;
  regimes: {
    carcinogen: boolean;
    mutagen: boolean;
    asthmagen: boolean;
    biologicalAgent: boolean;
    lead: boolean;
  };
  workplaceExposureLimits: ReadonlyArray<{ agent: string }>;
  taskDescription: string;
  routesOfExposure: ReadonlyArray<string>;
  quantityBand: string | null;
  frequencyBand: string | null;
  durationBand: string | null;
}

/**
 * Suggest hierarchy-of-control entries for one assessment. The prompt
 * enforces substitution-first thinking and demands a justification framing
 * whenever RPE/PPE is proposed as a primary control.
 */
export async function recommendCoshhControls(
  input: CoshhRecommendationInput,
): Promise<CoshhRecommendation> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const system =
    'You are an experienced UK occupational-hygiene practitioner drafting COSHH control measures. ' +
    'Follow COSHH regulation 7: consider elimination and substitution FIRST (mandatory consideration for carcinogens and mutagens), ' +
    'then engineering controls (enclosure, LEV), then administrative measures, and only then RPE / other PPE — ' +
    'if you propose RPE or PPE as the main control, the rationale must say why higher-order controls are not reasonably practicable. ' +
    'Ground every suggestion in the given hazard profile and task; do not pad with generic advice. ' +
    'Call proposeControls exactly once.';

  const profile = [
    `Substance: ${input.substanceName}`,
    `Physical form: ${input.physicalForm ?? 'unknown'}`,
    `Classification: ${input.hazardClassification.join(', ') || 'none recorded'}`,
    `H statements: ${input.hStatements.map((h) => `${h.code} (${h.text})`).join('; ') || 'none recorded'}`,
    `Special regimes: ${
      Object.entries(input.regimes)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ') || 'none'
    }`,
    `Agents with WELs: ${input.workplaceExposureLimits.map((w) => w.agent).join(', ') || 'none'}`,
    '',
    `Task: ${input.taskDescription}`,
    `Routes of exposure: ${input.routesOfExposure.join(', ') || 'not yet recorded'}`,
    `Quantity band: ${input.quantityBand ?? 'not set'}; frequency: ${input.frequencyBand ?? 'not set'}; duration: ${input.durationBand ?? 'not set'}`,
  ].join('\n');

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    system,
    tools: [RECOMMEND_TOOL],
    messages: [
      {
        role: 'user',
        content: `Propose control measures for this assessment by calling proposeControls.\n\n${profile}`,
      },
    ],
  });
  const finalMsg = await stream.finalMessage();
  const toolBlock = finalMsg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'proposeControls',
  );
  if (toolBlock === undefined) {
    throw new Error('No control proposal produced.');
  }
  return coshhRecommendationSchema.parse(toolBlock.input);
}

// ─── Plain-language task summary ────────────────────────────────────────────

export interface CoshhSummaryInput {
  substanceName: string;
  signalWord: string | null;
  hStatements: ReadonlyArray<{ code: string; text: string }>;
  taskDescription: string;
  routesOfExposure: ReadonlyArray<string>;
  controls: ReadonlyArray<{ tier: string; description: string }>;
  emergencyNotes: string;
  /** BCP-47 locale of the requesting user, e.g. "en", "it". */
  locale: string;
}

/**
 * Draft the task-level plain-language summary — what the person doing the
 * job needs to know, not the file copy. Returns markdown-free plain text.
 */
export async function writeCoshhPlainSummary(input: CoshhSummaryInput): Promise<string> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const system =
    'You write task-level COSHH summaries for the people actually using a hazardous substance — not for the safety file. ' +
    'Plain language, second person, no jargon, no regulation numbers. Structure: what the product is and what it can do to you; ' +
    'how you could be exposed doing this task; the controls you must use (in the order that matters); what to do if something goes wrong. ' +
    'Maximum ~150 words. Plain text only — no markdown, no headings. ' +
    `Write in the language of locale "${input.locale}".`;

  const controlsText = input.controls.map((c) => `- [${c.tier}] ${c.description}`).join('\n');
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [
      {
        role: 'user',
        content:
          `Substance: ${input.substanceName} (signal word: ${input.signalWord ?? 'none'})\n` +
          `Hazards: ${input.hStatements.map((h) => h.text).join('; ') || 'none recorded'}\n` +
          `Task: ${input.taskDescription}\n` +
          `Exposure routes: ${input.routesOfExposure.join(', ') || 'not recorded'}\n` +
          `Controls:\n${controlsText || '- none recorded yet'}\n` +
          `Emergency notes: ${input.emergencyNotes || 'none recorded'}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Could not draft the summary.');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  const text = textBlock !== undefined && textBlock.type === 'text' ? textBlock.text.trim() : '';
  if (text.length === 0) throw new Error('Could not draft the summary.');
  return text;
}
