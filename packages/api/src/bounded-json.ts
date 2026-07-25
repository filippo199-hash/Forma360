/**
 * Bounded JSON record — a shared Zod schema for client-supplied objects that
 * are persisted verbatim into a JSONB column (custom-field values, question
 * responses, site metadata, saved-view config). A plain `z.record(z.unknown())`
 * accepts an object of any size and any nesting depth, so a client can post a
 * multi-megabyte or pathologically deep payload and we store it as-is —
 * storage bloat plus parse/serialize cost on every read. This adds a size and
 * a depth bound while keeping the exact same `Record<string, unknown>` output
 * type, so it is a drop-in replacement at every persisted-input boundary
 * ("Zod at every boundary", CLAUDE.md rule 2).
 */
import { z } from 'zod';

/** 64 KB serialized — generous headroom for legitimate custom fields. */
export const MAX_JSON_BYTES = 64 * 1024;

/** 12 levels of nested containers — deeper than any real custom field needs. */
export const MAX_JSON_DEPTH = 12;

/**
 * Serialized length via JSON, or `null` when the value cannot be serialized at
 * all (BigInt, circular structure). superjson is the tRPC transformer, so a
 * `z.unknown()` value can arrive as a Date/Map/BigInt — `JSON.stringify` may
 * throw. An unserializable payload is treated as invalid rather than crashing
 * the request.
 */
function serializedLength(value: unknown): number | null {
  try {
    return (JSON.stringify(value) ?? '').length;
  } catch {
    return null;
  }
}

/**
 * Maximum nesting depth over plain objects and arrays. A top-level object of
 * scalars is depth 1; a bare scalar is depth `depth`. Recursion short-circuits
 * as soon as the cap is exceeded, so a hostile deeply-nested (or circular)
 * input cannot blow the call stack here.
 */
function depthOf(value: unknown, depth = 0): number {
  if (depth > MAX_JSON_DEPTH) return depth;
  const children: unknown[] | null = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object'
      ? Object.values(value)
      : null;
  if (children === null) return depth;
  let max = depth;
  for (const child of children) {
    const d = depthOf(child, depth + 1);
    if (d > max) max = d;
    if (max > MAX_JSON_DEPTH) return max;
  }
  return max;
}

/**
 * Drop-in replacement for `z.record(z.unknown())` at persisted-input
 * boundaries. Same `Record<string, unknown>` output type; adds a serialized
 * size bound and a nesting-depth bound.
 */
export const boundedRecord = z
  .record(z.unknown())
  .refine(
    (v) => {
      const len = serializedLength(v);
      return len !== null && len <= MAX_JSON_BYTES;
    },
    { message: 'payload too large' },
  )
  .refine((v) => depthOf(v) <= MAX_JSON_DEPTH, {
    message: 'payload too deeply nested',
  });
