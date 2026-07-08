/**
 * Claude-vision auto-tagger for site/project media (Phase 2b).
 *
 * Given a photo's bytes it returns a handful of short tags plus a concise
 * caption, used to make the gallery searchable and to suggest a caption when
 * the uploader didn't write one. Best-effort: callers treat a thrown error or
 * empty result as "no tags yet" — auto-tagging must never break an upload.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';
import {
  coerceObservationDraft,
  coerceResult,
  parseJsonObject,
  type MediaVisionResult,
  type ObservationDraft,
} from './site-media-vision-parse';

export type { MediaVisionResult, ObservationDraft } from './site-media-vision-parse';

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const SUPPORTED = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const SYSTEM_PROMPT =
  'You label photos from a workplace health-and-safety / operations platform ' +
  '(inspections, construction sites, factories, facilities). Look at the image and reply ' +
  'with ONLY a JSON object, no prose, of the form ' +
  '{"tags": string[], "caption": string}. ' +
  '`tags` is 3 to 8 short lowercase keywords (single words or two-word phrases) describing ' +
  'what is visible — equipment, materials, hazards, activities, location type. ' +
  '`caption` is one concise factual sentence (max ~120 chars) describing the scene. ' +
  'Do not invent details you cannot see.';

export async function analyzeMediaImage(
  base64: string,
  mediaType: string,
): Promise<MediaVisionResult> {
  if (!SUPPORTED.has(mediaType)) return { tags: [], caption: '' };

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType as ImageMediaType, data: base64 },
          },
          { type: 'text', text: 'Label this photo.' },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  const text = textBlock !== undefined && textBlock.type === 'text' ? textBlock.text : '';
  return coerceResult(parseJsonObject(text));
}

/**
 * Draft a health-and-safety observation from a photo: a short title, a
 * factual description, and the best-matching category name from the tenant's
 * existing categories (empty string if none fit). Best-effort — an empty title
 * signals "couldn't draft" to the caller.
 */
export async function draftObservationFromImage(
  base64: string,
  mediaType: string,
  categoryNames: readonly string[],
): Promise<ObservationDraft> {
  if (!SUPPORTED.has(mediaType)) return { title: '', description: '', category: '' };

  const catList =
    categoryNames.length > 0
      ? `Choose the single best-fitting category from this exact list: ${categoryNames
          .map((c) => `"${c}"`)
          .join(', ')}. Use "" if none fit.`
      : 'There are no categories; use "" for category.';

  const system =
    'You help a health-and-safety / quality manager raise an observation from a site photo. ' +
    'Look at the image and reply with ONLY a JSON object of the form ' +
    '{"title": string, "description": string, "category": string}. ' +
    '`title` is a short specific summary (max ~80 chars) of the issue or thing observed. ' +
    '`description` is 1-3 factual sentences describing what is visible and any apparent hazard or concern. ' +
    `${catList} ` +
    'Report only what is visible; do not invent context.';

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 600,
    system,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType as ImageMediaType, data: base64 },
          },
          { type: 'text', text: 'Draft an observation for this photo.' },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  const text = textBlock !== undefined && textBlock.type === 'text' ? textBlock.text : '';
  return coerceObservationDraft(parseJsonObject(text));
}

export interface MediaImageInput {
  base64: string;
  mediaType: string;
  /** Human label for the image, e.g. a date, shown to the model for context. */
  label: string;
}

/**
 * Compare two site photos taken at different times and describe what changed.
 * The first input is treated as the earlier ("before") image, the second as
 * the later ("after"). Returns freeform markdown; empty string on failure.
 */
export async function compareMediaImages(
  before: MediaImageInput,
  after: MediaImageInput,
): Promise<string> {
  if (!SUPPORTED.has(before.mediaType) || !SUPPORTED.has(after.mediaType)) return '';

  const system =
    'You compare two progress photos of the same site/project taken at different times, for a ' +
    'health-and-safety / operations manager. The first image is the EARLIER state, the second is ' +
    'the LATER state. Describe concisely what has changed between them using short markdown bullet ' +
    'points grouped under **Progress**, **New concerns**, and **Resolved / removed** (omit a group ' +
    'if empty). Note new hazards, added or removed equipment/materials, and work completed. If the ' +
    'two photos appear to show different places, say so plainly. Report only what is visible.';

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 900,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `Earlier image (${before.label}):` },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: before.mediaType as ImageMediaType,
              data: before.base64,
            },
          },
          { type: 'text', text: `Later image (${after.label}):` },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: after.mediaType as ImageMediaType,
              data: after.base64,
            },
          },
          { type: 'text', text: 'What changed between the earlier and later photo?' },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  return textBlock !== undefined && textBlock.type === 'text' ? textBlock.text : '';
}
