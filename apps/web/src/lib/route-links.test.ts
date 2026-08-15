/**
 * Every internal link must point at a route that exists (RT-L01).
 *
 * This is the third time this codebase has shipped a page that is linked
 * from the UI and 404s:
 *
 *   - RS-A1: the RAMS pack builder "was written and never committed".
 *   - BUG-01: four HSE practitioners hit that same 404 in production, and
 *     it was the top P0 of the evaluation.
 *   - Then again, during the fix for BUG-01 — `.gitignore` carried an
 *     unanchored `build/` rule for build artefacts, the route's own segment
 *     is legitimately called `build`, and `git add -A` skipped the file
 *     without printing anything. It was written, verified by typecheck
 *     against a stale on-disk copy, and reported fixed. Only the deployed
 *     tree told the truth.
 *
 * Reviews do not catch this: the diff looks right, the file is on the
 * author's disk, and the link is one line in another file. What catches it
 * is asking the router itself. So: collect every literal
 * `/${locale}/…` href in the app and assert a matching App Router
 * directory exists on disk.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');
const LOCALE_DIR = join(APP_DIR, '[locale]');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, out);
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** A path segment from a link: a literal name, or "any dynamic segment". */
type Segment = { kind: 'literal'; value: string } | { kind: 'dynamic' };

/**
 * Does a route exist for `segments`?
 *
 * A literal segment matches a directory of that name OR a dynamic one — a
 * link to `/settings/company` is served by `[section]` just as well. A
 * dynamic segment matches only a dynamic directory. Route groups `(name)`
 * are transparent to the URL, so they are stepped through without consuming
 * a segment.
 */
function routeExists(segments: Segment[]): boolean {
  /** Expand a directory into itself plus any route groups inside it. */
  const withGroups = (dir: string): string[] => {
    const out = [dir];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (!entry.startsWith('(') || !entry.endsWith(')')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...withGroups(full));
    }
    return out;
  };

  let dirs = withGroups(LOCALE_DIR);
  for (const segment of segments) {
    const next: string[] = [];
    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = join(dir, entry);
        if (!statSync(full).isDirectory()) continue;
        const isDynamic = /^\[.+\]$/.test(entry);
        const matches =
          segment.kind === 'dynamic' ? isDynamic : entry === segment.value || isDynamic;
        if (matches) next.push(...withGroups(full));
      }
    }
    if (next.length === 0) return false;
    dirs = next;
  }
  // The final directory must actually render something.
  return dirs.some((dir) => {
    try {
      return readdirSync(dir).some((f) => f.startsWith('page.'));
    } catch {
      return false;
    }
  });
}

describe('internal links', () => {
  it('RT-L01 — every `/${locale}/…` link points at a route that exists', () => {
    const problems = new Set<string>();
    let checked = 0;

    for (const file of walk(APP_DIR)) {
      const src = readFileSync(file, 'utf-8');
      // `/${locale}/rams/${packId}/build` → the static segments of the path.
      for (const m of src.matchAll(/`\/\$\{locale\}\/([^`]*)`/g)) {
        const path = m[1];
        if (path === undefined || path === '') continue;
        // Drop query/hash, then map each segment: an interpolation is a
        // dynamic segment, anything else must match literally.
        const clean = path.split('?')[0]?.split('#')[0] ?? '';
        const raw = clean.split('/').filter((seg) => seg !== '');
        if (raw.length === 0) continue;
        // A segment mixing text and interpolation cannot be resolved
        // statically (`report-${kind}`); skip rather than guess.
        if (raw.some((seg) => seg.includes('${') && !/^\$\{[^}]*\}$/.test(seg))) continue;
        const segments: Segment[] = raw.map((seg) =>
          seg.startsWith('${') ? { kind: 'dynamic' } : { kind: 'literal', value: seg },
        );
        checked += 1;
        if (!routeExists(segments)) {
          problems.add(`/${clean}  (${file.slice(APP_DIR.length + 1)})`);
        }
      }
    }

    // If the scan stops finding links, this test proves nothing.
    expect(checked).toBeGreaterThan(50);
    expect({ linksTo404: [...problems].sort() }).toEqual({ linksTo404: [] });
  });
});
