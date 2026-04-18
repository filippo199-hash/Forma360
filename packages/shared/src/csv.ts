/**
 * CSV parsing / stringifying helpers.
 *
 * The Phase 1 prompt mandates **Zod at every boundary** and the G-E05
 * review-screen UX: bulk CSV uploads with per-row error reporting and a
 * downloadable CSV of rejected rows. This module provides a small
 * generic wrapper so every CSV import in Phase 1+ (users, sites, assets,
 * templates, …) produces the same summary shape without re-implementing
 * header handling + row validation each time.
 *
 * Usage:
 *   const userRow = z.object({ email: z.string().email(), ... });
 *   const result = await parseCsv(buffer, { schema: userRow });
 *   result.ok        // parsed, valid rows — proceed
 *   result.errors    // rejected rows with row numbers + messages
 *   result.rejectedCsv()  // downloadable CSV of rejected rows
 *
 * Streaming is explicitly NOT supported at this layer — Phase 1's imports
 * max out at tens of thousands of rows, which fits in RAM. If a later
 * phase needs multi-GB CSVs we'll add `parseCsvStream` without changing
 * the in-memory signature here.
 */
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import type { z } from 'zod';

/** A parsed-and-valid row together with its 1-indexed line number. */
export interface CsvOk<T> {
  line: number;
  row: T;
}

export interface CsvRowError {
  line: number;
  message: string;
  raw: Record<string, string>;
}

export interface ParseCsvOptions<T> {
  schema: z.ZodType<T>;
  /** Maximum rows accepted. Rows beyond the limit are rejected with a marker. */
  limit?: number;
  /** Override the row delimiter. Defaults to auto-detect via csv-parse. */
  delimiter?: string;
}

export interface CsvParseResult<T> {
  ok: CsvOk<T>[];
  errors: CsvRowError[];
  /** Build a CSV of the rejected rows for user download. */
  rejectedCsv: () => string;
}

/**
 * Parse a CSV buffer or string into typed rows. Every row is validated
 * against `schema`; failures are collected (with their line numbers) rather
 * than aborting the parse. Empty rows (all-blank cells) are silently
 * skipped, matching the G-E05 review flow.
 */
export function parseCsv<T>(
  source: string | Buffer,
  options: ParseCsvOptions<T>,
): CsvParseResult<T> {
  const rawText = typeof source === 'string' ? source : source.toString('utf8');
  const records: Record<string, string>[] = parse(rawText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    ...(options.delimiter !== undefined ? { delimiter: options.delimiter } : {}),
  }) as Record<string, string>[];

  const ok: CsvOk<T>[] = [];
  const errors: CsvRowError[] = [];

  records.forEach((raw, idx) => {
    // Line numbers start at 2 (header = 1). Keep them 1-indexed for humans.
    const line = idx + 2;

    if (options.limit !== undefined && ok.length + errors.length >= options.limit) {
      errors.push({
        line,
        message: `Row count exceeds limit (${options.limit}).`,
        raw,
      });
      return;
    }

    // Cells come out as strings; cast empty strings to undefined so
    // Zod optional() / default() fields behave correctly.
    const coerced: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(raw)) {
      coerced[k] = v === '' ? undefined : v;
    }

    const result = options.schema.safeParse(coerced);
    if (!result.success) {
      errors.push({
        line,
        message: result.error.errors
          .map((e) => `${e.path.join('.') || '(row)'}: ${e.message}`)
          .join('; '),
        raw,
      });
      return;
    }
    ok.push({ line, row: result.data });
  });

  return {
    ok,
    errors,
    rejectedCsv: () => {
      if (errors.length === 0) return '';
      // Preserve the raw columns + prepend a "error" column so users can
      // fix and re-upload.
      const columns = Object.keys(errors[0]?.raw ?? {});
      const rows = errors.map((e) => ({
        line: String(e.line),
        error: e.message,
        ...e.raw,
      }));
      return stringify(rows, {
        header: true,
        columns: ['line', 'error', ...columns],
      });
    },
  };
}

/**
 * Serialise a list of records to CSV. Column order is preserved.
 * Used by the user-list export (S-10) and every future bulk export.
 */
export function toCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly string[],
): string {
  // csv-stringify's `Input` type is invariant over mutability; cast at the
  // boundary so our public API can stay `readonly`. No runtime change.
  return stringify(rows as Record<string, unknown>[], {
    header: true,
    columns: columns as string[],
  });
}
