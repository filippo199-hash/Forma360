/**
 * Claude helper for asset-category field suggestions.
 *
 * The curated library in `lib/asset-field-library.ts` answers the common
 * categories instantly and for free. This is the fallback for everything
 * else — "Autoclaves", "Dust extraction units", "Catering equipment" —
 * so an unusual register still gets a sensible starting point instead of
 * an empty form.
 *
 * Suggestions only, exactly like `recommendCoshhControls`: nothing is
 * persisted here, the practitioner ticks what they want, and the
 * deterministic tRPC mutation stays the single write path.
 *
 * Model: claude-opus-5, matching the other AI surfaces.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from './env';

const MODEL = 'claude-opus-5';

export const assetFieldSuggestionSchema = z.object({
  fields: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        fieldType: z.enum(['text', 'number', 'date', 'select']),
        options: z.array(z.string().min(1).max(60)).max(10).default([]),
        recommended: z.boolean(),
        hint: z.string().max(200).default(''),
      }),
    )
    .max(10)
    .default([]),
});
export type AssetFieldSuggestion = z.infer<typeof assetFieldSuggestionSchema>;

const SUGGEST_TOOL: Anthropic.Tool = {
  name: 'proposeFields',
  description:
    'Propose the custom fields an asset register should hold for this category. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        description:
          'Between 3 and 8 fields. Each must be something a health-and-safety asset register would genuinely record about ONE unit of this category — identifiers, statutory inspection or service dates, ratings and capacities. Do NOT propose fields the platform already stores on every asset: name, description, category, site, owner, parent, photo, or QR code. Do not propose free-text notes.',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Short label as it appears above the input, e.g. "LOLER examination due", "Safe working load (kg)". Include the unit in the label where one applies.',
            },
            fieldType: {
              type: 'string',
              enum: ['text', 'number', 'date', 'select'],
              description:
                'Use date for anything that expires or falls due, number for a measured quantity, select when there is a small fixed set of answers, otherwise text.',
            },
            options: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Only for fieldType "select": 2-6 mutually exclusive choices. Empty array otherwise.',
            },
            recommended: {
              type: 'boolean',
              description:
                'True for the two or three fields that are near-essential for this category — these arrive pre-ticked. False for the useful-but-optional rest.',
            },
            hint: {
              type: 'string',
              description:
                'One short sentence saying why this field earns its place, shown under the checkbox. Practical, not generic.',
            },
          },
          required: ['name', 'fieldType', 'recommended'],
        },
      },
    },
    required: ['fields'],
  },
};

/**
 * Suggest fields for a category name the curated library does not cover.
 * Returns an empty list rather than throwing when the model declines —
 * an empty suggestion is a perfectly good answer, and the user can just
 * add fields by hand.
 */
export async function suggestAssetFields(input: {
  categoryName: string;
  /** Existing category names, so suggestions fit the tenant's conventions. */
  existingCategories: ReadonlyArray<string>;
}): Promise<AssetFieldSuggestion> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const system =
    'You help a UK health-and-safety practitioner set up an asset register. ' +
    'Given a category of asset, propose the handful of custom fields that register should hold about each unit. ' +
    'Favour statutory and maintenance realities: inspection and examination due dates, ratings, capacities, identifiers. ' +
    'Be specific to the category — a generic list is worse than none. ' +
    'If the category name is too vague to say anything useful, return an empty fields array. ' +
    'Call proposeFields exactly once.';

  const context =
    input.existingCategories.length > 0
      ? `\n\nCategories this organisation already uses (match their naming style): ${input.existingCategories.slice(0, 20).join(', ')}`
      : '';

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    system,
    tools: [SUGGEST_TOOL],
    messages: [
      {
        role: 'user',
        content: `Asset category: "${input.categoryName}"${context}\n\nPropose the custom fields by calling proposeFields.`,
      },
    ],
  });

  const finalMsg = await stream.finalMessage();
  const toolBlock = finalMsg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'proposeFields',
  );
  if (toolBlock === undefined) return { fields: [] };
  return assetFieldSuggestionSchema.parse(toolBlock.input);
}
