/**
 * TS-G01 — no query on a tenant-scoped table from a function with no idea
 * which tenant it is serving.
 *
 * Ground rule #4 says every user-data table carries `tenant_id` and every
 * query scopes by it. That rule is enforced today by discipline and code
 * review, which is to say by nothing mechanical. This guard is the
 * mechanical half, and it exists because the failure it prevents — one
 * tenant reading or writing another's records — is the worst outcome this
 * product has.
 *
 * ## What it does
 *
 * It derives the tenant-scoped tables from the Drizzle schema itself (any
 * `pgTable` whose column block declares `tenantId`), so a table added next
 * month is covered without touching this file. Then it walks every source
 * file in the packages that talk to the database, extracts each Drizzle
 * chain around a `.from(t)` / `.update(t)` / `.delete(t)` / `.insert(t)`,
 * and asks whether the tenant is anywhere in the picture: in the
 * `.where()` / `.values()` argument, in the definition of a variable that
 * argument references, or at least somewhere in the enclosing function.
 *
 * A query that fails all three is a query written with no tenant in scope
 * at all. Those are listed below, each with the reason it is safe.
 *
 * ## What it deliberately does NOT claim
 *
 * The third test — "somewhere in the enclosing function" — is weak on
 * purpose, and this docstring is not going to pretend otherwise. The
 * sandbox permission list is on record in `CLAUDE.md` as a guard whose
 * docstring claimed a completeness it did not have, so:
 *
 * - A query with no tenant predicate inside a function that mentions
 *   `tenantId` for some *other* reason passes. There were 87 such queries
 *   when this landed. Every one was read by hand during the audit and each
 *   is scoped by a parent row the same call path already proved — the
 *   `loadXOrThrow(ctx.db, ctx.tenantId, input.id)` pattern — but nothing
 *   here re-checks that, and a new one could be wrong.
 * - It reads text, not types. A query built through a helper that takes a
 *   pre-built `where` is invisible to it.
 * - Raw `sql\`\`` is not parsed at all.
 *
 * So this catches one specific shape: a brand-new query written somewhere
 * that never knew the tenant. That happens to be the shape a genuine
 * isolation bug takes, which is why it is worth 200 lines. It is not a
 * proof of tenant isolation, and RLS at the database — still open as M1 in
 * the security review — is what would be.
 *
 * When this fails: add the tenant predicate. Only add an allowlist entry
 * if the query is genuinely tenant-agnostic (a worker sweeping every
 * tenant, a lookup whose key IS the credential), and write down why.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCHEMA_DIR = join(REPO_ROOT, 'packages', 'db', 'src', 'schema');

/** Every package that reaches Postgres. Keep in step with the workspace. */
const SOURCE_ROOTS = [
  'packages/api/src',
  'packages/jobs/src',
  'packages/render/src',
  'packages/auth/src',
  'packages/permissions/src',
  'apps/web/app',
  'apps/web/src',
];

/**
 * Queries with no tenant anywhere in their enclosing function, and why each
 * is correct. `file:symbol` rather than a line number so an unrelated edit
 * above them does not fail the build.
 */
const ALLOWED: ReadonlyArray<{ at: string; why: string }> = [
  {
    at: 'packages/jobs/src/workers/action-reminders.ts:actions',
    why: 'Reminder sweep. Deliberately cross-tenant: it selects `actions.tenantId` and fans out per tenant. The stamping update keys on the ids that sweep just returned.',
  },
  {
    at: 'packages/jobs/src/workers/incident-riddor-watch.ts:incidents',
    why: 'RIDDOR deadline sweep. A statutory clock does not stop at a tenant boundary — the worker scans every tenant and notifies each one separately.',
  },
  // site-header.tsx used to hold an entry here (session-id lookup for the
  // live header name). The shell redesign joined that query to `tenants`
  // for the workspace switcher, so the tenant is in the picture and the
  // scanner sees it scoped — the exemption retired with the rewrite.
];

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const WS = (c: string | undefined): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r';
const ID = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_$]/.test(c);

/** Blank out comments so a comment that quotes a bug is not read as one. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

function matchClose(src: string, open: number, o = '(', c = ')'): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === o) depth += 1;
    else if (ch === c) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchOpen(src: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    const ch = src[i];
    if (ch === ')') depth += 1;
    else if (ch === '(') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Expand from the `.` of `.from(` / `.insert(` / … to the whole Drizzle
 * chain, by walking `.method(...)` segments backwards to the receiver and
 * then forwards to the end. Exact bracket matching, no line windows — a
 * window that overruns into the next statement is how an earlier pass at
 * this produced 639 phantom findings.
 */
function chainAround(src: string, dot: number): string {
  let start = dot;
  for (;;) {
    let i = start - 1;
    while (i >= 0 && WS(src[i])) i -= 1;
    if (src[i] !== ')') break;
    const open = matchOpen(src, i);
    if (open < 0) break;
    let j = open - 1;
    while (j >= 0 && WS(src[j])) j -= 1;
    while (j >= 0 && ID(src[j])) j -= 1;
    while (j >= 0 && WS(src[j])) j -= 1;
    if (src[j] !== '.') break;
    start = j;
  }
  let i = start - 1;
  while (i >= 0 && WS(src[i])) i -= 1;
  while (i >= 0 && (ID(src[i]) || src[i] === '.')) i -= 1;
  const from = i + 1;

  let end = dot;
  let cursor = dot;
  for (;;) {
    let k = cursor;
    while (k < src.length && WS(src[k])) k += 1;
    if (src[k] !== '.') break;
    k += 1;
    while (k < src.length && WS(src[k])) k += 1;
    const nameStart = k;
    while (k < src.length && ID(src[k])) k += 1;
    if (k === nameStart) break;
    while (k < src.length && WS(src[k])) k += 1;
    if (src[k] !== '(') break;
    const close = matchClose(src, k);
    if (close < 0) break;
    end = close;
    cursor = close + 1;
  }
  return src.slice(from, end + 1);
}

