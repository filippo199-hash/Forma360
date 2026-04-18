/**
 * Thin wrapper around the `rrule` npm package.
 *
 * Keeps the rrule import concentrated so if upstream ships a
 * non-bundler-friendly entry (as it has historically) we can patch in
 * one place instead of across every worker / router.
 */
// `rrule` ships both CJS and ESM; we use the ESM default entry.
import { RRule, RRuleSet, rrulestr } from 'rrule';

export interface OccurrencesBetweenInput {
  /** The raw RRULE string (e.g. `FREQ=DAILY;BYHOUR=9`). */
  rrule: string;
  /** First-occurrence anchor. RRULE's DTSTART. */
  startAt: Date;
  /** Window start (inclusive). */
  from: Date;
  /** Window end (exclusive). */
  until: Date;
  /** Optional endAt bound from the schedule. */
  endAt?: Date | null;
}

/**
 * Return every occurrence of an RRULE in `[from, until)`. `startAt` is
 * the DTSTART anchor. `endAt`, if provided, further bounds the walk —
 * the effective upper is `min(until, endAt)`.
 *
 * Throws on a malformed rrule string; callers validate upstream.
 */
export function occurrencesBetween(input: OccurrencesBetweenInput): Date[] {
  const rule = rrulestr(input.rrule, { dtstart: input.startAt });
  const upper = input.endAt && input.endAt < input.until ? input.endAt : input.until;
  // rrule.between is start-exclusive by default; inc=true keeps equal
  // timestamps on both ends, matching the half-open semantics we want.
  return rule.between(input.from, upper, true);
}

/**
 * Validate an RRULE string. Returns null on success, or an error
 * message on parse failure (caller translates to a Zod issue or
 * TRPCError BAD_REQUEST).
 */
export function validateRrule(rrule: string): string | null {
  try {
    const parsed: unknown = rrulestr(rrule, { dtstart: new Date() });
    // `rrulestr` accepts some shapes we don't want — require at least a
    // FREQ token for recurring rules. (Single-occurrence RDATE-only rules
    // are out of PR 32's scope.)
    if (parsed instanceof RRule) {
      if (parsed.options.freq === undefined || parsed.options.freq === null) {
        return 'RRULE missing FREQ';
      }
      return null;
    }
    if (parsed instanceof RRuleSet) {
      if ((parsed as RRuleSet).rrules().length === 0) return 'RRULE set has no rules';
      return null;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid RRULE';
  }
}

/**
 * Best-effort preview helper used by the UI: next N occurrences after
 * `from`, bounded by `endAt`. Returns an empty list on parse error
 * rather than throwing — the UI renders zero matches.
 */
export function nextOccurrences(
  rrule: string,
  startAt: Date,
  n: number,
  from: Date,
  endAt?: Date | null,
): Date[] {
  try {
    const rule = rrulestr(rrule, { dtstart: startAt });
    const out: Date[] = [];
    let cursor: Date | null = from;
    while (out.length < n) {
      // rrule.after is exclusive; pass cursor as the lower bound.
      const next: Date | null = rule.after(cursor ?? from, false);
      if (next === null) break;
      if (endAt && next > endAt) break;
      out.push(next);
      cursor = next;
    }
    return out;
  } catch {
    return [];
  }
}
