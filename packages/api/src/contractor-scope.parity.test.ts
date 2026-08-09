/**
 * Entity-level predicate parity for the contractor boundary.
 *
 * Three consecutive audits found the same mechanism in three routers, nine
 * defects between them: `loadContractorScope` applied at the two procedures
 * named `list` and `get`, and every other door that resolves the same
 * record by id stopping at tenant + id. The scope stopped at the procedure
 * NAME rather than at the boundary.
 *
 * A portal contractor user's activities grant permissions TENANT-WIDE —
 * `inspections` grants three (`view`, `conduct`, `sign`), `issues` and
 * `actions` two each — so every unscoped door is a live hole. In
 * Inspections that meant `get` refusing another company's record while the
 * same caller read its signature sheet, overwrote its answers, signed it,
 * and collected a working public share URL for it.
 *
 * The generalisation the audits converged on: **of every procedure that
 * resolves a record by id, does it apply every predicate the canonical
 * read applies?** That is not fully checkable from source — but the
 * mechanism that let it happen three times IS: a router resolving its own
 * entity by `(tenantId, id)` inline, instead of through the one helper
 * that carries the predicates.
 *
 * So this test does the checkable half. It reads the three routers and
 * fails on an inline `eq(<entity>.tenantId, …)` + `eq(<entity>.id, …)`
 * lookup outside the sanctioned loader. Adding a fourth such lookup — the
 * exact move that produced all nine defects — fails here rather than in an
 * audit six months later.
 *
 * It cannot prove a helper is CORRECT, only that the lookup goes through
 * one. That is the right division: correctness is pinned by the per-router
 * behavioural tests; this pins that there is one place to get it right.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROUTERS = join(dirname(fileURLToPath(import.meta.url)), 'routers');

interface Guarded {
  /** Router files that resolve this entity by id. */
  files: string[];
  /** The drizzle table identifier as written in source. */
  table: string;
  /**
   * Lines allowed to hold an inline lookup — the canonical loader itself,
   * plus anything genuinely not a caller-facing read. Each entry is a
   * substring that must appear within the surrounding 6 lines.
   */
  sanctioned: string[];
}

const GUARDED: Guarded[] = [
  {
    files: ['inspections.ts', 'signatures.ts', 'exports.ts', 'approvals.ts'],
    table: 'inspections',
    sanctioned: [
      'loadInspectionForCallerOrThrow',
      // `exports.ts` funnels all four of its procedures through this one.
      'async function requireInspection',
      /**
       * `signWorkflow` and `listAwaitingMySignature` carry no
       * `requirePermission` on purpose: they authorise by named-signer
       * MEMBERSHIP (`signerUserId === ctx.auth.userId`, FORBIDDEN
       * otherwise), because the person a template asks to counter-sign may
       * hold no inspections key at all. That is a stricter predicate than
       * contractor scope, not a missing one — declared by name here so a
       * THIRD such procedure fails this test rather than joining a silent
       * allowlist.
       */
      'signWorkflow:',
    ],
  },
  {
    files: ['issues.ts'],
    table: 'issues',
    sanctioned: ['async function loadIssueOrThrow', 'loadIssueForCallerOrThrow'],
  },
  {
    files: ['actions.ts'],
    table: 'actions',
    sanctioned: ['async function loadActionOrThrow', 'loadActionForCallerOrThrow'],
  },
];

/**
 * An inline READ of `<table>` by `(tenantId, id)`.
 *
 * Reads only, deliberately. A single-statement `UPDATE … WHERE tenant AND
 * id` or `DELETE … WHERE tenant AND id` is the correct idiom and carries
 * its own scope; flagging those would be a false positive, and a guard
 * that cries wolf gets deleted. What this class of defect always looked
 * like was *resolve the record, then act on it* with the predicates
 * missing in between.
 */
function findInlineLookups(source: string, table: string, sanctioned: string[]): string[] {
  const lines = source.split('\n');
  const hits: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (!line.includes(`eq(${table}.tenantId,`)) continue;
    const window = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
    if (!window.includes(`eq(${table}.id,`)) continue;
    // Must be a SELECT … FROM <table>, not a scoped write.
    const before = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
    if (!new RegExp(`\\.from\\(${table}\\)`).test(before)) continue;
    // A sanctioned loader may legitimately do this — it is the one place
    // the predicates are supposed to live.
    const near = lines.slice(Math.max(0, i - 30), i + 4).join('\n');
    if (sanctioned.some((s) => near.includes(s))) continue;
    hits.push(`${i + 1}: ${line.trim()}`);
  }
  return hits;
}

describe('contractor boundary — entity-level predicate parity', () => {
  it('CS-P01: no router resolves its own entity by (tenant, id) outside the sanctioned loader', async () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const guard of GUARDED) {
      for (const file of guard.files) {
        const source = await readFile(join(ROUTERS, file), 'utf-8').catch(() => null);
        if (source === null) continue;
        scanned += 1;
        for (const hit of findInlineLookups(source, guard.table, guard.sanctioned)) {
          offenders.push(`${file}:${hit}`);
        }
      }
    }
    // Guard the guard: a rename that made every file unreadable would
    // otherwise pass silently.
    expect(scanned).toBeGreaterThanOrEqual(6);
    expect(offenders).toEqual([]);
  });

  it('CS-P02: each guarded router still imports the scope helper', async () => {
    // The cheapest possible regression: somebody deletes the import and
    // every call with it. The behavioural tests would catch it, but this
    // says which file and why.
    for (const file of ['inspections.ts', 'issues.ts', 'actions.ts']) {
      const source = await readFile(join(ROUTERS, file), 'utf-8');
      expect(source, file).toContain('loadContractorScope');
    }
  });
});