/** The text inside `.where(` / `.values(`, or null when the chain has none. */
function argumentOf(chain: string, marker: string): string | null {
  const at = chain.indexOf(marker);
  if (at === -1) return null;
  const open = at + marker.length - 1;
  const close = matchClose(chain, open);
  return close < 0 ? null : chain.slice(open + 1, close);
}

/**
 * The outermost function body containing `idx` — the exported helper or the
 * tRPC handler, rather than some inner `.map()` callback. A `{` counts as a
 * function body when the token before it is `)`, `=>` or `>` (the last one
 * being a return-type annotation, which is what an earlier version missed:
 * it mis-reported every annotated function as tenant-blind).
 */
function enclosingFunction(src: string, idx: number): string {
  const openBlocks: number[] = [];
  for (let i = 0; i < idx; i += 1) {
    if (src[i] === '{') openBlocks.push(i);
    else if (src[i] === '}') openBlocks.pop();
  }
  for (const open of openBlocks) {
    let j = open - 1;
    while (j >= 0 && WS(src[j])) j -= 1;
    const prev = src[j];
    const isArrow = src.slice(Math.max(0, j - 1), j + 1) === '=>';
    if (isArrow || prev === ')' || prev === '>') {
      const close = matchClose(src, open, '{', '}');
      return close < 0 ? '' : src.slice(open, close + 1);
    }
  }
  return '';
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      // A broken symlink is not a reason to fail the build.
      continue;
    }
    if (isDirectory) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) acc.push(full);
  }
  return acc;
}

/** Table constants whose Drizzle column block declares `tenantId`. */
function tenantScopedTables(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(SCHEMA_DIR)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/export const ([A-Za-z_$][\w$]*)\s*=\s*pgTable\(/g)) {
      const name = m[1];
      if (name === undefined) continue;
      const columnsOpen = src.indexOf('{', m.index + m[0].length);
      if (columnsOpen === -1) continue;
      const columnsClose = matchClose(src, columnsOpen, '{', '}');
      if (columnsClose === -1) continue;
      if (/\btenantId\b/.test(src.slice(columnsOpen, columnsClose))) found.add(name);
    }
  }
  return found;
}

interface Unscoped {
  file: string;
  table: string;
  operation: string;
  snippet: string;
}

function findUnscopedQueries(): { unscoped: Unscoped[]; total: number } {
  const tables = tenantScopedTables();
  const unscoped: Unscoped[] = [];
  let total = 0;

  for (const root of SOURCE_ROOTS) {
    for (const file of sourceFiles(join(REPO_ROOT, root))) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(/\.(from|update|delete|insert)\(\s*([A-Za-z_$][\w$]*)/g)) {
        const operation = m[1];
        const table = m[2];
        if (operation === undefined || table === undefined || !tables.has(table)) continue;
        total += 1;

        const chain = chainAround(src, m.index);
        const filter = argumentOf(chain, operation === 'insert' ? '.values(' : '.where(');
        if (filter !== null && /\btenantId\b/.test(filter)) continue;

        const fn = enclosingFunction(src, m.index);
        if (filter !== null) {
          // The filter may be a variable built earlier — resolve it textually.
          const referenced = new Set(
            [...filter.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((x) => x[1]),
          );
          const viaVariable = [...referenced].some(
            (name) =>
              name !== undefined &&
              new RegExp(`\\b(const|let|var)\\s+${name}\\b[\\s\\S]{0,1500}?tenantId`).test(fn),
          );
          if (viaVariable) continue;
        }
        if (/\btenantId\b/.test(fn)) continue;

        unscoped.push({
          file: relative(REPO_ROOT, file),
          table,
          operation,
          snippet: chain.replace(/\s+/g, ' ').slice(0, 160),
        });
      }
    }
  }
  return { unscoped, total };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tenant scoping (TS-G01)', () => {
  const allowed = new Set(ALLOWED.map((entry) => entry.at));

  it('derives the tenant-scoped tables from the schema, not a hardcoded list', () => {
    const tables = tenantScopedTables();
    // Sanity: the schema really is mostly tenant-scoped, and the handful of
    // global tables (better-auth's own, `tenants` itself) really are not.
    expect(tables.size).toBeGreaterThan(100);
    expect(tables.has('inspections')).toBe(true);
    expect(tables.has('incidents')).toBe(true);
    expect(tables.has('tenants')).toBe(false);
    expect(tables.has('session')).toBe(false);
  });

  it('finds no query written with no tenant in scope, outside the allowlist', () => {
    const { unscoped, total } = findUnscopedQueries();
    // If this drops to nothing the extraction has broken, not the codebase.
    expect(total).toBeGreaterThan(500);

    const unexpected = unscoped.filter((q) => !allowed.has(`${q.file}:${q.table}`));
    expect(
      unexpected.map((q) => `${q.file} [${q.operation} ${q.table}]\n    ${q.snippet}`),
    ).toEqual([]);
  });

  it('keeps the allowlist honest — every entry still matches a real query', () => {
    const { unscoped } = findUnscopedQueries();
    const live = new Set(unscoped.map((q) => `${q.file}:${q.table}`));
    // A stale entry is how an allowlist quietly grows into a blanket
    // exemption for a file somebody has since rewritten.
    expect(ALLOWED.filter((entry) => !live.has(entry.at)).map((e) => e.at)).toEqual([]);
  });

  it('every allowlist entry carries a reason', () => {
    for (const entry of ALLOWED) {
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });
});
