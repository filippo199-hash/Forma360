/**
 * ULID-based identifier helper.
 *
 * Every domain entity id in Forma360 is a ULID (Crockford base32, 26 chars,
 * timestamp-prefixed, monotonic-within-a-millisecond). Rationale lives in
 * ADR 0003.
 *
 * Why not UUID? ULIDs are sortable by creation time, URL-safe without encoding,
 * and human-readable. UUID v7 would also work, but ULID has wider library
 * support in our stack today.
 */
import { monotonicFactory, ulid } from 'ulid';

/**
 * Branded string type for Forma360 entity ids. Using a brand prevents
 * accidental mixing of ids with ordinary strings in function signatures.
 */
export type Id = string & { readonly __brand: 'Id' };

/**
 * ULIDs use Crockford base32, which excludes the letters I, L, O, and U to
 * avoid visual ambiguity.
 */
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const monotonic = monotonicFactory();

/**
 * Generate a new ULID. Monotonic within a single process: if called twice in
 * the same millisecond, the second id is guaranteed to sort after the first.
 */
export function newId(): Id {
  return monotonic() as Id;
}

/**
 * Generate a ULID for a specific timestamp (useful in tests and backfills).
 */
export function newIdAt(timestampMs: number): Id {
  return ulid(timestampMs) as Id;
}

/**
 * Type guard: does this value look like a ULID we would generate?
 * Validates length (26) and alphabet (Crockford base32, uppercase only).
 */
export function isId(value: unknown): value is Id {
  return typeof value === 'string' && ULID_RE.test(value);
}
