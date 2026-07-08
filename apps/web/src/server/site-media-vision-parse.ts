/**
 * Pure parsing/normalisation helpers for the site-media vision tagger,
 * split out from site-media-vision.ts so they can be unit-tested without
 * importing the Anthropic SDK or the server env (which parses on load).
 */
export interface MediaVisionResult {
  tags: readonly string[];
  caption: string;
}

export function coerceResult(raw: unknown): MediaVisionResult {
  if (typeof raw !== 'object' || raw === null) return { tags: [], caption: '' };
  const obj = raw as Record<string, unknown>;
  const tags = Array.isArray(obj.tags)
    ? obj.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 40)
        .slice(0, 8)
    : [];
  const caption = typeof obj.caption === 'string' ? obj.caption.trim().slice(0, 200) : '';
  return { tags, caption };
}

export interface ObservationDraft {
  title: string;
  description: string;
  category: string;
}

export function coerceObservationDraft(raw: unknown): ObservationDraft {
  if (typeof raw !== 'object' || raw === null) return { title: '', description: '', category: '' };
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 500) : '';
  const description =
    typeof obj.description === 'string' ? obj.description.trim().slice(0, 20_000) : '';
  const category = typeof obj.category === 'string' ? obj.category.trim() : '';
  return { title, description, category };
}

/** Extract the first JSON object from a model text response. */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
