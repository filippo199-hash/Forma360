# ADR 0003 — ULID over UUID

**Status:** Accepted
**Date:** 2026-04-18

## Context

We need a globally unique id format for every entity in Forma360. The
baseline options:

- **UUIDv4** — 128 random bits. Universal tooling support.
- **UUIDv7** — timestamp-prefixed, sortable. Newer; library support still
  maturing at the time of writing.
- **ULID** — 26-character Crockford base32, timestamp-prefixed, monotonic
  within a millisecond. Sortable by creation time.
- **Database-generated bigint** — compact but not safe to hand to clients
  (enumeration attacks, id-leakage signals).

## Decision

**ULID everywhere.** Generated in application code via the `ulid` package's
monotonic factory. Branded as `Id` (a `string & { __brand: 'Id' }`) in
TypeScript so accidental string/id mixups are compile errors.

## Rationale

1. **Sortable.** `ORDER BY id` ≈ `ORDER BY created_at` because the first 10
   characters are a millisecond timestamp. Very useful for cursor
   pagination without needing a separate sort key.
2. **URL-safe and human-readable.** `/inspections/01ARZ3NDEKTSV4RRFFQ69G5FAV`
   reads better than `/inspections/f47ac10b-58cc-4372-a567-0e02b2c3d479`.
   Copy/paste, logs, and support tickets all benefit.
3. **Monotonic within a process.** Our `newId()` uses `monotonicFactory` —
   two calls in the same millisecond produce strictly ordered ids. This
   matters for cursor pagination under load.
4. **Wide library support.** `ulid` npm package is tiny, zero-dep, stable
   since 2019.
5. **UUIDv7 would also work.** When UUIDv7 lands in Postgres as a native
   `gen_uuid7()` function we'll re-evaluate; for now, ULID in application
   code is the cleaner seam because we control generation timing (useful
   in backfills and tests).

## Consequences

- **All primary-key columns are `varchar(26)`** (not `text`, not `uuid`).
  The length is fixed; smaller and faster than `uuid` on modern Postgres.
- **`isId(v)` guard** validates length 26 + Crockford base32 alphabet
  (excludes I, L, O, U to avoid visual ambiguity) for every untrusted
  string that claims to be an id — URL params, CSV imports, JSON bodies.
- **`newIdAt(timestampMs)`** exists for test fixtures and historical
  backfills where the id's timestamp must match an externally meaningful
  date.
- **Object-storage keys embed the ULID pattern** — see
  `packages/shared/src/storage.ts` where the key regex includes two
  26-char ULID segments.
- **Sorting by id is safe** because of the timestamp prefix, but we still
  order by explicit timestamp columns in user-facing lists so a clock skew
  between app servers does not reorder rows visibly.

## Non-options that were rejected

- **UUIDv4:** no ordering; large URL footprint.
- **Bigint:** exposes business volume (invoice #42 gives away how many
  customers you have); also forces server-side generation.
- **Per-table custom schemes** (e.g. `usr_...` prefixes): cute but makes
  foreign keys ambiguous to read across modules.
