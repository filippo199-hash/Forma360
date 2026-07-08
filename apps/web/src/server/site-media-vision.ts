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
import { coerceResult, parseJsonObject, type MediaVisionResult } from './site-media-vision-parse';

export type { MediaVisionResult } from './site-media-vision-parse';

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
